/**
 * Serialización de proyectos: documento (capas, máscaras, ajustes, texto, tamaño) <-> ProjectBundle (JSON + blobs PNG)
 * y contenedor de archivo «.estudio»:
 *
 *   'ESTUDIO1' (8 bytes) | u32 LE longitud del JSON | JSON utf-8 {json, blobs:[{key,type,size}]} | blobs concatenados
 */
import type { DocumentState, Layer } from '../core/contracts';
import { createLayer } from '../core/defaults';
import { canvasToBlob, createCanvas, ctx2d, type Masks } from '../core/render';
import type { PhotoMeta } from './exif';
import { renderSnapshot, fitScale } from './snapshot';

export const PROJECT_EXT = '.estudio';
export const PROJECT_MIME = 'application/x-estudio';
const MAGIC = 'ESTUDIO1';
const MAX_SIDE = 16384;

export type SerializedLayer = Omit<Layer, 'bitmap'> & { bitmap?: string };

export interface ProjectJSON {
  format: 'estudio-foto';
  version: 1;
  name: string;
  createdAt: number;
  updatedAt: number;
  doc: { width: number; height: number; activeLayerId: string | null; layers: SerializedLayer[] };
  masks: Record<string, string>;
  /** Resumen de metadatos de la foto original (sólo para el panel «Privacidad»). */
  source?: PhotoMeta;
}

export interface ProjectBundle { json: ProjectJSON; blobs: Record<string, Blob> }

/* ------------------------------------------------------------------ bitmaps */

const blobCache = new WeakMap<ImageBitmap, Promise<Blob>>();

/** ImageBitmap -> PNG (con caché: lo que no cambia no se vuelve a codificar en cada autoguardado). */
export function bitmapToBlob(bmp: ImageBitmap): Promise<Blob> {
  let p = blobCache.get(bmp);
  if (!p) {
    const c = createCanvas(bmp.width, bmp.height);
    ctx2d(c).drawImage(bmp, 0, 0);
    p = canvasToBlob(c, 'image/png');
    blobCache.set(bmp, p);
    p.catch(() => blobCache.delete(bmp));
  }
  return p;
}

