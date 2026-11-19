import { canvasToBlob, flattenDocument } from './render';
import { useEditor } from './store';

export type ExportFormat = 'png' | 'jpeg' | 'webp';

export interface ExportOptions {
  format: ExportFormat;
  /** 0..1 (sólo JPG/WebP). */
  quality: number;
  /** Escala respecto al tamaño del documento (0.1..4). */
  scale: number;
  fileName: string;
  /** Fondo para formatos sin transparencia (JPG). */
  background?: string;
}

export const FORMAT_INFO: Record<ExportFormat, { label: string; mime: string; ext: string; alpha: boolean; hint: string }> = {
  png: { label: 'PNG', mime: 'image/png', ext: 'png', alpha: true, hint: 'Sin pérdida y con transparencia. Ideal para gráficos, texto y recortes.' },
  jpeg: { label: 'JPG', mime: 'image/jpeg', ext: 'jpg', alpha: false, hint: 'Archivos ligeros para fotos. No guarda transparencia (se rellena con el fondo).' },
  webp: { label: 'WebP', mime: 'image/webp', ext: 'webp', alpha: true, hint: 'Formato moderno: más ligero que JPG con calidad similar y admite transparencia.' },
};

export function sanitizeFileName(name: string): string {
  return (name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\.(png|jpe?g|webp)$/i, '') || 'imagen').slice(0, 120);
}

/** Genera el Blob final del documento actual. */
export async function renderExport(opts: Pick<ExportOptions, 'format' | 'quality' | 'scale' | 'background'>): Promise<Blob> {
  const { doc, masks } = useEditor.getState();
  if (!doc) throw new Error('No hay ningún documento abierto');
  const info = FORMAT_INFO[opts.format];
  const scale = Math.min(4, Math.max(0.05, opts.scale));
  const canvas = flattenDocument(doc, masks, { scale, background: info.alpha ? null : (opts.background ?? '#ffffff') });
  const blob = await canvasToBlob(canvas, info.mime, info.alpha && opts.format === 'png' ? undefined : opts.quality);
  if (opts.format !== 'png' && blob.type !== info.mime) {
    throw new Error(`Tu navegador no puede codificar ${info.label}. Prueba con PNG.`);
  }
  return blob;
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function exportImage(opts: ExportOptions): Promise<{ blob: Blob; fileName: string }> {
  const blob = await renderExport(opts);
  const fileName = `${sanitizeFileName(opts.fileName)}.${FORMAT_INFO[opts.format].ext}`;
  downloadBlob(blob, fileName);
  return { blob, fileName };
}

export function canCopyImage(): boolean {
  return typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write;
}

/** Copia la imagen (PNG) al portapapeles. */
export async function copyToClipboard(scale = 1): Promise<void> {
  if (!canCopyImage()) throw new Error('Tu navegador no permite copiar imágenes al portapapeles');
  // Se pasa una promesa para conservar la «activación de usuario» en Safari.
  const item = new ClipboardItem({ 'image/png': renderExport({ format: 'png', quality: 1, scale }) });
  await navigator.clipboard.write([item]);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
