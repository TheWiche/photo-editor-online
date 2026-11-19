/**
 * Tipos compartidos de la capa de IA local (hilo principal + Web Worker).
 * Respeta src/core/contracts.ts (ModuleId, ModuleInfo, ProgressEvent, AiModule).
 */
import type { ModuleId, ProgressEvent } from '../core/contracts';

/** Motor de ejecución detectado en el dispositivo. */
export type Backend = 'webgpu' | 'wasm';

export interface BackendInfo {
  backend: Backend;
  /** WebGPU con soporte de `shader-f16` (permite modelos fp16, más ligeros). */
  f16: boolean;
  /** Texto explicativo para la UI (p. ej. por qué se usa WASM). */
  reasonEs: string;
  /** Nombre del adaptador GPU si el navegador lo expone. */
  adapter?: string;
}

/**
 * Variante de pesos descargada. Se decide UNA vez al instalar (según el equipo)
 * y se guarda en el registro de instalación para no volver a descargar otra variante.
 */
export type VariantKey = 'webgpu-f16' | 'webgpu' | 'wasm';

// ---------------------------------------------------------------- entradas/salidas

export interface SegmentPoint {
  /** Coordenadas en píxeles de la imagen de entrada. */
  x: number;
  y: number;
  /** 1 = forma parte del objeto, 0 = no forma parte. Por defecto 1. */
  label?: 0 | 1;
}

export interface SegmentResult {
  /** Máscara del tamaño de la imagen: blanco opaco dentro del objeto, transparente fuera. */
  mask: ImageData;
  /** La misma máscara como ImageBitmap, lista para dibujar. */
  bitmap: ImageBitmap;
  /** Confianza estimada del modelo (0..1). */
  score: number;
  /** Rectángulo que contiene la máscara (px). null si quedó vacía. */
  bbox: { x: number; y: number; width: number; height: number } | null;
}

export interface OcrWord {
  text: string;
  confidence: number; // 0..100
  bbox: { x: number; y: number; width: number; height: number };
}

export interface OcrResult {
  text: string;
  confidence: number; // 0..100
  words: OcrWord[];
}

export interface NsfwResult {
  nsfw: boolean;
  /** Probabilidad de contenido sensible (0..1). */
  score: number;
}

export type CaptionDetail = 'breve' | 'normal' | 'detallada';

/** Entradas de `run(id, input)` por módulo. */
export interface RunInputs {
  'remove-bg': { image: ImageBitmap };
  upscale: { image: ImageBitmap; scale: 2 | 4 };
  depth: { image: ImageBitmap };
  segment: { image: ImageBitmap; points: SegmentPoint[]; /** clave para reutilizar el análisis de la misma imagen */ imageKey?: string };
  /** mask: píxeles con alfa >= 128 se consideran «a borrar». Mismo tamaño que la imagen (si no, se escala). */
  inpaint: { image: ImageBitmap; mask: ImageBitmap };
  ocr: { image: ImageBitmap };
  caption: { image: ImageBitmap; detail?: CaptionDetail };
  nsfw: { image: ImageBitmap };
}

/** Salidas de `run(id, input)` por módulo. */
export interface RunOutputs {
  'remove-bg': ImageBitmap;
  upscale: ImageBitmap;
  depth: ImageBitmap;
  segment: SegmentResult;
  inpaint: ImageBitmap;
  ocr: OcrResult;
  caption: string;
  nsfw: NsfwResult;
}

/** Resultado de una instalación hecha por el worker o por el cargador de OCR. */
export interface InstallOutcome {
  variant: VariantKey;
  /** URLs propias del módulo guardadas en Cache API (para verificar y borrar). */
  urls: string[];
  /** URLs compartidas entre módulos (motor ONNX Runtime). */
  sharedUrls?: string[];
  /** Claves de IndexedDB (db/store/key) usadas por el módulo (OCR). */
  idbKeys?: string[];
  /** Bytes de los archivos propios (sin contar los compartidos). */
  bytes: number;
}

// ---------------------------------------------------------------- protocolo worker

export type WorkerRequest =
  | { type: 'install'; reqId: number; id: ModuleId; backend: BackendInfo }
  | { type: 'run'; reqId: number; id: ModuleId; backend: BackendInfo; variant: VariantKey; input: unknown }
  | { type: 'abort'; reqId: number }
  | { type: 'dispose'; id: ModuleId };

export type WorkerResponse =
  | { type: 'progress'; reqId: number; event: ProgressEvent }
  | { type: 'done'; reqId: number; value: unknown }
  | { type: 'error'; reqId: number; message: string; aborted?: boolean };

/** Error lanzado cuando se intenta usar un módulo que no está descargado. */
export class ModuleNotInstalledError extends Error {
  readonly moduleId: ModuleId;
  constructor(id: ModuleId, nameEs: string) {
    super(`El módulo «${nameEs}» no está instalado. Descárgalo desde el Centro de módulos.`);
    this.name = 'ModuleNotInstalledError';
    this.moduleId = id;
  }
}

/** Error de cancelación (equivalente a AbortError). */
export class CancelledError extends Error {
  constructor(message = 'Operación cancelada') {
    super(message);
    this.name = 'AbortError';
  }
}
