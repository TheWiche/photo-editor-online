/**
 * Lector de metadatos propio (JPEG, PNG, WebP): EXIF (cámara, fecha, GPS, software), XMP, ICC, IPTC y textos PNG.
 * No depende de librerías. Sólo lee; nunca modifica el archivo original.
 *
 * También sabe reconstruir un EXIF mínimo y seguro (sin GPS, sin miniatura, orientación normal) para el
 * caso en que el usuario desactive «Quitar metadatos» al exportar a JPG.
 */
import type { DictKey } from '../i18n';

export interface MetaItem {
  group: 'camera' | 'capture' | 'software' | 'location' | 'personal' | 'other';
  labelKey: DictKey;
  value: string;
  /** Dato que identifica a la persona o al lugar (se resalta en el panel). */
  sensitive?: boolean;
}

export interface PhotoMeta {
  format: 'jpeg' | 'png' | 'webp' | 'other';
  bytes: number;
  items: MetaItem[];
  gps?: { lat: number; lon: number; alt?: number };
  flags: { exif: boolean; xmp: boolean; icc: boolean; iptc: boolean; text: boolean; thumbnail: boolean };
}

type Decoded = { type: number; vals: (number | string)[] };
type Tags = Map<number, Decoded>;
interface ExifParsed { ifd0: Tags; exif: Tags; gps: Tags; hasThumb: boolean }

/** Datos reutilizables para reescribir un EXIF limpio al exportar. */
export interface KeepableExif { ifd0: Tags; exif: Tags }

export interface PhotoInfo { meta: PhotoMeta; keep?: KeepableExif }

const EMPTY_FLAGS = (): PhotoMeta['flags'] => ({ exif: false, xmp: false, icc: false, iptc: false, text: false, thumbnail: false });

/* --------------------------------------------------------------- utilidades */

const ascii = (b: Uint8Array, s = 0, e = b.length) => {
  let out = '';
  for (let i = s; i < e && i < b.length; i++) out += String.fromCharCode(b[i]);
  return out;
};
const startsWith = (b: Uint8Array, s: string, at = 0) => ascii(b, at, at + s.length) === s;
async function readAt(blob: Blob, off: number, len: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(off, off + len).arrayBuffer());
}

/* --------------------------------------------------------------------- TIFF */

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

function parseIfd(dv: DataView, le: boolean, off: number, depth = 0): { tags: Tags; next: number } {
  const tags: Tags = new Map();
  if (off < 8 || off + 2 > dv.byteLength || depth > 2) return { tags, next: 0 };
  const n = Math.min(dv.getUint16(off, le), 256);
  for (let i = 0; i < n; i++) {
    const e = off + 2 + i * 12;
    if (e + 12 > dv.byteLength) break;
    const tag = dv.getUint16(e, le), type = dv.getUint16(e + 2, le), count = dv.getUint32(e + 4, le);
    const size = (TYPE_SIZE[type] ?? 0) * count;
    if (!size || count > 4096) continue;
    const at = size <= 4 ? e + 8 : dv.getUint32(e + 8, le);
    if (at + size > dv.byteLength) continue;
    const vals: (number | string)[] = [];
    if (type === 2) {
      let s = '';
      for (let k = 0; k < count; k++) { const c = dv.getUint8(at + k); if (c === 0) break; s += String.fromCharCode(c); }
      vals.push(s.trim());
    } else {
      for (let k = 0; k < count; k++) {
        switch (type) {
          case 1: case 7: vals.push(dv.getUint8(at + k)); break;
          case 3: vals.push(dv.getUint16(at + k * 2, le)); break;
          case 4: vals.push(dv.getUint32(at + k * 4, le)); break;
          case 5: { const d = dv.getUint32(at + k * 8 + 4, le); vals.push(d ? dv.getUint32(at + k * 8, le) / d : 0); break; }
          case 9: vals.push(dv.getInt32(at + k * 4, le)); break;
          case 10: { const d = dv.getInt32(at + k * 8 + 4, le); vals.push(d ? dv.getInt32(at + k * 8, le) / d : 0); break; }
          default: vals.push(0);
        }
      }
    }
    tags.set(tag, { type, vals });
  }
  const nextAt = off + 2 + n * 12;
  const next = nextAt + 4 <= dv.byteLength ? dv.getUint32(nextAt, le) : 0;
  return { tags, next };
}

