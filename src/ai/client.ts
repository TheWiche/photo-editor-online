/**
 * Cliente de IA local (hilo principal). Toda la inferencia corre en src/ai/worker.ts (Web Worker ES);
 * el OCR corre en el worker propio de tesseract.js.
 *
 * API de bajo nivel:   install(id, onProgress, signal) · run(id, input, signal) · uninstall(id) · isInstalled(id)
 * API de alto nivel:   removeBackground · upscale · estimateDepth · segmentPoint · inpaint · ocr · caption · detectNsfw
 * Contrato:            getModule(id) devuelve un AiModule (src/core/contracts.ts).
 */
import type { AiModule, ModuleId, ProgressEvent } from '../core/contracts';
import type {
  BackendInfo,
  CaptionDetail,
  InstallOutcome,
  NsfwResult,
  OcrResult,
  RunInputs,
  RunOutputs,
  SegmentPoint,
  SegmentResult,
  WorkerRequest,
  WorkerResponse,
} from './types';
import { CancelledError, ModuleNotInstalledError } from './types';
import { getModuleInfo, getModuleSpec, MODULE_IDS } from './registry';
import * as store from './cache';
import { getState, setState } from './status';
import { installOcr, runOcr, terminateOcr } from './ocr';
import { confirmDownload } from './downloadGuard';

export type { BackendInfo } from './types';

// ------------------------------------------------------------------ detección de WebGPU

let backendPromise: Promise<BackendInfo> | null = null;

/** Poner localStorage[FORCE_WASM_KEY] = '1' fuerza WASM (útil si la GPU da problemas). */
export const FORCE_WASM_KEY = 'estudio-foto:ia-forzar-wasm';

/** Detecta WebGPU (con fp16 si hay `shader-f16`); si no, WASM. Resultado memorizado. */
export function detectBackend(): Promise<BackendInfo> {
  backendPromise ??= (async (): Promise<BackendInfo> => {
    const wasm = (reasonEs: string): BackendInfo => ({ backend: 'wasm', f16: false, reasonEs });
    try {
      let forced = false;
      try {
        forced = localStorage.getItem(FORCE_WASM_KEY) === '1';
      } catch {
        /* sin localStorage */
      }
      if (forced) return wasm('Se fuerza el modo WebAssembly (CPU) por configuración.');
      const gpu = (navigator as unknown as { gpu?: { requestAdapter(o?: unknown): Promise<unknown> } }).gpu;
      if (!gpu) {
        return wasm('Tu navegador no ofrece WebGPU, así que la IA usará WebAssembly (CPU). Funciona igual, solo que más despacio.');
      }
      const adapter = (await gpu.requestAdapter({ powerPreference: 'high-performance' })) as GPUAdapterLike | null;
      if (!adapter) {
        return wasm('WebGPU existe pero no encontró una tarjeta gráfica compatible; se usará WebAssembly (CPU).');
      }
      const f16 = adapter.features?.has?.('shader-f16') ?? false;
      const info = adapter.info;
      const softwareGpu =
        adapter.isFallbackAdapter === true ||
        info?.isFallbackAdapter === true ||
        /swiftshader|llvmpipe|software/i.test(`${info?.vendor ?? ''} ${info?.architecture ?? ''} ${info?.description ?? ''}`);
      if (softwareGpu) {
        return wasm('La «GPU» disponible es una emulación por software (más lenta que la CPU); se usará WebAssembly.');
      }
      return {
        backend: 'webgpu',
        f16,
        reasonEs: f16
          ? 'Aceleración por tarjeta gráfica (WebGPU) con modelos de media precisión (fp16): rápido y descargas más pequeñas.'
          : 'Aceleración por tarjeta gráfica (WebGPU).',
        adapter: [info?.vendor, info?.architecture, info?.description].filter(Boolean).join(' ') || undefined,
      };
    } catch {
      return wasm('No se pudo inicializar WebGPU; se usará WebAssembly (CPU).');
    }
  })();
  return backendPromise;
}

interface GPUAdapterLike {
  features?: { has(f: string): boolean };
  isFallbackAdapter?: boolean;
  info?: { vendor?: string; architecture?: string; description?: string; isFallbackAdapter?: boolean };
}