export async function serializeSnapshot(
  doc: DocumentState, masks: Masks, name: string, extra: { createdAt?: number; source?: PhotoMeta | null } = {},
): Promise<ProjectBundle> {
  const blobs: Record<string, Blob> = {};
  const keys = new Map<ImageBitmap, string>();
  const keyFor = async (bmp: ImageBitmap) => {
    let k = keys.get(bmp);
    if (!k) { k = `b${keys.size}`; keys.set(bmp, k); blobs[k] = await bitmapToBlob(bmp); }
    return k;
  };
  const layers: SerializedLayer[] = [];
  for (const l of doc.layers) {
    const { bitmap, ...rest } = l;
    layers.push({ ...rest, adjustments: { ...l.adjustments }, text: l.text ? { ...l.text } : undefined, ...(bitmap ? { bitmap: await keyFor(bitmap) } : {}) });
  }
  const m: Record<string, string> = {};
  for (const [id, bmp] of Object.entries(masks)) if (bmp && doc.layers.some((l) => l.id === id)) m[id] = await keyFor(bmp);
  const now = Date.now();
  return {
    json: {
      format: 'estudio-foto', version: 1, name, createdAt: extra.createdAt ?? now, updatedAt: now,
      doc: { width: doc.width, height: doc.height, activeLayerId: doc.activeLayerId, layers }, masks: m,
      ...(extra.source ? { source: extra.source } : {}),
    },
    blobs,
  };
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const BLENDS = new Set<string>(['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']);

export async function deserializeBundle(b: ProjectBundle): Promise<{ doc: DocumentState; masks: Masks; name: string; source?: PhotoMeta }> {
  const j = b.json;
  if (!j || j.format !== 'estudio-foto' || !j.doc || !Array.isArray(j.doc.layers)) throw new Error('bad-project');
  const width = Math.round(num(j.doc.width, 0)), height = Math.round(num(j.doc.height, 0));
  if (width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE) throw new Error('bad-project');
  const bitmaps = new Map<string, ImageBitmap>();
  const bmp = async (key: string | undefined) => {
    if (!key || !b.blobs[key]) return undefined;
    let v = bitmaps.get(key);
    if (!v) { v = await createImageBitmap(b.blobs[key]); bitmaps.set(key, v); }
    return v;
  };
  const layers: Layer[] = [];
  for (const raw of j.doc.layers) {
    const kind = raw.kind === 'text' || raw.kind === 'adjustment' ? raw.kind : 'image';
    const text = raw.text && typeof raw.text.content === 'string'
      ? { content: raw.text.content, font: String(raw.text.font), size: Math.max(1, num(raw.text.size, 32)), color: String(raw.text.color), align: raw.text.align === 'center' || raw.text.align === 'right' ? raw.text.align : 'left' as const }
      : undefined;
    layers.push(createLayer({
      id: String(raw.id), name: String(raw.name ?? 'Capa'), kind,
      visible: raw.visible !== false, locked: !!raw.locked,
      opacity: Math.min(1, Math.max(0, num(raw.opacity, 1))),
      blend: BLENDS.has(raw.blend) ? raw.blend : 'source-over',
      x: num(raw.x, 0), y: num(raw.y, 0), rotation: num(raw.rotation, 0), scaleX: num(raw.scaleX, 1), scaleY: num(raw.scaleY, 1),
      bitmap: await bmp(raw.bitmap), text, adjustments: { ...(raw.adjustments ?? {}) },
    }));
  }
  const masks: Masks = {};
  for (const [id, key] of Object.entries(j.masks ?? {})) { const m = await bmp(key); if (m && layers.some((l) => l.id === id)) masks[id] = m; }
  const active = layers.some((l) => l.id === j.doc.activeLayerId) ? j.doc.activeLayerId : (layers[layers.length - 1]?.id ?? null);
  return { doc: { width, height, layers, activeLayerId: active }, masks, name: String(j.name || 'sin-titulo'), source: j.source };
}

/** Miniatura JPEG del proyecto (para «Mis proyectos»). */
export async function makeThumbBlob(doc: DocumentState, masks: Masks, maxDim = 360): Promise<Blob> {
  const c = renderSnapshot({ doc, masks }, fitScale(doc, maxDim), { background: '#22252d' });
  return canvasToBlob(c, 'image/jpeg', 0.8);
}

/* --------------------------------------------------------- archivo .estudio */

export function encodeEstudio(b: ProjectBundle, thumb?: Blob): Blob {
  const all: Record<string, Blob> = { ...b.blobs };
  if (thumb) all.__thumb = thumb;
  const list = Object.entries(all).map(([key, blob]) => ({ key, type: blob.type, size: blob.size }));
  const head = new TextEncoder().encode(JSON.stringify({ json: b.json, blobs: list }));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, head.length, true);
  return new Blob([MAGIC, len, head, ...Object.values(all)], { type: PROJECT_MIME });
}

export async function decodeEstudio(file: Blob): Promise<{ bundle: ProjectBundle; thumb?: Blob }> {
  const top = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (String.fromCharCode(...top.subarray(0, 8)) !== MAGIC) throw new Error('bad-file');
  const hl = new DataView(top.buffer).getUint32(8, true);
  if (hl <= 0 || 12 + hl > file.size) throw new Error('bad-file');
  const header = JSON.parse(await file.slice(12, 12 + hl).text()) as { json: ProjectJSON; blobs: { key: string; type: string; size: number }[] };
  let off = 12 + hl;
  const blobs: Record<string, Blob> = {};
  for (const e of header.blobs) {
    if (!e || typeof e.size !== 'number' || e.size < 0 || off + e.size > file.size) throw new Error('bad-file');
    blobs[e.key] = file.slice(off, off + e.size, e.type);
    off += e.size;
  }
  const thumb = blobs.__thumb;
  delete blobs.__thumb;
  return { bundle: { json: header.json, blobs }, thumb };
}