function parseTiff(tiff: Uint8Array): ExifParsed | null {
  if (tiff.length < 12) return null;
  const le = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!le && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return null;
  const dv = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  if (dv.getUint16(2, le) !== 42) return null;
  const first = parseIfd(dv, le, dv.getUint32(4, le));
  const num = (t: Tags, k: number) => { const v = t.get(k)?.vals[0]; return typeof v === 'number' ? v : 0; };
  const exif = num(first.tags, 0x8769) ? parseIfd(dv, le, num(first.tags, 0x8769), 1).tags : new Map();
  const gps = num(first.tags, 0x8825) ? parseIfd(dv, le, num(first.tags, 0x8825), 1).tags : new Map();
  let hasThumb = false;
  if (first.next) { const t = parseIfd(dv, le, first.next, 1); hasThumb = t.tags.has(0x0201) || t.tags.has(0x0111); }
  return { ifd0: first.tags, exif, gps, hasThumb };
}

/* ------------------------------------------------------------ interpretación */

const str = (t: Tags, k: number): string => {
  const v = t.get(k)?.vals[0];
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
};
const numv = (t: Tags, k: number, i = 0): number | null => {
  const v = t.get(k)?.vals[i];
  return typeof v === 'number' ? v : null;
};

function dms(t: Tags, tag: number, refTag: number): number | null {
  const d = numv(t, tag, 0), m = numv(t, tag, 1), s = numv(t, tag, 2);
  if (d === null) return null;
  let v = d + (m ?? 0) / 60 + (s ?? 0) / 3600;
  const ref = str(t, refTag).toUpperCase();
  if (ref === 'S' || ref === 'W') v = -v;
  return Number.isFinite(v) ? v : null;
}

function exifItems(p: ExifParsed, items: MetaItem[]): PhotoMeta['gps'] {
  const add = (group: MetaItem['group'], labelKey: DictKey, value: string, sensitive = false) => { if (value) items.push({ group, labelKey, value, sensitive }); };
  const { ifd0, exif, gps } = p;
  add('camera', 'meta.make', str(ifd0, 0x010f));
  add('camera', 'meta.model', str(ifd0, 0x0110));
  add('camera', 'meta.lens', str(exif, 0xa434) || str(exif, 0xa433));
  add('personal', 'meta.serial', str(exif, 0xa431), true);
  add('personal', 'meta.owner', str(exif, 0xa430), true);
  add('personal', 'meta.artist', str(ifd0, 0x013b), true);
  add('personal', 'meta.copyright', str(ifd0, 0x8298));
  add('personal', 'meta.description', str(ifd0, 0x010e));
  add('capture', 'meta.dateOriginal', str(exif, 0x9003));
  add('capture', 'meta.dateModified', str(ifd0, 0x0132));
  const et = numv(exif, 0x829a);
  if (et) add('capture', 'meta.exposure', et >= 1 ? `${et.toFixed(1)} s` : `1/${Math.round(1 / et)} s`);
  const fn = numv(exif, 0x829d);
  if (fn) add('capture', 'meta.aperture', `f/${fn.toFixed(1)}`);
  const iso = numv(exif, 0x8827);
  if (iso) add('capture', 'meta.iso', `ISO ${iso}`);
  const fl = numv(exif, 0x920a);
  if (fl) add('capture', 'meta.focal', `${fl.toFixed(fl % 1 ? 1 : 0)} mm`);
  const ori = numv(ifd0, 0x0112);
  if (ori && ori !== 1) add('capture', 'meta.orientation', `EXIF ${ori}`);
  const w = numv(exif, 0xa002), h = numv(exif, 0xa003);
  if (w && h) add('capture', 'meta.pixels', `${w} × ${h}`);
  add('software', 'meta.software', str(ifd0, 0x0131));
  const lat = dms(gps, 2, 1), lon = dms(gps, 4, 3);
  if (lat !== null && lon !== null && !(lat === 0 && lon === 0)) {
    let alt = numv(gps, 6);
    if (alt !== null && numv(gps, 5) === 1) alt = -alt;
    add('location', 'meta.gps', `${lat.toFixed(5)}, ${lon.toFixed(5)}`, true);
    if (alt !== null) add('location', 'meta.altitude', `${Math.round(alt)} m`, true);
    return { lat, lon, alt: alt ?? undefined };
  }
  if (gps.size) add('location', 'meta.gpsEmpty', '—', false);
  return undefined;
}

