/** Exportación avanzada: AVIF (con detección), PDF de una o varias páginas, guardado directo a disco y control de metadatos. */
import { create } from 'zustand';
import type { DocumentState } from '../core/contracts';
import { downloadBlob, sanitizeFileName } from '../core/export';
import { canvasToBlob, createCanvas, flattenDocument } from '../core/render';
import { useEditor } from '../core/store';
import { t } from '../i18n';
import { getSourceInfo } from './docState';
import { buildCleanExifSegment, injectJpegSegment } from './exif';
import { saveToDisk } from './fsAccess';
import { buildPdf, type PdfSize } from './pdf';
import { thumbDataUrl } from './snapshot';

export type AdvFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'pdf';

export const FORMATS: Record<AdvFormat, { mime: string; ext: string; label: string; lossy: boolean }> = {
  jpeg: { mime: 'image/jpeg', ext: 'jpg', label: 'JPG', lossy: true },
  png: { mime: 'image/png', ext: 'png', label: 'PNG', lossy: false },
  webp: { mime: 'image/webp', ext: 'webp', label: 'WebP', lossy: true },
  avif: { mime: 'image/avif', ext: 'avif', label: 'AVIF', lossy: true },
  pdf: { mime: 'application/pdf', ext: 'pdf', label: 'PDF', lossy: true },
};

let avifOk: Promise<boolean> | null = null;
/** ¿Sabe este navegador codificar AVIF desde un canvas? (Chrome/Edge y Safari recientes; Firefox no). */
export function avifSupported(): Promise<boolean> {
  if (!avifOk) {
    avifOk = canvasToBlob(createCanvas(2, 2), 'image/avif', 0.5).then((b) => b.type === 'image/avif').catch(() => false);
  }
  return avifOk;
}

/* ------------------------------------------------------------ páginas de PDF */

export interface PdfPageItem { id: string; label: string; jpeg: Blob; width: number; height: number; thumb: string }
interface PdfStore { pages: PdfPageItem[]; add(p: PdfPageItem[]): void; remove(id: string): void; move(id: string, dir: -1 | 1): void; clear(): void }
export const usePdfPages = create<PdfStore>()((set, get) => ({
  pages: [],
  add: (p) => set({ pages: [...get().pages, ...p] }),
  remove: (id) => set({ pages: get().pages.filter((x) => x.id !== id) }),
  move: (id, dir) => {
    const a = get().pages.slice();
    const i = a.findIndex((x) => x.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    set({ pages: a });
  },
  clear: () => set({ pages: [] }),
}));

let pageCounter = 0;
const PDF_MAX_SIDE = 4096;

async function pageFrom(doc: DocumentState, masks: ReturnType<typeof useEditor.getState>['masks'], label: string): Promise<PdfPageItem> {
  const scale = Math.min(1, PDF_MAX_SIDE / Math.max(doc.width, doc.height));
  const canvas = flattenDocument(doc, masks, { scale, background: '#ffffff' });
  const jpeg = await canvasToBlob(canvas, 'image/jpeg', 0.92);
  return { id: `pg${++pageCounter}`, label, jpeg, width: canvas.width, height: canvas.height, thumb: thumbDataUrl({ doc, masks }, 80) };
}

/** Añade la imagen actual como página. */
export async function addCurrentPage(): Promise<void> {
  const { doc, masks, fileName } = useEditor.getState();
  if (!doc) return;
  usePdfPages.getState().add([await pageFrom(doc, masks, `${fileName} · ${usePdfPages.getState().pages.length + 1}`)]);
}

/** Una página por cada capa visible (cada una sola, sobre fondo blanco). */
export async function addLayerPages(): Promise<void> {
  const { doc, masks } = useEditor.getState();
  if (!doc) return;
  const list: PdfPageItem[] = [];
  for (const l of doc.layers.filter((x) => x.visible)) {
    list.push(await pageFrom({ ...doc, layers: [{ ...l, opacity: 1, blend: 'source-over' }] }, masks, l.name));
  }
  usePdfPages.getState().add(list);
}

/* ---------------------------------------------------------------- exportar */

export interface AdvExportOptions {
  format: AdvFormat;
  quality: number;          // 0..1
  scale: number;            // 0.1..4
  fileName: string;
  background: string;       // para formatos sin transparencia
  stripMetadata: boolean;
  toDisk: boolean;          // File System Access cuando exista
  pdf: { size: PdfSize };
}

export interface AdvExportResult { fileName: string; size: number; via: 'saved' | 'downloaded' | 'cancelled'; fallbackFrom?: AdvFormat }

export async function renderAdvanced(o: AdvExportOptions): Promise<{ blob: Blob; ext: string; format: AdvFormat; fallbackFrom?: AdvFormat }> {
  const { doc, masks } = useEditor.getState();
  if (!doc) throw new Error(t('err.noDoc'));
  let format = o.format;
  let fallbackFrom: AdvFormat | undefined;

  if (format === 'pdf') {
    const pages = usePdfPages.getState().pages;
    const list = pages.length ? pages : [await pageFrom(doc, masks, o.fileName)];
    const blob = await buildPdf(list, { size: o.pdf.size, title: o.fileName });
    return { blob, ext: 'pdf', format };
  }
  if (format === 'avif' && !(await avifSupported())) { fallbackFrom = 'avif'; format = 'webp'; }

  const info = FORMATS[format];
  const scale = Math.min(4, Math.max(0.05, o.scale));
  const alpha = format !== 'jpeg';
  const canvas = flattenDocument(doc, masks, { scale, background: alpha ? null : o.background });
  let blob = await canvasToBlob(canvas, info.mime, format === 'png' ? undefined : o.quality);
  if (blob.type !== info.mime) {
    if (format === 'webp') { fallbackFrom ??= 'webp'; format = 'png'; blob = await canvasToBlob(canvas, 'image/png'); }
    else throw new Error(t('err.encode', { format: info.label }));
  }
  // Re-codificar con canvas ya elimina EXIF/GPS/XMP. Sólo si el usuario lo pide se añade un EXIF mínimo y seguro (JPG).
  if (format === 'jpeg' && !o.stripMetadata) {
    const keep = getSourceInfo()?.keep;
    const seg = keep ? buildCleanExifSegment(keep) : null;
    if (seg) blob = await injectJpegSegment(blob, seg);
  }
  return { blob, ext: FORMATS[format].ext, format, fallbackFrom };
}

export async function exportAdvanced(o: AdvExportOptions): Promise<AdvExportResult> {
  const r = await renderAdvanced(o);
  const fileName = `${sanitizeFileName(o.fileName)}.${r.ext}`;
  const f = FORMATS[r.format];
  if (o.toDisk) {
    const s = await saveToDisk(r.blob, fileName, { types: [{ description: f.label, accept: { [f.mime]: [`.${f.ext}`] } }], id: 'estudio-export' });
    return { fileName: s.handle?.name ?? fileName, size: r.blob.size, via: s.result, fallbackFrom: r.fallbackFrom };
  }
  downloadBlob(r.blob, fileName);
  return { fileName, size: r.blob.size, via: 'downloaded', fallbackFrom: r.fallbackFrom };
}
