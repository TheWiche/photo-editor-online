/**
 * Compositor Canvas2D: capas con modos de fusión, opacidad, transformaciones y
 * ajustes no destructivos (ctx.filter + superposiciones para temperatura, tinte,
 * viñeta y nitidez). Usa OffscreenCanvas cuando el navegador lo soporta.
 */
import type { Adjustments, DocumentState, Layer } from './contracts';
import { isDefaultAdjustments, type Point } from './defaults';

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type Masks = Record<string, ImageBitmap | undefined>;

export const hasOffscreen = typeof OffscreenCanvas !== 'undefined';

export function createCanvas(w: number, h: number, preferDom = false): AnyCanvas {
  const W = Math.max(1, Math.round(w));
  const H = Math.max(1, Math.round(h));
  if (hasOffscreen && !preferDom) return new OffscreenCanvas(W, H);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  return c;
}

export function ctx2d(c: AnyCanvas, opts?: CanvasRenderingContext2DSettings): Ctx2D {
  const ctx = (c as HTMLCanvasElement).getContext('2d', opts) as Ctx2D | null;
  if (!ctx) throw new Error('Canvas 2D no disponible');
  return ctx;
}

let filterOk: boolean | null = null;
/** ¿Soporta el navegador `ctx.filter`? (Safari antiguo no). */
export function canvasFilterSupported(): boolean {
  if (filterOk === null) {
    try {
      const c = ctx2d(createCanvas(1, 1));
      c.filter = 'blur(2px)';
      filterOk = c.filter === 'blur(2px)';
    } catch { filterOk = false; }
  }
  return filterOk;
}

/* ------------------------------------------------------------------ texto */

const FONT_PREFIX = /^((?:italic|oblique|normal|bold|bolder|lighter|[1-9]00)\s+)*/i;

export function fontString(t: NonNullable<Layer['text']>, scale = 1): string {
  const m = t.font.match(FONT_PREFIX);
  const prefix = m ? m[0] : '';
  return `${prefix}${Math.max(1, t.size * scale)}px ${t.font.slice(prefix.length) || 'sans-serif'}`;
}

let measureCtx: Ctx2D | null = null;
function measurer(): Ctx2D {
  if (!measureCtx) measureCtx = ctx2d(createCanvas(4, 4));
  return measureCtx;
}

export function textBox(t: NonNullable<Layer['text']>): { w: number; h: number; lines: string[]; lineH: number; pad: number } {
  const ctx = measurer();
  ctx.font = fontString(t);
  const lines = (t.content || ' ').split('\n');
  const lineH = t.size * 1.25;
  const pad = Math.ceil(t.size * 0.2);
  const maxW = Math.max(1, ...lines.map((l) => ctx.measureText(l || ' ').width));
  return { w: Math.ceil(maxW + pad * 2), h: Math.ceil(lines.length * lineH + pad * 2), lines, lineH, pad };
}

function renderText(t: NonNullable<Layer['text']>): AnyCanvas {
  const box = textBox(t);
  const c = createCanvas(box.w, box.h);
  const ctx = ctx2d(c);
  ctx.font = fontString(t);
  ctx.fillStyle = t.color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = t.align;
  const x = t.align === 'left' ? box.pad : t.align === 'right' ? box.w - box.pad : box.w / 2;
  box.lines.forEach((line, i) => ctx.fillText(line, x, box.pad + box.lineH * (i + 0.5)));
  return c;
}

/* ------------------------------------------------------------- geometría */

export function layerSize(layer: Layer): { w: number; h: number } {
  if (layer.kind === 'text' && layer.text) {
    const b = textBox(layer.text);
    return { w: b.w, h: b.h };
  }
  if (layer.bitmap) return { w: layer.bitmap.width, h: layer.bitmap.height };
  return { w: 1, h: 1 };
}

export function layerCenter(layer: Layer): Point {
  const { w, h } = layerSize(layer);
  return { x: layer.x + w / 2, y: layer.y + h / 2 };
}