// ------------------------------------------------------------------ worker

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  onProgress?: (e: ProgressEvent) => void;
  kind: 'install' | 'run';
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'ia-local' });
  w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
    const msg = ev.data;
    const p = pending.get(msg.reqId);
    if (!p) {
      // Resultado de una tarea cancelada: liberamos los ImageBitmap que lleguen.
      if (msg.type === 'done' && msg.value instanceof ImageBitmap) msg.value.close();
      return;
    }
    if (msg.type === 'progress') p.onProgress?.(msg.event);
    else if (msg.type === 'done') {
      pending.delete(msg.reqId);
      p.resolve(msg.value);
    } else {
      pending.delete(msg.reqId);
      p.reject(msg.aborted ? new CancelledError() : new Error(msg.message));
    }
  };
  w.onerror = (ev) => {
    ev.preventDefault?.();
    killWorker(new Error(`El motor de IA se detuvo inesperadamente${ev.message ? `: ${ev.message}` : ''}. Inténtalo de nuevo.`));
  };
  worker = w;
  return w;
}

function killWorker(reason: Error) {
  worker?.terminate();
  worker = null;
  for (const [, p] of pending) p.reject(reason);
  pending.clear();
}

type Req = WorkerRequest extends infer R ? (R extends { reqId: number } ? Omit<R, 'reqId'> : never) : never;

function call<T>(req: Req, transfer: Transferable[], onProgress?: (e: ProgressEvent) => void, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(new CancelledError());
  const reqId = ++seq;
  const kind = req.type === 'install' ? 'install' : 'run';
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      if (!pending.has(reqId)) return;
      pending.delete(reqId);
      worker?.postMessage({ type: 'abort', reqId } satisfies WorkerRequest);
      reject(new CancelledError());
      // Una inferencia no se puede interrumpir a mitad: si no hay otras tareas, se reinicia el worker.
      if (kind === 'run' && pending.size === 0) killWorker(new CancelledError());
    };
    pending.set(reqId, {
      resolve: (v) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(v as T);
      },
      reject: (e) => {
        signal?.removeEventListener('abort', onAbort);
        reject(e);
      },
      onProgress,
      kind,
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    getWorker().postMessage({ ...req, reqId } as WorkerRequest, transfer);
  });
}

// ------------------------------------------------------------------ estado inicial

let statusInit: Promise<void> | null = null;

/** Verifica contra la caché real qué módulos siguen instalados y actualiza el estado. */
export function refreshInstalled(): Promise<void> {
  statusInit = (async () => {
    const installed = await store.listInstalled().catch(() => [] as store.InstallRecord[]);
    const ids = new Set(installed.map((r) => r.id));
    for (const id of MODULE_IDS) {
      const st = getState(id);
      if (st.status === 'downloading') continue;
      const rec = installed.find((r) => r.id === id);
      if (ids.has(id) && rec) setState(id, { status: 'installed', variant: rec.variant, bytes: rec.bytes }, true);
      else if (st.status !== 'error') setState(id, { status: 'not-installed' }, true);
      else setState(id, { checking: false });
    }
  })();
  return statusInit;
}

export function ensureStatusLoaded(): Promise<void> {
  return statusInit ?? refreshInstalled();
}

// ------------------------------------------------------------------ instalar / desinstalar

const installing = new Map<ModuleId, { promise: Promise<void>; controller: AbortController }>();

export interface InstallOptions {
  /** No mostrar el aviso previo (solo si la UI ya lo confirmó para este módulo). */
  skipConfirm?: boolean;
}

/**
 * Descarga el módulo UNA vez y lo deja guardado (Cache API / IndexedDB). Si ya está instalado y
 * verificado, no descarga nada. `onProgress` recibe eventos por archivo.
 * Antes de descargar muestra el aviso de tamaño/espacio/red (downloadGuard.ts); si el usuario
 * cancela, rechaza con CancelledError('Descarga cancelada').
 */