/* -------------------------------------------------------------------- JPEG */

async function readJpeg(file: Blob): Promise<PhotoInfo> {
  const meta: PhotoMeta = { format: 'jpeg', bytes: file.size, items: [], flags: EMPTY_FLAGS() };
  const head = await readAt(file, 0, Math.min(file.size, 1 << 20));
  let keep: KeepableExif | undefined;
  let p = 2;
  while (p + 4 <= head.length && head[p] === 0xff) {
    const marker = head[p + 1];
    if (marker === 0xff) { p++; continue; }
    if (marker === 0xda || marker === 0xd9) break; // inicio de datos de imagen
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { p += 2; continue; }
    const len = (head[p + 2] << 8) | head[p + 3];
    const seg = head.subarray(p + 4, p + 2 + len);
    if (marker === 0xe1 && startsWith(seg, 'Exif\0\0')) {
      meta.flags.exif = true;
      const parsed = parseTiff(seg.subarray(6));
      if (parsed) {
        meta.gps = exifItems(parsed, meta.items);
        meta.flags.thumbnail = parsed.hasThumb;
        keep = { ifd0: parsed.ifd0, exif: parsed.exif };
      }
    } else if (marker === 0xe1 && startsWith(seg, 'http://ns.adobe.com/xap/1.0/')) {
      meta.flags.xmp = true;
    } else if (marker === 0xe2 && startsWith(seg, 'ICC_PROFILE')) {
      meta.flags.icc = true;
    } else if (marker === 0xed && startsWith(seg, 'Photoshop 3.0')) {
      meta.flags.iptc = true;
    } else if (marker === 0xfe) {
      meta.flags.text = true;
      const c = ascii(seg).trim();
      if (c) meta.items.push({ group: 'other', labelKey: 'meta.comment', value: c.slice(0, 120) });
    }
    p += 2 + len;
  }
  return { meta, keep };
}

/* --------------------------------------------------------------------- PNG */

async function readPng(file: Blob): Promise<PhotoInfo> {
  const meta: PhotoMeta = { format: 'png', bytes: file.size, items: [], flags: EMPTY_FLAGS() };
  let keep: KeepableExif | undefined;
  let off = 8;
  const dec = new TextDecoder('latin1');
  for (let guard = 0; off + 12 <= file.size && guard < 400; guard++) {
    const h = await readAt(file, off, 8);
    const len = ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
    const type = ascii(h, 4, 8);
    if (type === 'IEND') break;
    if (type === 'eXIf' && len < 1 << 20) {
      meta.flags.exif = true;
      const parsed = parseTiff(await readAt(file, off + 8, len));
      if (parsed) { meta.gps = exifItems(parsed, meta.items); keep = { ifd0: parsed.ifd0, exif: parsed.exif }; }
    } else if (type === 'iCCP') {
      meta.flags.icc = true;
    } else if ((type === 'tEXt' || type === 'iTXt') && len < 1 << 20) {
      const b = await readAt(file, off + 8, len);
      const z = b.indexOf(0);
      const key = dec.decode(b.subarray(0, z < 0 ? 0 : z));
      if (key === 'XML:com.adobe.xmp') meta.flags.xmp = true;
      else {
        meta.flags.text = true;
        let val = dec.decode(b.subarray(z + 1));
        if (type === 'iTXt') val = new TextDecoder().decode(b.subarray(z + 1)).replace(/^[\0-\u0003]*[^\0]*\0[^\0]*\0/, '');
        const lk = key.toLowerCase();
        const labelKey: DictKey = lk === 'software' ? 'meta.software' : lk === 'author' || lk === 'artist' ? 'meta.artist' : lk.includes('creation') ? 'meta.dateOriginal' : 'meta.pngText';
        meta.items.push({ group: lk === 'software' ? 'software' : lk === 'author' ? 'personal' : 'other', labelKey, value: labelKey === 'meta.pngText' ? `${key}: ${val.slice(0, 100)}` : val.slice(0, 100), sensitive: lk === 'author' });
      }
    } else if (type === 'zTXt') {
      meta.flags.text = true;
    } else if (type === 'tIME' && len === 7) {
      const b = await readAt(file, off + 8, 7);
      const pad = (n: number) => String(n).padStart(2, '0');
      meta.items.push({ group: 'capture', labelKey: 'meta.dateModified', value: `${(b[0] << 8) | b[1]}-${pad(b[2])}-${pad(b[3])} ${pad(b[4])}:${pad(b[5])}` });
    }
    off += 12 + len;
  }
  return { meta, keep };
}