/** Punto del documento → coordenadas locales de la capa (0..w, 0..h). */
export function docToLocal(layer: Layer, p: Point): Point {
  const { w, h } = layerSize(layer);
  const c = { x: layer.x + w / 2, y: layer.y + h / 2 };
  const r = (-layer.rotation * Math.PI) / 180;
  const dx = p.x - c.x, dy = p.y - c.y;
  const rx = dx * Math.cos(r) - dy * Math.sin(r);
  const ry = dx * Math.sin(r) + dy * Math.cos(r);
  return { x: rx / (layer.scaleX || 1) + w / 2, y: ry / (layer.scaleY || 1) + h / 2 };
}

export function localToDoc(layer: Layer, p: Point): Point {
  const { w, h } = layerSize(layer);
  const c = { x: layer.x + w / 2, y: layer.y + h / 2 };
  const r = (layer.rotation * Math.PI) / 180;
  const lx = (p.x - w / 2) * layer.scaleX, ly = (p.y - h / 2) * layer.scaleY;
  return { x: c.x + lx * Math.cos(r) - ly * Math.sin(r), y: c.y + lx * Math.sin(r) + ly * Math.cos(r) };
}

export function layerCorners(layer: Layer): Point[] {
  const { w, h } = layerSize(layer);
  return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }].map((p) => localToDoc(layer, p));
}

/** Capa visible más alta bajo el punto (o null). */
export function hitTest(doc: DocumentState, p: Point, includeLocked = false): Layer | null {
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i];
    if (!l.visible || (l.locked && !includeLocked)) continue;
    const { w, h } = layerSize(l);
    const q = docToLocal(l, p);
    if (q.x >= 0 && q.y >= 0 && q.x <= w && q.y <= h) return l;
  }
  return null;
}

/* ------------------------------------------------------------- ajustes */

export function blurRadius(a: Adjustments, w: number, h: number): number {
  return (a.blur / 100) * Math.max(w, h) * 0.02;
}

/** Cadena `ctx.filter` para los ajustes de color (sin desenfoque). */
export function cssColorFilter(a: Adjustments): string {
  const parts: string[] = [];
  const b = (1 + (a.brightness / 100) * 0.75) * Math.pow(2, (a.exposure / 100) * 1.5);
  if (Math.abs(b - 1) > 1e-3) parts.push(`brightness(${b.toFixed(4)})`);
  if (a.contrast) parts.push(`contrast(${(1 + a.contrast / 100).toFixed(4)})`);
  if (a.saturation) parts.push(`saturate(${(1 + a.saturation / 100).toFixed(4)})`);
  if (a.hue) parts.push(`hue-rotate(${a.hue}deg)`);
  if (a.sepia) parts.push(`sepia(${(a.sepia / 100).toFixed(4)})`);
  if (a.grayscale) parts.push('grayscale(1)');
  return parts.join(' ');
}

