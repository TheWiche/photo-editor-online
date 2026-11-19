/** Procesamiento por lotes: receta (tamaño, formato, ajustes, marca de agua) → carpeta o .zip. */
import { createCanvas, ctx2d, clamp, type AnyCanvas } from './util';
import { canvasToBlob, renderAdjusted } from '../core/render';
import { decodeImage, stripExtension } from '../core/image';
import { defaultAdjustments } from '../core/defaults';
import { drawWatermark, type WatermarkOptions } from './watermark';
import { ZipWriter } from './zip';

export type ResizeMode = 'none' | 'maxside' | 'width' | 'height' | 'percent';
export type OutFormat = 'keep' | 'jpeg' | 'png' | 'webp';

export interface Recipe {
  resizeMode: ResizeMode; resizeValue: number;
  format: OutFormat; quality: number;       // 0.3..1
  brightness: number; contrast: number; saturation: number; // -100..100
  watermark: boolean; wm: WatermarkOptions;
  /** Reprocesar siempre (se pierden los metadatos EXIF/GPS). Si es false y no hay cambios, se copia el original. */
  stripMetadata: boolean;
  suffix: string;
}

export const MIME: Record<Exclude<OutFormat, 'keep'>, { mime: string; ext: string }> = {
  jpeg: { mime: 'image/jpeg', ext: 'jpg' }, png: { mime: 'image/png', ext: 'png' }, webp: { mime: 'image/webp', ext: 'webp' },
};

export const hasFolderPicker = () => typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';

export interface BatchResult { ok: number; failed: { name: string; error: string }[]; mode: 'folder' | 'zip'; bytes: number; cancelled: boolean }

function targetSize(w: number, h: number, r: Recipe): [number, number] {
  const v = Math.max(1, r.resizeValue);
  let s = 1;
  if (r.resizeMode === 'maxside') s = v / Math.max(w, h);
  else if (r.resizeMode === 'width') s = v / w;
  else if (r.resizeMode === 'height') s = v / h;
  else if (r.resizeMode === 'percent') s = v / 100;
  if (r.resizeMode !== "none" && r.resizeMode !== "percent") s = Math.min(s, 1); // sin ampliar
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
}

function isNoop(r: Recipe) {
  return r.resizeMode === 'none' && !r.brightness && !r.contrast && !r.saturation && !r.watermark && r.format === 'keep';
}

function outFormatFor(file: File, r: Recipe): Exclude<OutFormat, 'keep'> {
  if (r.format !== 'keep') return r.format;
  if (file.type === 'image/jpeg') return 'jpeg';
  if (file.type === 'image/webp') return 'webp';
  return 'png';
}

/** Procesa una imagen y devuelve el Blob resultante. */
export async function processOne(file: File, r: Recipe): Promise<{ blob: Blob; ext: string }> {
  const fmt = outFormatFor(file, r);
  if (!r.stripMetadata && isNoop(r)) return { blob: file, ext: file.name.split('.').pop() ?? MIME[fmt].ext };
  const bmp = await decodeImage(file, 8192);
  try {
    const [w, h] = targetSize(bmp.width, bmp.height, r);
    const adj = defaultAdjustments();
    adj.brightness = r.brightness; adj.contrast = r.contrast; adj.saturation = r.saturation;
    const hasAdj = !!(r.brightness || r.contrast || r.saturation);
    let canvas: AnyCanvas;
    if (hasAdj) {
      canvas = renderAdjusted(bmp, w, h, adj);
    } else {
      canvas = createCanvas(w, h);
      const c = ctx2d(canvas); c.imageSmoothingQuality = 'high'; c.drawImage(bmp, 0, 0, w, h);
    }
    if (fmt === 'jpeg') { // JPG no admite transparencia: fondo blanco
      const flat = createCanvas(w, h); const fc = ctx2d(flat);
      fc.fillStyle = '#fff'; fc.fillRect(0, 0, w, h); fc.drawImage(canvas as CanvasImageSource, 0, 0);
      canvas = flat;
    }
    if (r.watermark) drawWatermark(ctx2d(canvas), w, h, r.wm);
    const blob = await canvasToBlob(canvas, MIME[fmt].mime, fmt === 'png' ? undefined : clamp(r.quality, 0.3, 1));
    if (blob.type !== MIME[fmt].mime) throw new Error(`El navegador no puede codificar ${fmt.toUpperCase()}`);
    return { blob, ext: MIME[fmt].ext };
  } finally { bmp.close(); }
}

const tick = () => new Promise<void>((res) => setTimeout(res, 0));

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Ejecuta el lote. `dir`: carpeta elegida (File System Access) o null para generar un .zip.
 * Debe llamarse tras elegir la carpeta (el selector exige un gesto del usuario).
 */
export async function runBatch(
  files: File[], r: Recipe, dir: FileSystemDirectoryHandle | null,
  onProgress: (done: number, total: number, current: string) => void, signal: AbortSignal,
): Promise<BatchResult> {
  const res: BatchResult = { ok: 0, failed: [], mode: dir ? 'folder' : 'zip', bytes: 0, cancelled: false };
  const zip = dir ? null : new ZipWriter();
  const used = new Set<string>();
  for (let i = 0; i < files.length; i++) {
    if (signal.aborted) { res.cancelled = true; break; }
    const f = files[i];
    onProgress(i, files.length, f.name);
    await tick();
    try {
      const { blob, ext } = await processOne(f, r);
      let name = `${stripExtension(f.name)}${r.suffix}.${ext}`;
      for (let n = 2; used.has(name.toLowerCase()); n++) name = `${stripExtension(f.name)}${r.suffix}-${n}.${ext}`;
      used.add(name.toLowerCase());
      if (dir) {
        const fh = await dir.getFileHandle(name, { create: true });
        const w = await (fh as FileSystemFileHandle).createWritable();
        await w.write(blob); await w.close();
      } else await zip!.add(name, blob);
      res.ok++; res.bytes += blob.size;
    } catch (e) {
      res.failed.push({ name: f.name, error: e instanceof Error ? e.message : String(e) });
    }
  }
  onProgress(files.length, files.length, '');
  if (zip && res.ok > 0) {
    const out = zip.finish();
    download(out, `lote-${new Date().toISOString().slice(0, 10)}.zip`);
  }
  return res;
}
