/// <reference lib="webworker" />
/**
 * Web Worker (módulo ES) que ejecuta TODA la inferencia de IA fuera del hilo principal.
 *
 *  - Transformers.js usa su propio ONNX Runtime; su binario WASM queda guardado en 'transformers-cache'
 *    (env.useWasmCache) y se registra como archivo compartido del módulo para verificarlo offline.
 *  - LaMa (ONNX propio) usa onnxruntime-web, importado bajo demanda; su binario WASM se guarda en la
 *    Cache API 'modelos-ia-v1'.
 *    (Nota: inyectar un único runtime con Symbol.for('onnxruntime') no sirve en Transformers.js 4.x:
 *    deja vacía la lista de dispositivos y falla con «Unsupported device».)
 *  - WebGPU si está disponible (lo detecta el hilo principal), con caída a WASM.
 *  - Las tareas se ejecutan en cola (una a la vez) y se pueden cancelar.
 *
 * Uso: new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }) — ver client.ts.
 */
import type * as OrtNS from 'onnxruntime-web';
import type { ModuleId, ProgressEvent } from '../core/contracts';
import type {
  BackendInfo,
  CaptionDetail,
  InstallOutcome,
  NsfwResult,
  RunInputs,
  SegmentPoint,
  SegmentResult,
  VariantKey,
  WorkerRequest,
  WorkerResponse,
} from './types';
import { CancelledError } from './types';
import { getModuleSpec, repoPrefixes, type ModuleSpec, type TransformersModelSpec } from './registry';
import { cachedFetch, listCacheUrls, OWN_CACHE, sumCachedBytes, TRANSFORMERS_CACHE } from './cache';
import { bitmapToImageData, createCanvas, ctx2d, hasTransparency, toImageData } from './imageUtils';

const scope = self as unknown as DedicatedWorkerGlobalScope;

// Transformers.js se tipa de forma laxa a propósito: su API cambia entre versiones
// y aquí solo usamos una parte pequeña y estable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
type Progress = (e: ProgressEvent) => void;
type Ort = typeof OrtNS;

// ------------------------------------------------------------------ ONNX Runtime propio (LaMa)

let ortPromise: Promise<Ort> | null = null;
let runtimeUrls: string[] = [];