export function install(id: ModuleId, onProgress?: (e: ProgressEvent) => void, signal?: AbortSignal, opts: InstallOptions = {}): Promise<void> {
  const running = installing.get(id);
  if (running) {
    signal?.addEventListener('abort', () => running.controller.abort(), { once: true });
    return running.promise;
  }
  const controller = new AbortController();
  signal?.addEventListener('abort', () => controller.abort(), { once: true });
  const promise = (async () => {
    if (await store.isInstalled(id)) {
      const rec = store.getRecord(id);
      setState(id, { status: 'installed', variant: rec?.variant, bytes: rec?.bytes }, true);
      return;
    }
    const spec = getModuleSpec(id);
    const backend = await detectBackend();
    if (!opts.skipConfirm && !(await confirmDownload([id], backend))) {
      throw new CancelledError('Descarga cancelada');
    }
    if (controller.signal.aborted) throw new CancelledError('Descarga cancelada');
    void store.requestPersistence();
    const variantGuess = backend.backend === 'webgpu' ? (backend.f16 ? 'webgpu-f16' : 'webgpu') : 'wasm';
    const expected = spec.sizeByVariantMB[variantGuess] * 1e6;
    const files = new Map<string, { loaded: number; total: number }>();
    setState(id, { status: 'downloading', loadedBytes: 0, totalBytes: expected, fraction: 0, file: 'Preparando…', error: undefined, checking: false });
    const progress = (e: ProgressEvent) => {
      files.set(e.file, { loaded: e.loadedBytes, total: Math.max(e.totalBytes, e.loadedBytes) });
      let loaded = 0, total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      const denom = Math.max(total, expected);
      setState(id, { loadedBytes: loaded, totalBytes: denom, fraction: denom ? Math.min(0.999, loaded / denom) : null, file: e.file });
      onProgress?.(e);
    };
    try {
      const outcome: InstallOutcome =
        spec.engine === 'tesseract'
          ? await installOcr(progress, controller.signal)
          : await call<InstallOutcome>({ type: 'install', id, backend }, [], progress, controller.signal);
      const rec = store.saveRecord(id, outcome);
      verified.add(id);
      setState(id, { status: 'installed', variant: rec.variant, bytes: rec.bytes }, true);
    } catch (err) {
      if (controller.signal.aborted || (err as Error).name === 'AbortError') {
        setState(id, { status: 'not-installed' }, true);
        throw new CancelledError('Descarga cancelada');
      }
      setState(id, { status: 'error', error: (err as Error).message }, true);
      throw err;
    }
  })().finally(() => installing.delete(id));
  installing.set(id, { promise, controller });
  return promise;
}

/**
 * Descarga varios módulos mostrando UN solo aviso con el tamaño total (incluido el motor compartido).
 * Rechaza con CancelledError si el usuario cancela.
 */
export async function installMany(ids: ModuleId[], onProgress?: (e: ProgressEvent) => void, signal?: AbortSignal): Promise<void> {
  const missing: ModuleId[] = [];
  for (const id of new Set(ids)) if (!(await store.isInstalled(id))) missing.push(id);
  if (!missing.length) return;
  const backend = await detectBackend();
  if (!(await confirmDownload(missing, backend))) throw new CancelledError('Descarga cancelada');
  for (const id of missing) await install(id, onProgress, signal, { skipConfirm: true });
}

/** Cancela la descarga en curso de un módulo (si la hay). */
export function cancelInstall(id: ModuleId): void {
  installing.get(id)?.controller.abort();
}

/** Borra el módulo del dispositivo (archivos + registro). */
export async function uninstall(id: ModuleId): Promise<void> {
  cancelInstall(id);
  verified.delete(id);
  if (id === 'ocr') await terminateOcr();
  else worker?.postMessage({ type: 'dispose', id } satisfies WorkerRequest);
  await store.remove(id);
  setState(id, { status: 'not-installed' }, true);
}

export function isInstalled(id: ModuleId): Promise<boolean> {
  return store.isInstalled(id);
}

// ------------------------------------------------------------------ ejecutar

const verified = new Set<ModuleId>();

async function requireInstalled(id: ModuleId): Promise<store.InstallRecord> {
  const rec = store.getRecord(id);
  if (rec && (verified.has(id) || (await store.verifyRecord(rec)))) {
    verified.add(id);
    return rec;
  }
  if (getState(id).status === 'installed') setState(id, { status: 'not-installed' }, true);
  throw new ModuleNotInstalledError(id, getModuleSpec(id).nameEs);
}

export interface RunOptions {
  signal?: AbortSignal;
  /** Progreso de la ejecución (p. ej. bloques procesados al ampliar). */
  onProgress?: (e: ProgressEvent) => void;
}