/* Matriz de color 3x4 (fallback cuando no hay ctx.filter). */
type M = number[]; // 12: [r0 r1 r2 ro, g0 g1 g2 go, b0 b1 b2 bo]
const I: M = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
function mul(b: M, a: M): M { // b ∘ a
  const o: M = new Array(12).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      o[r * 4 + c] = b[r * 4] * a[c] + b[r * 4 + 1] * a[4 + c] + b[r * 4 + 2] * a[8 + c];
    }
    o[r * 4 + 3] = b[r * 4] * a[3] + b[r * 4 + 1] * a[7] + b[r * 4 + 2] * a[11] + b[r * 4 + 3];
  }
  return o;
}
function colorMatrix(a: Adjustments): M {
  let m = I;
  const b = (1 + (a.brightness / 100) * 0.75) * Math.pow(2, (a.exposure / 100) * 1.5);
  m = mul([b, 0, 0, 0, 0, b, 0, 0, 0, 0, b, 0], m);
  const k = 1 + a.contrast / 100, off = 0.5 * (1 - k);
  m = mul([k, 0, 0, off, 0, k, 0, off, 0, 0, k, off], m);
  const s = 1 + a.saturation / 100;
  m = mul([0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s, 0], m);
  if (a.hue) {
    const r = (a.hue * Math.PI) / 180, co = Math.cos(r), si = Math.sin(r);
    m = mul([0.213 + co * 0.787 - si * 0.213, 0.715 - co * 0.715 - si * 0.715, 0.072 - co * 0.072 + si * 0.928, 0,
      0.213 - co * 0.213 + si * 0.143, 0.715 + co * 0.285 + si * 0.14, 0.072 - co * 0.072 - si * 0.283, 0,
      0.213 - co * 0.213 - si * 0.787, 0.715 - co * 0.715 + si * 0.715, 0.072 + co * 0.928 + si * 0.072, 0], m);
  }
  if (a.sepia) {
    const q = 1 - a.sepia / 100;
    m = mul([0.393 + 0.607 * q, 0.769 - 0.769 * q, 0.189 - 0.189 * q, 0,
      0.349 - 0.349 * q, 0.686 + 0.314 * q, 0.168 - 0.168 * q, 0,
      0.272 - 0.272 * q, 0.534 - 0.534 * q, 0.131 + 0.869 * q, 0], m);
  }
  if (a.grayscale) m = mul([0.2126, 0.7152, 0.0722, 0, 0.2126, 0.7152, 0.0722, 0, 0.2126, 0.7152, 0.0722, 0], m);
  return m;
}
function applyMatrixPixels(ctx: Ctx2D, w: number, h: number, m: M) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const o0 = m[3] * 255, o1 = m[7] * 255, o2 = m[11] * 255;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    d[i] = m[0] * r + m[1] * g + m[2] * b + o0;
    d[i + 1] = m[4] * r + m[5] * g + m[6] * b + o1;
    d[i + 2] = m[8] * r + m[9] * g + m[10] * b + o2;
  }
  ctx.putImageData(img, 0, 0);
}

function fallbackBlur(ctx: Ctx2D, src: AnyCanvas, w: number, h: number, radius: number) {
  const f = Math.max(1, radius / 2);
  const small = createCanvas(w / f, h / f);
  const s = ctx2d(small);
  s.imageSmoothingQuality = 'high';
  s.drawImage(src, 0, 0, small.width, small.height);
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, w, h);
}