/* -------------------------------------------------------------------- WebP */

async function readWebp(file: Blob): Promise<PhotoInfo> {
  const meta: PhotoMeta = { format: 'webp', bytes: file.size, items: [], flags: EMPTY_FLAGS() };
  let keep: KeepableExif | undefined;
  let off = 12;
  for (let guard = 0; off + 8 <= file.size && guard < 100; guard++) {
    const h = await readAt(file, off, 8);
    const type = ascii(h, 0, 4);
    const len = (h[4] | (h[5] << 8) | (h[6] << 16) | (h[7] << 24)) >>> 0;
    if (type === 'EXIF' && len < 1 << 20) {
      meta.flags.exif = true;
      let b = await readAt(file, off + 8, len);
      if (startsWith(b, 'Exif\0\0')) b = b.subarray(6);
      const parsed = parseTiff(b);
      if (parsed) { meta.gps = exifItems(parsed, meta.items); keep = { ifd0: parsed.ifd0, exif: parsed.exif }; }
    } else if (type === 'XMP ') meta.flags.xmp = true;
    else if (type === 'ICCP') meta.flags.icc = true;
    off += 8 + len + (len & 1);
  }
  return { meta, keep };
}

/** Lee los metadatos de un archivo de imagen. Nunca lanza: si no entiende el formato devuelve «sin datos». */
export async function readPhotoMeta(file: Blob): Promise<PhotoInfo> {
  try {
    const sig = await readAt(file, 0, 12);
    if (sig[0] === 0xff && sig[1] === 0xd8) return await readJpeg(file);
    if (sig[0] === 0x89 && startsWith(sig, 'PNG', 1)) return await readPng(file);
    if (startsWith(sig, 'RIFF') && startsWith(sig, 'WEBP', 8)) return await readWebp(file);
  } catch (e) {
    console.warn('No se pudieron leer los metadatos', e);
  }
  return { meta: { format: 'other', bytes: file.size, items: [], flags: EMPTY_FLAGS() } };
}

export function hasAnyMetadata(m: PhotoMeta): boolean {
  return m.items.length > 0 || Object.values(m.flags).some(Boolean);
}

/* ----------------------------------------------- EXIF mínimo y seguro (JPEG) */

/** Etiquetas que se conservan cuando el usuario desactiva «Quitar metadatos». Nunca GPS, serie, autor ni miniatura. */
const KEEP_IFD0 = [0x010f, 0x0110];
const KEEP_EXIF = [0x9003, 0x829a, 0x829d, 0x8827, 0x920a, 0xa434];

function encodeValue(d: Decoded): Uint8Array {
  const sz = TYPE_SIZE[d.type] ?? 1;
  const out = new Uint8Array(Math.max(1, d.vals.length) * sz + (d.type === 2 ? 1 : 0));
  const dv = new DataView(out.buffer);
  if (d.type === 2) { const s = String(d.vals[0] ?? ''); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff; return out; }
  d.vals.forEach((v, i) => {
    const n = Number(v);
    if (d.type === 3) dv.setUint16(i * 2, n, true);
    else if (d.type === 4) dv.setUint32(i * 4, n, true);
    else if (d.type === 5) { const den = 1000000; dv.setUint32(i * 8, Math.round(n * den), true); dv.setUint32(i * 8 + 4, den, true); }
    else out[i] = n;
  });
  return out;
}

