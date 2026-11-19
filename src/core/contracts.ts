/**
 * CONTRATOS COMPARTIDOS — todos los agentes deben respetar estos tipos.
 * No cambiar firmas sin avisar al agente principal.
 */

/** Imagen/capa raster en memoria. */
export interface Layer {
  id: string;
  name: string;
  kind: 'image' | 'text' | 'adjustment';
  visible: boolean;
  locked: boolean;
  opacity: number;            // 0..1
  blend: GlobalCompositeOperation;
  x: number; y: number;       // posición en el lienzo (px)
  rotation: number;           // grados
  scaleX: number; scaleY: number;
  bitmap?: ImageBitmap;       // para kind=image
  text?: { content: string; font: string; size: number; color: string; align: 'left'|'center'|'right' };
  adjustments: Adjustments;   // ajustes no destructivos por capa
}

export interface Adjustments {
  brightness: number; contrast: number; saturation: number; // -100..100
  exposure: number; temperature: number; tint: number;      // -100..100
  blur: number; sharpen: number; vignette: number;          // 0..100
  grayscale: boolean; sepia: number; hue: number;           // sepia 0..100, hue -180..180
}

export interface DocumentState {
  width: number; height: number;
  layers: Layer[];            // índice 0 = fondo
  activeLayerId: string | null;
}

/** Módulos de IA descargables (Centro de módulos). */
export type ModuleId =
  | 'remove-bg' | 'upscale' | 'depth' | 'segment' | 'inpaint' | 'ocr' | 'caption' | 'nsfw';

export type ModuleStatus = 'not-installed' | 'downloading' | 'installed' | 'error';

export interface ModuleInfo {
  id: ModuleId;
  nameEs: string;
  descriptionEs: string;     // didáctico, 1-2 frases
  sizeMB: number;
  engine: 'transformers.js' | 'onnxruntime-web' | 'tesseract';
  modelRepo: string;         // p.ej. 'briaai/RMBG-1.4'
  tool: string;              // herramienta de UI que habilita
}

/** API que expone cada worker de IA (vía postMessage envuelto). */
export interface ProgressEvent { file: string; loadedBytes: number; totalBytes: number; progress: number }

export interface AiModule<I = unknown, O = unknown> {
  info: ModuleInfo;
  /** Descarga y deja el modelo en caché persistente. */
  install(onProgress: (e: ProgressEvent) => void, signal?: AbortSignal): Promise<void>;
  isInstalled(): Promise<boolean>;
  uninstall(): Promise<void>;
  /** Ejecuta inferencia (en Web Worker; WebGPU con fallback WASM). */
  run(input: I, signal?: AbortSignal): Promise<O>;
}
