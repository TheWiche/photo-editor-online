/**
 * OCR con tesseract.js (español + inglés), sin dependencia npm: los scripts y el núcleo WASM se
 * descargan UNA vez desde jsDelivr (versiones fijadas) y se guardan en la Cache API 'modelos-ia-v1';
 * los idiomas se guardan en el IndexedDB que el propio Tesseract consulta antes de descargar.
 *
 * tesseract.js crea su propio Web Worker, así que el reconocimiento no bloquea la interfaz.
 * Se controla desde el hilo principal porque su API usa `window` para resolver rutas.
 */
import type { ProgressEvent } from '../core/contracts';
import type { InstallOutcome, OcrResult, OcrWord } from './types';
import { CancelledError } from './types';
import { cachedFetch, idb, idbKey, OWN_CACHE, sumCachedBytes } from './cache';
import { createCanvas, ctx2d } from './imageUtils';

const TESS_VERSION = '7.0.0';
const CORE_VERSION = '7.0.0';
const LIB_URL = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESS_VERSION}/dist/tesseract.esm.min.js`;
const WORKER_URL = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESS_VERSION}/dist/worker.min.js`;
const CORE_BASE = `https://cdn.jsdelivr.net/npm/tesseract.js-core@${CORE_VERSION}/`;
const LANGS = ['spa', 'eng'] as const;
const langUrl = (l: string) => `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${l}/4.0.0_best_int/${l}.traineddata.gz`;
const LANG_SIZES: Record<string, number> = { spa: 2_100_190, eng: 2_952_873 };

/** Base de datos y almacén que usa tesseract.js (idb-keyval por defecto). */
const TESS_DB = 'keyval-store';
const TESS_STORE = 'keyval';
/** cachePath propio para no chocar con otras apps del mismo origen. */
const CACHE_PATH = 'estudio-foto-ocr-v1';
const langKey = (l: string) => `${CACHE_PATH}/${l}.traineddata`;

function simdSupported(): boolean {
  try {
    // Módulo WASM mínimo que usa una instrucción SIMD (v128).
    return WebAssembly.validate(
      new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]),
    );
  } catch {
    return false;
  }
}

const coreUrl = () => `${CORE_BASE}${simdSupported() ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js'}`;

export async function installOcr(onProgress: (e: ProgressEvent) => void, signal?: AbortSignal): Promise<InstallOutcome> {
  const urls = [LIB_URL, WORKER_URL, coreUrl()];
  const labels = ['tesseract.js', 'Tesseract (worker)', 'Núcleo Tesseract (WASM)'];
  const expected = [63_220, 111_307, 3_900_000];
  for (let i = 0; i < urls.length; i++) {
    await cachedFetch(urls[i], { cacheName: OWN_CACHE, label: labels[i], expectedBytes: expected[i], onProgress, signal });
  }
  let langBytes = 0;
  const idbKeys: string[] = [];
  for (const l of LANGS) {
    if (signal?.aborted) throw new CancelledError();
    const key = langKey(l);
    if (!(await idb.has(TESS_DB, TESS_STORE, key))) {
      // Se descarga sin guardarlo en Cache API (iría duplicado): va directo al IndexedDB de Tesseract.
      const res = await cachedFetch(langUrl(l), {
        cacheName: `${OWN_CACHE}-tmp`,
        label: `Idioma ${l === 'spa' ? 'español' : 'inglés'}`,
        expectedBytes: LANG_SIZES[l],
        onProgress,
        signal,
      });
      const bytes = new Uint8Array(await res.arrayBuffer());
      await idb.set(TESS_DB, TESS_STORE, key, bytes); // Tesseract acepta los datos comprimidos (gzip)
      langBytes += bytes.byteLength;
      try {
        await caches.delete(`${OWN_CACHE}-tmp`);
      } catch {
        /* ignorar */
      }
    } else {
      langBytes += LANG_SIZES[l];
    }
    idbKeys.push(idbKey(TESS_DB, TESS_STORE, key));
  }
  return { variant: 'wasm', urls, idbKeys, bytes: (await sumCachedBytes(urls)) + langBytes };
}

// ------------------------------------------------------------------ ejecución

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TessWorker = any;
let workerPromise: Promise<TessWorker> | null = null;
const blobUrls: string[] = [];

async function blobFromCache(url: string, type: string): Promise<string> {
  const res = await caches.match(url);
  if (!res) throw new Error('Faltan archivos del OCR. Vuelve a descargarlo en el Centro de módulos.');
  const u = URL.createObjectURL(new Blob([await res.blob()], { type }));
  blobUrls.push(u);
  return u;
}

function getWorker(): Promise<TessWorker> {
  workerPromise ??= (async () => {
    const libUrl = await blobFromCache(LIB_URL, 'text/javascript');
    const workerPath = await blobFromCache(WORKER_URL, 'text/javascript');
    // El sufijo '#…wasm.js' hace que tesseract.js lo trate como archivo y no como carpeta.
    const corePath = `${await blobFromCache(coreUrl(), 'text/javascript')}#tesseract-core.wasm.js`;
    const mod = await import(/* @vite-ignore */ libUrl);
    const Tesseract = mod.default ?? mod;
    return Tesseract.createWorker([...LANGS], 1 /* OEM.LSTM_ONLY */, {
      workerPath,
      corePath,
      cachePath: CACHE_PATH,
      cacheMethod: 'readOnly',
      workerBlobURL: true,
    });
  })();
  workerPromise.catch(() => {
    workerPromise = null;
  });
  return workerPromise;
}

export async function terminateOcr(): Promise<void> {
  const p = workerPromise;
  workerPromise = null;
  if (p) await p.then((w) => w.terminate()).catch(() => undefined);
  blobUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
}

export async function runOcr(image: ImageBitmap, signal?: AbortSignal): Promise<OcrResult> {
  if (signal?.aborted) throw new CancelledError();
  const canvas = createCanvas(image.width, image.height);
  ctx2d(canvas).drawImage(image, 0, 0);
  const blob: Blob =
    'convertToBlob' in canvas
      ? await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/png' })
      : await new Promise<Blob>((res, rej) => (canvas as HTMLCanvasElement).toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/png'));
  const worker = await getWorker();
  const job = worker.recognize(blob, {}, { text: true, blocks: true });
  const onAbort = () => void terminateOcr();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const result = await Promise.race([
      job,
      new Promise<never>((_, rej) => signal?.addEventListener('abort', () => rej(new CancelledError()), { once: true })),
    ]);
    const page = result.data;
    const words: OcrWord[] = [];
    for (const block of page.blocks ?? []) {
      for (const para of block.paragraphs ?? []) {
        for (const line of para.lines ?? []) {
          for (const w of line.words ?? []) {
            words.push({
              text: w.text,
              confidence: w.confidence,
              bbox: { x: w.bbox.x0, y: w.bbox.y0, width: w.bbox.x1 - w.bbox.x0, height: w.bbox.y1 - w.bbox.y0 },
            });
          }
        }
      }
    }
    return { text: String(page.text ?? '').trim(), confidence: page.confidence ?? 0, words };
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}