/** Ejecuta un módulo instalado. Las imágenes de entrada se copian: el original sigue siendo válido. */
export async function run<K extends ModuleId>(id: K, input: RunInputs[K], signal?: AbortSignal, onProgress?: (e: ProgressEvent) => void): Promise<RunOutputs[K]> {
  const rec = await requireInstalled(id);
  if (signal?.aborted) throw new CancelledError();
  if (id === 'ocr') return (await runOcr((input as RunInputs['ocr']).image, signal)) as RunOutputs[K];
  const backend = await detectBackend();
  const cloned: Record<string, unknown> = { ...(input as object) };
  const transfer: Transferable[] = [];
  for (const [k, v] of Object.entries(cloned)) {
    if (v instanceof ImageBitmap) {
      const copy = await createImageBitmap(v);
      cloned[k] = copy;
      transfer.push(copy);
    }
  }
  return call<RunOutputs[K]>({ type: 'run', id, backend, variant: rec.variant, input: cloned }, transfer, onProgress, signal);
}

// ------------------------------------------------------------------ AiModule (contrato)

export function getModule<K extends ModuleId>(id: K): AiModule<RunInputs[K], RunOutputs[K]> {
  return {
    info: getModuleInfo(id),
    install: (onProgress, signal) => install(id, onProgress, signal),
    isInstalled: () => isInstalled(id),
    uninstall: () => uninstall(id),
    run: (input, signal) => run(id, input, signal),
  };
}

// ------------------------------------------------------------------ funciones de alto nivel

/** Devuelve la imagen con el fondo transparente (canal alfa = máscara del sujeto). */
export function removeBackground(bitmap: ImageBitmap, opts: RunOptions = {}): Promise<ImageBitmap> {
  return run('remove-bg', { image: bitmap }, opts.signal, opts.onProgress);
}

/** Superresolución ×2 o ×4. */
export function upscale(bitmap: ImageBitmap, scale: 2 | 4 = 2, opts: RunOptions = {}): Promise<ImageBitmap> {
  return run('upscale', { image: bitmap, scale }, opts.signal, opts.onProgress);
}

/** Mapa de profundidad en grises del mismo tamaño (claro = cerca). */
export function estimateDepth(bitmap: ImageBitmap, opts: RunOptions = {}): Promise<ImageBitmap> {
  return run('depth', { image: bitmap }, opts.signal, opts.onProgress);
}

/**
 * Máscara del objeto bajo el punto (o puntos, con label 1 = incluir / 0 = excluir).
 * Pasa `imageKey` (p. ej. id de capa + versión) para reutilizar el análisis entre clics.
 */
export function segmentPoint(
  bitmap: ImageBitmap,
  point: { x: number; y: number } | SegmentPoint[],
  opts: RunOptions & { imageKey?: string } = {},
): Promise<SegmentResult> {
  const points = Array.isArray(point) ? point : [{ ...point, label: 1 as const }];
  return run('segment', { image: bitmap, points, imageKey: opts.imageKey }, opts.signal, opts.onProgress);
}

/** Borra la zona marcada en `mask` (alfa >= 128) y la rellena imitando el entorno. */
export async function inpaint(bitmap: ImageBitmap, mask: ImageBitmap | ImageData, opts: RunOptions = {}): Promise<ImageBitmap> {
  const maskBmp = mask instanceof ImageData ? await createImageBitmap(mask) : mask;
  return run('inpaint', { image: bitmap, mask: maskBmp }, opts.signal, opts.onProgress);
}

/** Reconoce texto (español + inglés) con posiciones por palabra. */
export function ocr(bitmap: ImageBitmap, opts: RunOptions = {}): Promise<OcrResult> {
  return run('ocr', { image: bitmap }, opts.signal);
}

/** Descripción automática de la imagen (en inglés). */
export function caption(bitmap: ImageBitmap, opts: RunOptions & { detail?: CaptionDetail } = {}): Promise<string> {
  return run('caption', { image: bitmap, detail: opts.detail }, opts.signal, opts.onProgress);
}

/** Probabilidad de contenido sensible. */
export function detectNsfw(bitmap: ImageBitmap, opts: RunOptions = {}): Promise<NsfwResult> {
  return run('nsfw', { image: bitmap }, opts.signal, opts.onProgress);
}

export { estimate, listInstalled, requestPersistence, isPersisted } from './cache';
export { CancelledError, ModuleNotInstalledError } from './types';