/** Importa onnxruntime-web y deja su binario WASM guardado (descarga única). */
function ensureOrt(onProgress?: Progress, signal?: AbortSignal): Promise<Ort> {
  ortPromise ??= (async () => {
    const ort = (await import('onnxruntime-web/webgpu')) as unknown as Ort;
    const version = ort.env.versions?.web ?? '1.31.1';
    const base = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/`;
    runtimeUrls = [`${base}ort-wasm-simd-threaded.asyncify.mjs`, `${base}ort-wasm-simd-threaded.asyncify.wasm`];
    const [mjsRes, wasmRes] = await Promise.all([
      cachedFetch(runtimeUrls[0], { cacheName: OWN_CACHE, label: 'Motor de IA (ONNX Runtime .mjs)', onProgress, signal }),
      cachedFetch(runtimeUrls[1], { cacheName: OWN_CACHE, label: 'Motor de IA (ONNX Runtime .wasm)', expectedBytes: 28_750_000, onProgress, signal }),
    ]);
    let code = await mjsRes.text();
    code = code.replaceAll('globalThis.process?.versions?.node', 'false');
    const mjsUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    ort.env.wasm.wasmBinary = await wasmRes.arrayBuffer();
    ort.env.wasm.wasmPaths = { mjs: mjsUrl, wasm: runtimeUrls[1] };
    ort.env.wasm.proxy = false;
    ort.env.logLevel = 'error';
    return ort;
  })();
  ortPromise.catch(() => {
    ortPromise = null;
  });
  return ortPromise;
}

// ------------------------------------------------------------------ Transformers.js

let currentSignal: AbortSignal | null = null;
let tfPromise: Promise<Any> | null = null;

function getTF(): Promise<Any> {
  tfPromise ??= import('@huggingface/transformers').then((T: Any) => {
    T.env.allowLocalModels = false;
    T.env.allowRemoteModels = true;
    T.env.useBrowserCache = true; // Cache API 'transformers-cache': descarga única
    T.env.cacheKey = TRANSFORMERS_CACHE;
    T.env.useWasmCache = true; // guarda el binario WASM de su ONNX Runtime en la misma caché
    // Inyectamos la señal de cancelación de la tarea en curso en todas las descargas.
    T.env.fetch = (input: string | URL, init?: RequestInit) =>
      fetch(input, { ...(init ?? {}), signal: currentSignal ?? init?.signal ?? undefined });
    return T;
  });
  tfPromise.catch(() => {
    tfPromise = null;
  });
  return tfPromise;
}

function tfProgress(onProgress?: Progress) {
  return (info: Any) => {
    if (!onProgress || !info) return;
    if (info.status === 'progress' && typeof info.loaded === 'number') {
      const total = Number(info.total) || 0;
      onProgress({
        file: `${info.name}/${info.file}`,
        loadedBytes: info.loaded,
        totalBytes: total,
        progress: total ? Math.min(1, info.loaded / total) : 0,
      });
    }
  };
}

function chooseVariant(b: BackendInfo): VariantKey {
  if (b.backend !== 'webgpu') return 'wasm';
  return b.f16 ? 'webgpu-f16' : 'webgpu';
}

function deviceFor(variant: VariantKey, b: BackendInfo, ms?: TransformersModelSpec): 'webgpu' | 'wasm' {
  if (ms?.forceWasm) return 'wasm';
  return variant !== 'wasm' && b.backend === 'webgpu' ? 'webgpu' : 'wasm';
}

// ------------------------------------------------------------------ modelos cargados (LRU)

interface Loaded {
  value: Any;
  dispose: () => unknown;
}

const MAX_LOADED = 2;
const loaded = new Map<string, Promise<Loaded>>();

async function getLoaded(key: string, loader: () => Promise<Loaded>): Promise<Any> {
  let p = loaded.get(key);
  if (p) {
    loaded.delete(key); // re-inserción = más reciente
    loaded.set(key, p);
  } else {
    p = loader();
    loaded.set(key, p);
    p.catch(() => loaded.delete(key));
    while (loaded.size > MAX_LOADED) {
      const [oldKey, oldP] = loaded.entries().next().value as [string, Promise<Loaded>];
      loaded.delete(oldKey);
      oldP.then((l) => l.dispose()).catch(() => undefined);
    }
  }
  return (await p).value;
}

async function disposeModule(id: ModuleId): Promise<void> {
  for (const [key, p] of [...loaded.entries()]) {
    if (key.startsWith(`${id}:`)) {
      loaded.delete(key);
      await p.then((l) => l.dispose()).catch(() => undefined);
    }
  }
  if (id === 'segment') segCache = null;
  if (id === 'inpaint' && lama) {
    const s = await lama.catch(() => null);
    lama = null;
    await s?.session.release().catch(() => undefined);
  }
}

async function loadTransformers(id: ModuleId, ms: TransformersModelSpec, variant: VariantKey, b: BackendInfo, onProgress?: Progress): Promise<Loaded> {
  const T = await getTF();
  const device = deviceFor(variant, b, ms);
  const progress_callback = tfProgress(onProgress);
  const opts = { dtype: ms.dtype[variant], device, progress_callback };
  const pipe = async (task: string): Promise<Loaded> => {
    const p = await T.pipeline(task, ms.repo, opts);
    return { value: p, dispose: () => p.dispose?.() };
  };
  switch (id) {
    case 'remove-bg': {
      // RMBG-1.4 declara un model_type propio: se carga como modelo «custom» (receta oficial del repo).
      const [model, processor] = await Promise.all([
        T.AutoModel.from_pretrained(ms.repo, { ...opts, config: { model_type: 'custom' } }),
        T.AutoProcessor.from_pretrained(ms.repo, {
          progress_callback,
          config: {
            do_normalize: true,
            do_pad: false,
            do_rescale: true,
            do_resize: true,
            image_mean: [0.5, 0.5, 0.5],
            feature_extractor_type: 'ImageFeatureExtractor',
            image_std: [1, 1, 1],
            resample: 2,
            rescale_factor: 0.00392156862745098,
            size: { width: 1024, height: 1024 },
          },
        }),
      ]);
      return { value: { model, processor }, dispose: () => model.dispose?.() };
    }
    case 'upscale':
      return pipe('image-to-image');
    case 'depth':
      return pipe('depth-estimation');
    case 'nsfw': {
      // Sin pipeline: el pipeline de clasificación pide un tokenizer que este repo no tiene
      // (y esa petición fallida rompería el uso sin conexión).
      const [model, processor] = await Promise.all([
        T.AutoModelForImageClassification.from_pretrained(ms.repo, opts),
        T.AutoProcessor.from_pretrained(ms.repo, { progress_callback }),
      ]);
      return { value: { model, processor }, dispose: () => model.dispose?.() };
    }
    case 'segment': {
      const [model, processor] = await Promise.all([
        T.SamModel.from_pretrained(ms.repo, opts),
        T.AutoProcessor.from_pretrained(ms.repo, { progress_callback }),
      ]);
      return { value: { model, processor }, dispose: () => model.dispose?.() };
    }
    case 'caption': {
      const [model, processor] = await Promise.all([
        T.Florence2ForConditionalGeneration.from_pretrained(ms.repo, opts),
        T.AutoProcessor.from_pretrained(ms.repo, { progress_callback }),
      ]);
      return { value: { model, processor }, dispose: () => model.dispose?.() };
    }
    default:
      throw new Error(`El módulo ${id} no usa Transformers.js`);
  }
}

function getTransformersModel(id: ModuleId, key: string, variant: VariantKey, b: BackendInfo): Promise<Any> {
  const spec = getModuleSpec(id);
  const ms = spec.transformers?.find((m) => m.key === key);
  if (!ms) throw new Error(`Modelo ${key} no definido para ${id}`);
  const device = deviceFor(variant, b, ms);
  return getLoaded(`${id}:${key}:${variant}:${device}`, () => loadTransformers(id, ms, variant, b));
}

// ------------------------------------------------------------------ instalación

async function install(id: ModuleId, b: BackendInfo, onProgress: Progress, signal: AbortSignal): Promise<InstallOutcome> {
  const spec = getModuleSpec(id);
  const variant = chooseVariant(b);
  if (spec.engine === 'tesseract') throw new Error('El OCR se instala desde el hilo principal');
  const urls: string[] = [];
  const sharedUrls: string[] = [];
  if (spec.transformers) {
    for (const ms of spec.transformers) {
      throwIfAborted(signal);
      // Cargar = descargar a la caché + comprobar que el modelo abre bien. Luego se libera la memoria.
      const l = await loadTransformers(id, ms, variant, b, onProgress);
      await Promise.resolve(l.dispose()).catch(() => undefined);
    }
    const prefixes = repoPrefixes(spec);
    urls.push(...(await listCacheUrls(TRANSFORMERS_CACHE, (u) => prefixes.some((p) => u.includes(p)))));
    if (urls.length === 0) {
      throw new Error('El navegador no permitió guardar el modelo en la caché (¿modo incógnito o sin espacio?).');
    }
    sharedUrls.push(...(await listCacheUrls(TRANSFORMERS_CACHE, (u) => u.includes('/onnxruntime-web@'))));
  }
  if (spec.files?.length) {
    await ensureOrt(onProgress, signal);
    sharedUrls.push(...runtimeUrls);
  }
  for (const f of spec.files ?? []) {
    throwIfAborted(signal);
    await cachedFetch(f.url, { cacheName: OWN_CACHE, label: f.label, expectedBytes: f.sizeMB * 1e6, onProgress, signal });
    urls.push(f.url);
  }
  return { variant, urls, sharedUrls, bytes: await sumCachedBytes(urls) };
}

// ------------------------------------------------------------------ helpers de imagen

async function toRaw(bmp: ImageBitmap): Promise<{ raw: Any; data: ImageData }> {
  const T = await getTF();
  const data = bitmapToImageData(bmp);
  const raw = new T.RawImage(new Uint8ClampedArray(data.data), data.width, data.height, 4).rgb();
  return { raw, data };
}

function throwIfAborted(signal?: AbortSignal | null) {
  if (signal?.aborted) throw new CancelledError();
}

/** Huella rápida de una imagen (para reutilizar el análisis de SAM con la misma foto). */
function fingerprint(d: ImageData): string {
  let h = 2166136261 >>> 0;
  const step = Math.max(4, Math.floor(d.data.length / 4096 / 4) * 4);
  for (let i = 0; i < d.data.length; i += step) {
    h ^= d.data[i] | (d.data[i + 1] << 8) | (d.data[i + 2] << 16);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `${d.width}x${d.height}:${h.toString(36)}`;
}

// ------------------------------------------------------------------ ejecuciones

async function runRemoveBg(input: RunInputs['remove-bg'], variant: VariantKey, b: BackendInfo): Promise<ImageBitmap> {
  const { model, processor } = await getTransformersModel('remove-bg', 'main', variant, b);
  const T = await getTF();
  const { raw, data } = await toRaw(input.image);
  const { pixel_values } = await processor(raw);
  const inputName: string = model.sessions?.model?.inputNames?.[0] ?? 'input';
  const outputs = await model({ [inputName]: pixel_values });
  let t = outputs.output ?? Object.values(outputs)[0];
  t = t[0]; // [1, H, W]
  const eps = 1e-5;
  if ((t.data as Float32Array).some((x: number) => x < -eps || x > 1 + eps)) t = t.sigmoid();
  const mask = await T.RawImage.fromTensor(t.mul(255).to('uint8')).resize(data.width, data.height);
  const md = mask.data as Uint8Array;
  const mc: number = mask.channels;
  const od = new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
  for (let i = 0, j = 0; i < od.data.length; i += 4, j += mc) od.data[i + 3] = (md[j] * data.data[i + 3]) / 255;
  return createImageBitmap(od);
}

const MAX_OUTPUT_SIDE = 16384;
const MAX_OUTPUT_PIXELS = 120_000_000;

async function runUpscale(input: RunInputs['upscale'], variant: VariantKey, b: BackendInfo, onProgress: Progress, signal: AbortSignal): Promise<ImageBitmap> {
  const s = input.scale === 4 ? 4 : 2;
  const { width: W, height: H } = input.image;
  if (W * s > MAX_OUTPUT_SIDE || H * s > MAX_OUTPUT_SIDE || W * H * s * s > MAX_OUTPUT_PIXELS) {
    throw new Error(`La imagen resultante (${W * s}×${H * s}) sería demasiado grande. Reduce la imagen o usa ×2.`);
  }
  const pipe = await getTransformersModel('upscale', s === 4 ? 'x4' : 'x2', variant, b);
  const T = await getTF();
  const src = bitmapToImageData(input.image);
  const OW = W * s;
  const out = new ImageData(OW, H * s);
  const o = out.data;
  const TILE = deviceFor(variant, b) === 'webgpu' ? 256 : 128;
  const PAD = 16; // solape para evitar costuras entre bloques
  const cols = Math.ceil(W / TILE);
  const rows = Math.ceil(H / TILE);
  const total = cols * rows;
  let done = 0;
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      throwIfAborted(signal);
      const x0 = tx * TILE, y0 = ty * TILE;
      const tw = Math.min(TILE, W - x0), th = Math.min(TILE, H - y0);
      const ex0 = Math.max(0, x0 - PAD), ey0 = Math.max(0, y0 - PAD);
      const ex1 = Math.min(W, x0 + tw + PAD), ey1 = Math.min(H, y0 + th + PAD);
      const ew = ex1 - ex0, eh = ey1 - ey0;
      const tile = new Uint8ClampedArray(ew * eh * 3);
      for (let y = 0; y < eh; y++) {
        let si = ((ey0 + y) * W + ex0) * 4;
        let di = y * ew * 3;
        for (let x = 0; x < ew; x++, si += 4, di += 3) {
          tile[di] = src.data[si]; tile[di + 1] = src.data[si + 1]; tile[di + 2] = src.data[si + 2];
        }
      }
      const res: Any = await pipe(new T.RawImage(tile, ew, eh, 3));
      const rc: number = res.channels;
      const rw: number = res.width;
      const offX = (x0 - ex0) * s, offY = (y0 - ey0) * s;
      for (let y = 0; y < th * s; y++) {
        let si = ((offY + y) * rw + offX) * rc;
        let di = ((y0 * s + y) * OW + x0 * s) * 4;
        for (let x = 0; x < tw * s; x++, si += rc, di += 4) {
          o[di] = res.data[si]; o[di + 1] = res.data[si + 1]; o[di + 2] = res.data[si + 2]; o[di + 3] = 255;
        }
      }
      done++;
      onProgress({ file: 'Ampliando por bloques', loadedBytes: done, totalBytes: total, progress: done / total });
    }
  }
  if (hasTransparency(src)) {
    // El modelo trabaja en RGB: el canal alfa se escala aparte con interpolación de alta calidad.
    const alpha = bitmapToImageData(input.image, OW, H * s);
    for (let i = 3; i < o.length; i += 4) o[i] = alpha.data[i];
  }
  return createImageBitmap(out);
}

async function runDepth(input: RunInputs['depth'], variant: VariantKey, b: BackendInfo): Promise<ImageBitmap> {
  const pipe = await getTransformersModel('depth', 'main', variant, b);
  const { raw } = await toRaw(input.image);
  const res: Any = await pipe(raw);
  const d = res.depth;
  return createImageBitmap(toImageData(d.data, d.width, d.height, d.channels));
}

interface SegCache {
  key: string;
  inputs: Any;
  embeddings: Any;
}
let segCache: SegCache | null = null;

async function runSegment(input: RunInputs['segment'], variant: VariantKey, b: BackendInfo): Promise<SegmentResult> {
  const { model, processor } = await getTransformersModel('segment', 'main', variant, b);
  const T = await getTF();
  if (!input.points?.length) throw new Error('Indica al menos un punto sobre el objeto');
  const { raw, data } = await toRaw(input.image);
  const key = input.imageKey ?? fingerprint(data);
  if (!segCache || segCache.key !== key) {
    const inputs = await processor(raw);
    const embeddings = await model.get_image_embeddings(inputs);
    segCache = { key, inputs, embeddings };
  }
  const { inputs, embeddings } = segCache;
  const [rh, rw] = inputs.reshaped_input_sizes[0] as [number, number];
  const [oh, ow] = inputs.original_sizes[0] as [number, number];
  const pts: SegmentPoint[] = input.points;
  const flat = pts.flatMap((p) => [(p.x / ow) * rw, (p.y / oh) * rh]);
  const input_points = new T.Tensor('float32', new Float32Array(flat), [1, 1, pts.length, 2]);
  const input_labels = new T.Tensor('int64', BigInt64Array.from(pts.map((p) => BigInt(p.label ?? 1))), [1, 1, pts.length]);
  const outputs = await model({ ...embeddings, input_points, input_labels });
  const masks = await processor.post_process_masks(outputs.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
  const scores = outputs.iou_scores.data as Float32Array;
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
  const m = masks[0];
  const [, , H, W] = m.dims as number[];
  const md = m.data as Uint8Array;
  const off = best * H * W;
  const mask = new ImageData(W, H);
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (md[off + y * W + x]) {
        const k = (y * W + x) * 4;
        mask.data[k] = 255; mask.data[k + 1] = 255; mask.data[k + 2] = 255; mask.data[k + 3] = 255;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const bbox = maxX >= 0 ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null;
  const bitmap = await createImageBitmap(mask);
  return { mask, bitmap, score: scores[best] ?? 0, bbox };
}

// --- LaMa (ONNX propio)

interface LamaSession {
  ort: Ort;
  session: OrtNS.InferenceSession;
  ep: 'webgpu' | 'wasm';
}
let lama: Promise<LamaSession> | null = null;

function getLama(spec: ModuleSpec, b: BackendInfo, forceWasm = false): Promise<LamaSession> {
  if (lama && !forceWasm) return lama;
  lama = (async () => {
    const ort = await ensureOrt();
    const url = spec.files![0].url;
    const res = await caches.match(url);
    if (!res) throw new Error('Faltan los archivos del Borrador mágico. Vuelve a descargarlo en el Centro de módulos.');
    const buf = new Uint8Array(await res.arrayBuffer());
    const wantGpu = b.backend === 'webgpu' && !forceWasm;
    if (wantGpu) {
      try {
        const session = await ort.InferenceSession.create(buf, { executionProviders: ['webgpu', 'wasm'], graphOptimizationLevel: 'all' });
        return { ort, session, ep: 'webgpu' as const };
      } catch {
        /* caída a WASM */
      }
    }
    const session = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    return { ort, session, ep: 'wasm' as const };
  })();
  lama.catch(() => {
    lama = null;
  });
  return lama;
}

const LAMA = 512;

async function runInpaint(input: RunInputs['inpaint'], b: BackendInfo, signal: AbortSignal): Promise<ImageBitmap> {
  const spec = getModuleSpec('inpaint');
  const { width: W, height: H } = input.image;
  const img = bitmapToImageData(input.image);
  const msk = bitmapToImageData(input.mask, W, H);
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (msk.data[(y * W + x) * 4 + 3] >= 128) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return createImageBitmap(img); // máscara vacía: nada que borrar

  // Recorte con contexto alrededor de la zona pintada.
  const side = Math.max(LAMA, Math.round(Math.max(x1 - x0 + 1, y1 - y0 + 1) * 1.8));
  const cw = Math.min(side, W), ch = Math.min(side, H);
  const cx = Math.round((x0 + x1) / 2 - cw / 2), cy = Math.round((y0 + y1) / 2 - ch / 2);
  const cx0 = Math.max(0, Math.min(W - cw, cx)), cy0 = Math.max(0, Math.min(H - ch, cy));

  const full = createCanvas(W, H);
  const fctx = ctx2d(full);
  fctx.putImageData(img, 0, 0);
  const maskFull = createCanvas(W, H);
  ctx2d(maskFull).putImageData(msk, 0, 0);

  const c512 = createCanvas(LAMA, LAMA);
  const c512ctx = ctx2d(c512);
  c512ctx.imageSmoothingQuality = 'high';
  c512ctx.drawImage(full as CanvasImageSource, cx0, cy0, cw, ch, 0, 0, LAMA, LAMA);
  const imgCrop = c512ctx.getImageData(0, 0, LAMA, LAMA);
  c512ctx.clearRect(0, 0, LAMA, LAMA);
  c512ctx.drawImage(maskFull as CanvasImageSource, cx0, cy0, cw, ch, 0, 0, LAMA, LAMA);
  const maskCrop = c512ctx.getImageData(0, 0, LAMA, LAMA);

  // Máscara binaria dilatada (LaMa rinde mejor si la zona cubre bien el objeto).
  const N = LAMA * LAMA;
  let bin = new Uint8Array(N);
  for (let i = 0; i < N; i++) bin[i] = maskCrop.data[i * 4 + 3] >= 128 ? 1 : 0;
  const R = 4;
  for (const horizontal of [true, false]) {
    const next = new Uint8Array(N);
    for (let y = 0; y < LAMA; y++) {
      for (let x = 0; x < LAMA; x++) {
        let v = 0;
        for (let d = -R; d <= R && !v; d++) {
          const xx = horizontal ? x + d : x, yy = horizontal ? y : y + d;
          if (xx >= 0 && yy >= 0 && xx < LAMA && yy < LAMA) v = bin[yy * LAMA + xx];
        }
        next[y * LAMA + x] = v;
      }
    }
    bin = next;
  }

  const imageT = new Float32Array(3 * N);
  const maskT = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    imageT[i] = imgCrop.data[i * 4] / 255;
    imageT[N + i] = imgCrop.data[i * 4 + 1] / 255;
    imageT[2 * N + i] = imgCrop.data[i * 4 + 2] / 255;
    maskT[i] = bin[i];
  }
  throwIfAborted(signal);

  const exec = async (s: LamaSession) => {
    const names = s.session.inputNames;
    const maskName = names.find((n) => n.toLowerCase().includes('mask')) ?? names[1];
    const imageName = names.find((n) => n !== maskName) ?? names[0];
    const feeds: Record<string, OrtNS.Tensor> = {
      [imageName]: new s.ort.Tensor('float32', imageT, [1, 3, LAMA, LAMA]),
      [maskName]: new s.ort.Tensor('float32', maskT, [1, 1, LAMA, LAMA]),
    };
    const result = await s.session.run(feeds);
    return result[s.session.outputNames[0]];
  };
  let session = await getLama(spec, b);
  let outT: OrtNS.Tensor;
  try {
    outT = await exec(session);
  } catch (err) {
    if (session.ep !== 'webgpu') throw err;
    session = await getLama(spec, b, true); // reintento en WASM
    outT = await exec(session);
  }
  throwIfAborted(signal);
  const od = outT.data as Float32Array;
  let maxV = 0;
  for (let i = 0; i < od.length; i += 97) maxV = Math.max(maxV, od[i]);
  const mul = maxV <= 1.5 ? 255 : 1; // algunas exportaciones devuelven 0..1, otras 0..255
  const res512 = new ImageData(LAMA, LAMA);
  for (let i = 0; i < N; i++) {
    res512.data[i * 4] = od[i] * mul;
    res512.data[i * 4 + 1] = od[N + i] * mul;
    res512.data[i * 4 + 2] = od[2 * N + i] * mul;
    res512.data[i * 4 + 3] = 255;
  }
  const soft = new ImageData(LAMA, LAMA);
  for (let i = 0; i < N; i++) soft.data[i * 4 + 3] = bin[i] ? 255 : 0;

  const r512 = createCanvas(LAMA, LAMA);
  ctx2d(r512).putImageData(res512, 0, 0);
  const m512 = createCanvas(LAMA, LAMA);
  ctx2d(m512).putImageData(soft, 0, 0);

  const patch = createCanvas(cw, ch);
  const pctx = ctx2d(patch);
  pctx.imageSmoothingQuality = 'high';
  pctx.drawImage(r512 as CanvasImageSource, 0, 0, cw, ch);
  const mfit = createCanvas(cw, ch);
  const mctx = ctx2d(mfit);
  try {
    mctx.filter = `blur(${Math.max(1, Math.round((2 * cw) / LAMA))}px)`; // bordes suaves
  } catch {
    /* sin soporte de filter */
  }
  mctx.drawImage(m512 as CanvasImageSource, 0, 0, cw, ch);
  pctx.globalCompositeOperation = 'destination-in';
  pctx.drawImage(mfit as CanvasImageSource, 0, 0);
  fctx.drawImage(patch as CanvasImageSource, cx0, cy0);
  return createImageBitmap(full as OffscreenCanvas);
}

async function runCaption(input: RunInputs['caption'], variant: VariantKey, b: BackendInfo): Promise<string> {
  const { model, processor } = await getTransformersModel('caption', 'main', variant, b);
  const detail: CaptionDetail = input.detail ?? 'normal';
  const task = detail === 'breve' ? '<CAPTION>' : detail === 'detallada' ? '<MORE_DETAILED_CAPTION>' : '<DETAILED_CAPTION>';
  const { raw } = await toRaw(input.image);
  const inputs = await processor(raw, task);
  const ids = await model.generate({ ...inputs, max_new_tokens: detail === 'breve' ? 48 : 160 });
  const text: string = processor.batch_decode(ids, { skip_special_tokens: false })[0];
  const result = processor.post_process_generation(text, task, raw.size);
  return String(result?.[task] ?? text).replace(/<\/?s>|<pad>/g, '').trim();
}

async function runNsfw(input: RunInputs['nsfw'], variant: VariantKey, b: BackendInfo): Promise<NsfwResult> {
  const { model, processor } = await getTransformersModel('nsfw', 'main', variant, b);
  const T = await getTF();
  const { raw } = await toRaw(input.image);
  const { logits } = await model(await processor(raw));
  const probs: number[] = Array.from(T.softmax(Array.from(logits.data as Float32Array)) as ArrayLike<number>);
  const id2label: Record<string, string> = model.config?.id2label ?? { 0: 'sfw', 1: 'nsfw' };
  const idx = Object.entries(id2label).find(([, l]) => l.toLowerCase() === 'nsfw')?.[0];
  const score = probs[Number(idx ?? 1)] ?? 0;
  return { nsfw: score >= 0.5, score };
}

async function run(id: ModuleId, input: unknown, variant: VariantKey, b: BackendInfo, onProgress: Progress, signal: AbortSignal): Promise<unknown> {
  switch (id) {
    case 'remove-bg': return runRemoveBg(input as RunInputs['remove-bg'], variant, b);
    case 'upscale': return runUpscale(input as RunInputs['upscale'], variant, b, onProgress, signal);
    case 'depth': return runDepth(input as RunInputs['depth'], variant, b);
    case 'segment': return runSegment(input as RunInputs['segment'], variant, b);
    case 'inpaint': return runInpaint(input as RunInputs['inpaint'], b, signal);
    case 'caption': return runCaption(input as RunInputs['caption'], variant, b);
    case 'nsfw': return runNsfw(input as RunInputs['nsfw'], variant, b);
    default: throw new Error(`El módulo ${id} no se ejecuta en el worker`);
  }
}

// ------------------------------------------------------------------ cola y mensajes

const controllers = new Map<number, AbortController>();
let chain: Promise<void> = Promise.resolve();

function post(msg: WorkerResponse, transfer: Transferable[] = []) {
  scope.postMessage(msg, transfer);
}

function transferablesOf(value: unknown): Transferable[] {
  if (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap) return [value];
  if (value && typeof value === 'object' && 'mask' in value && 'bitmap' in value) {
    const v = value as SegmentResult;
    return [v.mask.data.buffer, v.bitmap];
  }
  return [];
}

function friendlyError(id: ModuleId, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const name = getModuleSpec(id).nameEs;
  if (/out of memory|memory access|allocation|Aborted\(\)/i.test(msg)) {
    return `«${name}»: el dispositivo se quedó sin memoria. Prueba con una imagen más pequeña o cierra otras pestañas.`;
  }
  if (/Failed to fetch|NetworkError|network/i.test(msg)) {
    return `«${name}»: no se pudo descargar. Comprueba tu conexión e inténtalo de nuevo.`;
  }
  return `«${name}»: ${msg}`;
}

function enqueue(reqId: number, id: ModuleId, task: (signal: AbortSignal, onProgress: Progress) => Promise<unknown>) {
  const ctl = new AbortController();
  controllers.set(reqId, ctl);
  const onProgress: Progress = (event) => post({ type: 'progress', reqId, event });
  chain = chain.then(async () => {
    try {
      throwIfAborted(ctl.signal);
      currentSignal = ctl.signal;
      const value = await task(ctl.signal, onProgress);
      throwIfAborted(ctl.signal);
      post({ type: 'done', reqId, value }, transferablesOf(value));
    } catch (err) {
      const aborted = ctl.signal.aborted || (err as Error)?.name === 'AbortError';
      post({ type: 'error', reqId, aborted, message: aborted ? 'Operación cancelada' : friendlyError(id, err) });
    } finally {
      currentSignal = null;
      controllers.delete(reqId);
    }
  });
}

scope.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'install':
      enqueue(msg.reqId, msg.id, (signal, onProgress) => install(msg.id, msg.backend, onProgress, signal));
      break;
    case 'run':
      enqueue(msg.reqId, msg.id, (signal, onProgress) => run(msg.id, msg.input, msg.variant, msg.backend, onProgress, signal));
      break;
    case 'abort':
      controllers.get(msg.reqId)?.abort();
      break;
    case 'dispose':
      chain = chain.then(() => disposeModule(msg.id)).catch(() => undefined);
      break;
  }
};