/** Nitidez: máscara de enfoque 3x3 sobre píxeles. */
function sharpenPixels(ctx: Ctx2D, w: number, h: number, amount: number) {
  if (w < 3 || h < 3 || w * h > 40_000_000) return;
  const img = ctx.getImageData(0, 0, w, h);
  const src = new Uint8ClampedArray(img.data);
  const d = img.data;
  const k = amount * 1.2;
  const row = w * 4;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * row + x * 4;
      for (let c = 0; c < 3; c++) {
        const v = src[i + c] * (1 + 4 * k) - k * (src[i + c - 4] + src[i + c + 4] + src[i + c - row] + src[i + c + row]);
        d[i + c] = v;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Aplica los ajustes a una fuente y devuelve un lienzo nuevo del mismo tamaño. */
export function renderAdjusted(src: CanvasImageSource, w: number, h: number, a: Adjustments): AnyCanvas {
  const out = createCanvas(w, h);
  const needPixels = a.sharpen > 0 || !canvasFilterSupported();
  const ctx = ctx2d(out, needPixels ? { willReadFrequently: true } : undefined);
  const css = cssColorFilter(a);
  const blur = blurRadius(a, w, h);
  ctx.imageSmoothingQuality = 'high';
  if (canvasFilterSupported()) {
    ctx.filter = css || 'none';
    ctx.drawImage(src, 0, 0, w, h);
    if (blur > 0.3) { // base nítida debajo evita bordes transparentes
      ctx.filter = `${css} blur(${blur.toFixed(2)}px)`;
      ctx.drawImage(src, 0, 0, w, h);
    }
    ctx.filter = 'none';
  } else {
    ctx.drawImage(src, 0, 0, w, h);
    if (blur > 0.3) fallbackBlur(ctx, out, w, h, blur);
    if (css) applyMatrixPixels(ctx, w, h, colorMatrix(a));
  }
  if (a.sharpen > 0) sharpenPixels(ctx, w, h, a.sharpen / 100);
  if (a.temperature || a.tint) {
    ctx.globalCompositeOperation = 'soft-light';
    if (a.temperature) {
      const t = a.temperature / 100;
      ctx.fillStyle = t > 0 ? `rgba(255,145,30,${(t * 0.65).toFixed(3)})` : `rgba(30,120,255,${(-t * 0.65).toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (a.tint) {
      const t = a.tint / 100;
      ctx.fillStyle = t > 0 ? `rgba(255,40,200,${(t * 0.5).toFixed(3)})` : `rgba(40,255,80,${(-t * 0.5).toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(src, 0, 0, w, h);
  }
  if (a.vignette > 0) {
    const cx = w / 2, cy = h / 2, rad = Math.hypot(cx, cy);
    const g = ctx.createRadialGradient(cx, cy, rad * (0.75 - a.vignette / 250), cx, cy, rad);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${(a.vignette / 100 * 0.85).toFixed(3)})`);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.globalCompositeOperation = 'source-over';
  return out;
}

/* --------------------------------------------------- edición en vivo */

export interface LiveEdit {
  layerId: string;
  kind: 'mask' | 'paint';
  canvas: AnyCanvas;
  opacity: number;
  version: number;
}
let live: LiveEdit | null = null;
const liveListeners = new Set<() => void>();
export function getLiveEdit() { return live; }
export function setLiveEdit(e: LiveEdit | null) { live = e; liveListeners.forEach((f) => f()); }
export function bumpLiveEdit() { if (live) { live.version++; liveListeners.forEach((f) => f()); } }
export function onLiveEdit(fn: () => void) { liveListeners.add(fn); return () => { liveListeners.delete(fn); }; }

/* ---------------------------------------------------------- compositor */

const objIds = new WeakMap<object, number>();
let nextObjId = 1;
function oid(o: object | undefined | null): number {
  if (!o) return 0;
  let id = objIds.get(o);
  if (!id) { id = nextObjId++; objIds.set(o, id); }
  return id;
}

interface Prepared { src: CanvasImageSource; w: number; h: number }
interface Entry { key: string; canvas: AnyCanvas }

export class Compositor {
  private text = new Map<string, Entry>();
  private adjusted = new Map<string, Entry>();
  private masked = new Map<string, Entry>();

  /** Fuente sin ajustes (bitmap o texto rasterizado). */
  source(layer: Layer): Prepared | null {
    if (layer.kind === 'text' && layer.text) {
      const key = JSON.stringify(layer.text);
      let e = this.text.get(layer.id);
      if (!e || e.key !== key) { e = { key, canvas: renderText(layer.text) }; this.text.set(layer.id, e); }
      return { src: e.canvas, w: e.canvas.width, h: e.canvas.height };
    }
    if (layer.bitmap) return { src: layer.bitmap, w: layer.bitmap.width, h: layer.bitmap.height };
    return null;
  }

  /** Capa lista para componer: con ajustes, trazos en vivo y máscara. */
  prepare(layer: Layer, mask: ImageBitmap | undefined, compare = false): Prepared | null {
    const base = this.source(layer);
    if (!base) return null;
    const { w, h } = base;
    let src: CanvasImageSource = base.src;
    let key = `${oid(base.src as object)}`;
    if (!compare && !isDefaultAdjustments(layer.adjustments)) {
      const k = `${key}|${JSON.stringify(layer.adjustments)}`;
      let e = this.adjusted.get(layer.id);
      if (!e || e.key !== k) { e = { key: k, canvas: renderAdjusted(base.src, w, h, layer.adjustments) }; this.adjusted.set(layer.id, e); }
      src = e.canvas; key = k;
    } else {
      this.adjusted.delete(layer.id);
    }
    const lv = live && live.layerId === layer.id ? live : null;
    const maskSrc: CanvasImageSource | undefined = lv?.kind === 'mask' ? lv.canvas : mask;
    if (!maskSrc && !(lv?.kind === 'paint')) { this.masked.delete(layer.id); return { src, w, h }; }
    const k = `${key}|m${lv ? `live${lv.version}` : oid(mask)}`;
    let e = this.masked.get(layer.id);
    if (!e || e.key !== k || lv) {
      const canvas = e && e.canvas.width === w && e.canvas.height === h ? e.canvas : createCanvas(w, h);
      const ctx = ctx2d(canvas);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(src, 0, 0, w, h);
      if (lv?.kind === 'paint') { ctx.globalAlpha = lv.opacity; ctx.drawImage(lv.canvas, 0, 0, w, h); ctx.globalAlpha = 1; }
      if (maskSrc) { ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(maskSrc, 0, 0, w, h); ctx.globalCompositeOperation = 'source-over'; }
      e = { key: k, canvas };
      this.masked.set(layer.id, e);
    }
    return { src: e.canvas, w, h };
  }

  /** Dibuja el documento completo en ctx a la escala dada. */
  compose(ctx: Ctx2D, doc: DocumentState, masks: Masks, opts: { scale?: number; compare?: boolean; background?: string | null } = {}) {
    const s = opts.scale ?? 1;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    if (opts.background) { ctx.fillStyle = opts.background; ctx.fillRect(0, 0, doc.width, doc.height); }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    for (const layer of doc.layers) {
      if (!layer.visible || layer.opacity <= 0) continue;
      const p = this.prepare(layer, masks[layer.id], opts.compare);
      if (!p) continue;
      ctx.save();
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = layer.blend;
      ctx.translate(layer.x + p.w / 2, layer.y + p.h / 2);
      ctx.rotate((layer.rotation * Math.PI) / 180);
      ctx.scale(layer.scaleX, layer.scaleY);
      ctx.drawImage(p.src, -p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    ctx.restore();
  }

  /** Libera cachés de capas que ya no existen. */
  prune(ids: Set<string>) {
    for (const m of [this.text, this.adjusted, this.masked]) for (const k of m.keys()) if (!ids.has(k)) m.delete(k);
  }
}

export const compositor = new Compositor();

/** Aplana el documento en un lienzo nuevo (para exportar o para la IA). */
export function flattenDocument(doc: DocumentState, masks: Masks, opts: { scale?: number; background?: string | null; preferDom?: boolean } = {}): AnyCanvas {
  const s = opts.scale ?? 1;
  const c = createCanvas(doc.width * s, doc.height * s, opts.preferDom);
  compositor.compose(ctx2d(c), doc, masks, { scale: s, background: opts.background });
  return c;
}

export async function canvasToBlob(c: AnyCanvas, type = 'image/png', quality?: number): Promise<Blob> {
  if ('convertToBlob' in c) return c.convertToBlob({ type, quality });
  return new Promise((res, rej) => (c as HTMLCanvasElement).toBlob((b) => (b ? res(b) : rej(new Error('No se pudo codificar'))), type, quality));
}

/* ------------------------------------------------------------- visor */

export interface ViewTransform { zoom: number; ox: number; oy: number }

export function viewTransform(view: { zoom: number; panX: number; panY: number }, vw: number, vh: number, docW: number, docH: number): ViewTransform {
  return { zoom: view.zoom, ox: vw / 2 + view.panX - (docW / 2) * view.zoom, oy: vh / 2 + view.panY - (docH / 2) * view.zoom };
}
export const toScreen = (t: ViewTransform, p: Point): Point => ({ x: p.x * t.zoom + t.ox, y: p.y * t.zoom + t.oy });
export const toDoc = (t: ViewTransform, p: Point): Point => ({ x: (p.x - t.ox) / t.zoom, y: (p.y - t.oy) / t.zoom });

export interface Scene { doc: DocumentState | null; masks: Masks; compare: boolean; view: { zoom: number; panX: number; panY: number } }

/**
 * Renderizador del lienzo visible. Compone el documento a resolución completa sólo
 * cuando cambia (capas/máscaras/comparar) y redibuja el visor en requestAnimationFrame
 * para zoom, desplazamiento y superposiciones.
 */
export class ViewportRenderer {
  overlay: ((ctx: CanvasRenderingContext2D, t: ViewTransform) => void) | null = null;
  background = '#101116';
  private comp: AnyCanvas | null = null;
  private dirty = true;
  private raf = 0;
  private scene: Scene | null = null;
  private pattern: CanvasPattern | null = null;
  private cssW = 1;
  private cssH = 1;
  private offLive: () => void;

  constructor(private canvas: HTMLCanvasElement) {
    this.offLive = onLiveEdit(() => { this.dirty = true; this.request(); });
  }

  setSize(w: number, h: number) {
    this.cssW = Math.max(1, w); this.cssH = Math.max(1, h);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.round(this.cssW * dpr);
    this.canvas.height = Math.round(this.cssH * dpr);
    this.request();
  }

  setScene(s: Scene) {
    const prev = this.scene;
    if (!prev || prev.doc !== s.doc || prev.masks !== s.masks || prev.compare !== s.compare) this.dirty = true;
    this.scene = s;
    this.request();
  }

  transform(): ViewTransform | null {
    const d = this.scene?.doc;
    return d && this.scene ? viewTransform(this.scene.view, this.cssW, this.cssH, d.width, d.height) : null;
  }

  /** Composición actual (resolución del documento), útil para el cuentagotas. */
  composite(): AnyCanvas | null {
    if (this.dirty) this.recompose();
    return this.comp;
  }

  request() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.offLive();
  }

  private recompose() {
    const doc = this.scene?.doc;
    this.dirty = false;
    if (!doc) { this.comp = null; return; }
    if (!this.comp || this.comp.width !== doc.width || this.comp.height !== doc.height) this.comp = createCanvas(doc.width, doc.height);
    compositor.compose(ctx2d(this.comp, { willReadFrequently: false }), doc, this.scene!.masks, { compare: this.scene!.compare });
    compositor.prune(new Set(doc.layers.map((l) => l.id)));
  }

  private checker(ctx: CanvasRenderingContext2D): CanvasPattern | null {
    if (!this.pattern) {
      const c = document.createElement('canvas');
      c.width = c.height = 16;
      const p = c.getContext('2d')!;
      p.fillStyle = '#2a2b31'; p.fillRect(0, 0, 16, 16);
      p.fillStyle = '#3a3b42'; p.fillRect(0, 0, 8, 8); p.fillRect(8, 8, 8, 8);
      this.pattern = ctx.createPattern(c, 'repeat');
    }
    return this.pattern;
  }

  private draw() {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const dpr = this.canvas.width / this.cssW;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.background;
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    const doc = this.scene?.doc;
    const t = this.transform();
    if (doc && t) {
      if (this.dirty) this.recompose();
      const w = doc.width * t.zoom, h = doc.height * t.zoom;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = 24;
      ctx.shadowOffsetY = 6;
      ctx.fillStyle = this.checker(ctx) ?? '#333';
      ctx.fillRect(t.ox, t.oy, w, h);
      ctx.restore();
      if (this.comp) {
        ctx.imageSmoothingEnabled = t.zoom < 2;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(this.comp, t.ox, t.oy, w, h);
      }
      this.overlay?.(ctx, t);
    }
  }
}