function countOf(d: Decoded): number { return d.type === 2 ? String(d.vals[0] ?? '').length + 1 : d.vals.length; }

/** Construye un segmento APP1 «Exif» limpio (little-endian) con sólo datos técnicos de la cámara. */
export function buildCleanExifSegment(keep: KeepableExif): Uint8Array | null {
  const ifd0 = new Map<number, Decoded>();
  KEEP_IFD0.forEach((k) => { const v = keep.ifd0.get(k); if (v) ifd0.set(k, v); });
  ifd0.set(0x0112, { type: 3, vals: [1] }); // la orientación ya está aplicada al decodificar
  const exif = new Map<number, Decoded>();
  KEEP_EXIF.forEach((k) => { const v = keep.exif.get(k); if (v) exif.set(k, v); });
  if (ifd0.size <= 1 && !exif.size) return null;

  const hasExif = exif.size > 0;
  const entriesTotal = ifd0.size + (hasExif ? 1 : 0);
  const ifd0Size = 2 + entriesTotal * 12 + 4;
  const exifIfdOff = 8 + ifd0Size;
  const exifSize = hasExif ? 2 + exif.size * 12 + 4 : 0;
  let dataOff = exifIfdOff + exifSize;
  const dataParts: Uint8Array[] = [];

  const writeIfd = (tags: Map<number, Decoded>, extra: Map<number, Decoded>): Uint8Array => {
    const all = new Map([...tags, ...extra].sort((a, b) => a[0] - b[0]));
    const out = new Uint8Array(2 + all.size * 12 + 4);
    const dv = new DataView(out.buffer);
    dv.setUint16(0, all.size, true);
    let i = 0;
    for (const [tag, d] of all) {
      const e = 2 + i * 12;
      const bytes = encodeValue(d);
      dv.setUint16(e, tag, true); dv.setUint16(e + 2, d.type, true); dv.setUint32(e + 4, countOf(d), true);
      if (bytes.length <= 4) out.set(bytes, e + 8);
      else { dv.setUint32(e + 8, dataOff, true); dataParts.push(bytes); dataOff += bytes.length + (bytes.length & 1); if (bytes.length & 1) dataParts.push(new Uint8Array(1)); }
      i++;
    }
    return out;
  };

  const extra0 = new Map<number, Decoded>();
  if (hasExif) extra0.set(0x8769, { type: 4, vals: [exifIfdOff] });
  const ifd0Bytes = writeIfd(ifd0, extra0);
  const exifBytes = hasExif ? writeIfd(exif, new Map()) : new Uint8Array(0);
  const head = new Uint8Array(8);
  head.set([0x49, 0x49, 42, 0, 8, 0, 0, 0]);
  const parts = [head, ifd0Bytes, exifBytes, ...dataParts];
  const tiffLen = parts.reduce((n, p) => n + p.length, 0);
  const seg = new Uint8Array(4 + 6 + tiffLen);
  seg[0] = 0xff; seg[1] = 0xe1;
  const L = 2 + 6 + tiffLen;
  if (L > 0xffff) return null;
  seg[2] = L >> 8; seg[3] = L & 0xff;
  seg.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4);
  let o = 10;
  for (const p of parts) { seg.set(p, o); o += p.length; }
  return seg;
}

/** Inserta un segmento APP1 justo después de SOI (y de un posible JFIF APP0). */
export async function injectJpegSegment(jpeg: Blob, seg: Uint8Array): Promise<Blob> {
  const head = await readAt(jpeg, 0, 64);
  let at = 2;
  if (head[2] === 0xff && head[3] === 0xe0) at = 4 + ((head[4] << 8) | head[5]);
  return new Blob([jpeg.slice(0, at), seg as BlobPart, jpeg.slice(at)], { type: 'image/jpeg' });
}
