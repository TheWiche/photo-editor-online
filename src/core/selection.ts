/**
 * SELECCIÓN ACTIVA (contrato). Dueño: agente de edición clásica.
 * La máscara es un ImageBitmap del tamaño del documento: alfa 255 = seleccionado.
 * Otros módulos (IA, retoque) llaman solo a esta API:
 *
 *   getSelection(): ImageBitmap | null       máscara actual (o null = sin selección)
 *   setSelection(mask | null)                sustituye la selección (queda en el historial: Ctrl+Z la deshace)
 *   clearSelection()                         deselecciona (Ctrl+D)
 *   subscribeSelection(fn) → unsubscribe     avisa en cada cambio
 *
 * Extras para herramientas del editor (síncronos y basados en un canal alfa `SelData`):
 *   getSelectionData(w?, h?)  alfa actual (Uint8ClampedArray w·h), decodificado y cacheado
 *   commitSelection(sel, label)  convierte un SelData en ImageBitmap y lo publica
 *   operaciones puras: selRect, selEllipse, selPolygon, combineSel, invertSel, featherSel,
 *   growSel (expandir/contraer), magicWand, quickSelectDab, selBounds, selectionOutline.
 */
import { canvasFilterSupported, createCanvas, ctx2d } from './render';
import type { Point, Rect } from './defaults';

type Listener = () => void;
let current: ImageBitmap | null = null;
let currentData: SelData | null = null;
let version = 0;
const listeners = new Set<Listener>();
let historyHook: ((label: string) => void) | null = null;
let lastLabel = 'Selección';

export const getSelection = (): ImageBitmap | null => current;
/** Sustituye la selección. Registra un paso de historial (si el editor está montado). */
export function setSelection(mask: ImageBitmap | null): void {
  historyHook?.(lastLabel);
  lastLabel = 'Selección';
  restoreSelection(mask);
}
export const clearSelection = () => { if (current) { lastLabel = 'Deseleccionar'; setSelection(null); } };
export const subscribeSelection = (l: Listener) => { listeners.add(l); return () => { listeners.delete(l); }; };

/* ------------------------------------------------------------ internos */

let previous: ImageBitmap | null = null;
/** Para el historial del editor: el store registra aquí su función `record`. */
export function setSelectionHistoryHook(fn: ((label: string) => void) | null) { historyHook = fn; }
/** Restaura sin tocar el historial (deshacer/rehacer, cambios de documento). */
export function restoreSelection(mask: ImageBitmap | null, data: SelData | null = null) {
  if (current && current !== mask) previous = current;
  current = mask;
  currentData = mask ? data : null;
  version++;
  listeners.forEach((l) => l());
}
/** Última selección descartada (para «Volver a seleccionar»). */
export const getPreviousSelection = () => previous;
export const selectionVersion = () => version;

/* ------------------------------------------------------------ datos */

/** Canal alfa de la selección: a[y*w+x] 0..255. */
export interface SelData { w: number; h: number; a: Uint8ClampedArray }

export const emptySel = (w: number, h: number): SelData => ({ w, h, a: new Uint8ClampedArray(w * h) });

/** Alfa de la selección actual (redimensionado a w×h si se indica). */
export function getSelectionData(w?: number, h?: number): SelData | null {
  if (!current) return null;
  const W = w ?? current.width, H = h ?? current.height;
  if (currentData && currentData.w === W && currentData.h === H) return currentData;
  const c = createCanvas(W, H);
  const x = ctx2d(c, { willReadFrequently: true });
  x.drawImage(current, 0, 0, W, H);
  const d = x.getImageData(0, 0, W, H).data;
  const a = new Uint8ClampedArray(W * H);
  for (let i = 0, j = 3; i < a.length; i++, j += 4) a[i] = d[j];
  const sd = { w: W, h: H, a };
  if (W === current.width && H === current.height) currentData = sd;
  return sd;
}

export function selToImageData(sel: SelData): ImageData {
  const img = new ImageData(sel.w, sel.h);
  const d = new Uint32Array(img.data.buffer);
  const a = sel.a;
  // little-endian: 0xAABBGGRR
  for (let i = 0; i < a.length; i++) d[i] = a[i] ? ((a[i] << 24) | 0x00ffffff) >>> 0 : 0;
  return img;
}

export function selToCanvas(sel: SelData) {
  const c = createCanvas(sel.w, sel.h);
  ctx2d(c).putImageData(selToImageData(sel), 0, 0);
  return c;
}

let commitChain: Promise<void> = Promise.resolve();
/** Publica un SelData como selección (null o vacío = deseleccionar). Serializa llamadas. */
export function commitSelection(sel: SelData | null, label = 'Selección'): Promise<void> {
  commitChain = commitChain.then(async () => {
    if (!sel || isEmptySel(sel)) {
      if (current) { lastLabel = label === 'Selección' ? 'Deseleccionar' : label; historyHook?.(lastLabel); restoreSelection(null); }
      return;
    }
    const bmp = await createImageBitmap(selToImageData(sel));
    historyHook?.(label);
    lastLabel = 'Selección';
    restoreSelection(bmp, sel);
  }).catch((e) => console.error('Selección', e));
  return commitChain;
}

export function isEmptySel(sel: SelData): boolean {
  const a = sel.a;
  for (let i = 0; i < a.length; i += 7) if (a[i]) return false;
  for (let i = 0; i < a.length; i++) if (a[i]) return false;
  return true;
}

/** Rectángulo que contiene todo lo seleccionado (o null). */
export function selBounds(sel: SelData, threshold = 1): Rect | null {
  const { w, h, a } = sel;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let any = false;
    for (let x = 0; x < w; x++) if (a[row + x] >= threshold) { any = true; if (x < x0) x0 = x; break; }
    if (!any) continue;
    for (let x = w - 1; x >= 0; x--) if (a[row + x] >= threshold) { if (x > x1) x1 = x; break; }
    if (y < y0) y0 = y;
    y1 = y;
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/* ------------------------------------------------------------ formas */

export type SelMode = 'new' | 'add' | 'subtract' | 'intersect';

export function selAll(w: number, h: number): SelData { const s = emptySel(w, h); s.a.fill(255); return s; }

export function selRect(w: number, h: number, r: Rect): SelData {
  const s = emptySel(w, h);
  const x0 = Math.max(0, Math.round(r.x)), y0 = Math.max(0, Math.round(r.y));
  const x1 = Math.min(w, Math.round(r.x + r.w)), y1 = Math.min(h, Math.round(r.y + r.h));
  for (let y = y0; y < y1; y++) s.a.fill(255, y * w + x0, y * w + x1);
  return s;
}

function rasterize(w: number, h: number, draw: (c: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => void): SelData {
  const c = createCanvas(w, h);
  const x = ctx2d(c, { willReadFrequently: true });
  x.fillStyle = '#fff';
  draw(x);
  const d = x.getImageData(0, 0, w, h).data;
  const s = emptySel(w, h);
  for (let i = 0, j = 3; i < s.a.length; i++, j += 4) s.a[i] = d[j];
  return s;
}

export function selEllipse(w: number, h: number, r: Rect): SelData {
  return rasterize(w, h, (x) => {
    x.beginPath();
    x.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.abs(r.w / 2), Math.abs(r.h / 2), 0, 0, Math.PI * 2);
    x.fill();
  });
}

export function selPolygon(w: number, h: number, pts: Point[]): SelData {
  return rasterize(w, h, (x) => {
    x.beginPath();
    pts.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y)));
    x.closePath();
    x.fill('nonzero');
  });
}

/** Combina una forma nueva con la selección base según el modo. */
export function combineSel(base: SelData | null, add: SelData, mode: SelMode): SelData {
  if (mode === 'new') return add;
  if (!base || base.w !== add.w || base.h !== add.h) return mode === 'add' ? add : emptySel(add.w, add.h);
  const out = emptySel(add.w, add.h);
  const a = base.a, b = add.a, o = out.a;
  if (mode === 'add') for (let i = 0; i < o.length; i++) o[i] = a[i] > b[i] ? a[i] : b[i];
  else if (mode === 'subtract') for (let i = 0; i < o.length; i++) o[i] = (a[i] * (255 - b[i]) + 127) / 255;
  else for (let i = 0; i < o.length; i++) o[i] = a[i] < b[i] ? a[i] : b[i];
  return out;
}

export function invertSel(sel: SelData): SelData {
  const out = emptySel(sel.w, sel.h);
  for (let i = 0; i < out.a.length; i++) out.a[i] = 255 - sel.a[i];
  return out;
}

/* ------------------------------------------------------------ plumado */

function boxBlurH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const k = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = src[row] * (r + 1);
    for (let x = 1; x <= r; x++) acc += src[row + Math.min(w - 1, x)];
    for (let x = 0; x < w; x++) {
      dst[row + x] = acc * k;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
}
function boxBlurV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const k = 1 / (2 * r + 1);
  for (let x = 0; x < w; x++) {
    let acc = src[x] * (r + 1);
    for (let y = 1; y <= r; y++) acc += src[Math.min(h - 1, y) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc * k;
      acc += src[Math.min(h - 1, y + r + 1) * w + x] - src[Math.max(0, y - r) * w + x];
    }
  }
}

/** Suaviza el borde de la selección (radio en px). */
export function featherSel(sel: SelData, radius: number): SelData {
  if (radius < 0.5) return sel;
  const { w, h } = sel;
  if (canvasFilterSupported()) {
    const src = selToCanvas(sel);
    return rasterize(w, h, (x) => { x.filter = `blur(${(radius / 2).toFixed(2)}px)`; x.drawImage(src, 0, 0); x.filter = 'none'; });
  }
  // Tres pasadas de caja ≈ gaussiana.
  const r = Math.max(1, Math.round(radius / 2));
  let a = Float32Array.from(sel.a), b = new Float32Array(w * h);
  for (let i = 0; i < 3; i++) { boxBlurH(a, b, w, h, r); boxBlurV(b, a, w, h, r); }
  const out = emptySel(w, h);
  for (let i = 0; i < a.length; i++) out.a[i] = a[i];
  return out;
}

/* --------------------------------------------- expandir / contraer */

/** Transformada de distancia euclídea 1D (Felzenszwalb). */
function edt1d(f: Float32Array, n: number, d: Float32Array, v: Int32Array, z: Float32Array) {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}
/** Distancia² de cada píxel al píxel «dentro» más cercano. */
function distanceTo(inside: (i: number) => boolean, w: number, h: number): Float32Array {
  const INF = 1e20;
  const g = new Float32Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = inside(i) ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float32Array(n), d = new Float32Array(n), v = new Int32Array(n), z = new Float32Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = g[row + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) g[row + x] = d[x];
  }
  return g;
}

/** Expande (px > 0) o contrae (px < 0) la selección con borde redondeado. */
export function growSel(sel: SelData, px: number): SelData {
  if (!px) return sel;
  const { w, h, a } = sel;
  const r = Math.abs(px);
  const out = emptySel(w, h);
  if (px > 0) {
    const d = distanceTo((i) => a[i] >= 128, w, h);
    for (let i = 0; i < d.length; i++) {
      const dist = Math.sqrt(d[i]);
      out.a[i] = dist <= r - 0.5 ? 255 : dist >= r + 0.5 ? 0 : Math.round((r + 0.5 - dist) * 255);
      if (a[i] > out.a[i]) out.a[i] = a[i];
    }
  } else {
    const d = distanceTo((i) => a[i] < 128, w, h);
    for (let i = 0; i < d.length; i++) {
      const dist = Math.sqrt(d[i]);
      const v = dist >= r + 0.5 ? 255 : dist <= r - 0.5 ? 0 : Math.round((dist - r + 0.5) * 255);
      out.a[i] = Math.min(a[i], v);
    }
  }
  return out;
}

/* ------------------------------------------------------ varita mágica */

/**
 * Selecciona píxeles de color parecido al del punto (x, y).
 * tolerance 0..255 (diferencia máxima por canal); contiguous = sólo zonas conectadas.
 */
export function magicWand(img: ImageData, x: number, y: number, tolerance: number, contiguous: boolean): SelData {
  const { width: w, height: h, data: d } = img;
  const out = emptySel(w, h);
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= w || y >= h) return out;
  const i0 = (y * w + x) * 4;
  const r0 = d[i0], g0 = d[i0 + 1], b0 = d[i0 + 2], a0 = d[i0 + 3];
  const tol = tolerance;
  const soft = Math.max(1, tol * 0.25);
  // Valor de pertenencia con borde ligeramente suavizado (antialias).
  const match = (i: number): number => {
    const j = i * 4;
    const diff = Math.max(Math.abs(d[j] - r0), Math.abs(d[j + 1] - g0), Math.abs(d[j + 2] - b0), Math.abs(d[j + 3] - a0));
    if (diff <= tol) return 255;
    if (diff <= tol + soft) return Math.round(255 * (1 - (diff - tol) / soft) * 0.5);
    return 0;
  };
  const o = out.a;
  if (!contiguous) {
    for (let i = 0; i < o.length; i++) o[i] = match(i);
    return out;
  }
  // Relleno por líneas (scanline) con pila.
  const seen = new Uint8Array(w * h);
  const stack: number[] = [x, y];
  while (stack.length) {
    const sy = stack.pop()!, sx = stack.pop()!;
    let lx = sx;
    const row = sy * w;
    if (seen[row + lx]) continue;
    while (lx > 0 && !seen[row + lx - 1] && match(row + lx - 1) === 255) lx--;
    let rx = sx;
    while (rx < w - 1 && !seen[row + rx + 1] && match(row + rx + 1) === 255) rx++;
    for (let i = lx; i <= rx; i++) { seen[row + i] = 1; o[row + i] = 255; }
    // borde suave a izquierda/derecha
    if (lx > 0 && !seen[row + lx - 1]) o[row + lx - 1] = Math.max(o[row + lx - 1], match(row + lx - 1));
    if (rx < w - 1 && !seen[row + rx + 1]) o[row + rx + 1] = Math.max(o[row + rx + 1], match(row + rx + 1));
    for (const ny of [sy - 1, sy + 1]) {
      if (ny < 0 || ny >= h) continue;
      const nrow = ny * w;
      let inRun = false;
      for (let i = lx; i <= rx; i++) {
        const idx = nrow + i;
        if (seen[idx]) { inRun = false; continue; }
        const m = match(idx);
        if (m === 255) { if (!inRun) { stack.push(i, ny); inRun = true; } }
        else { inRun = false; if (m) o[idx] = Math.max(o[idx], m); }
      }
    }
  }
  return out;
}

/* --------------------------------------------------- selección rápida */

/**
 * Un toque del pincel de selección rápida: crece desde el círculo del pincel hacia
 * píxeles de color parecido, deteniéndose en bordes marcados. Modifica `sel` in situ
 * y devuelve el rectángulo afectado.
 */
export function quickSelectDab(img: ImageData, sel: SelData, cx: number, cy: number, radius: number, tolerance: number, subtract: boolean): Rect | null {
  const { width: w, height: h, data: d } = img;
  const r = Math.max(1, radius);
  const reach = r * 2.5;
  const x0 = Math.max(0, Math.floor(cx - reach)), y0 = Math.max(0, Math.floor(cy - reach));
  const x1 = Math.min(w - 1, Math.ceil(cx + reach)), y1 = Math.min(h - 1, Math.ceil(cy + reach));
  if (x1 < x0 || y1 < y0) return null;
  const ww = x1 - x0 + 1, hh = y1 - y0 + 1;
  // Color medio bajo el pincel (muestreado).
  let sr = 0, sg = 0, sb = 0, n = 0;
  const step = Math.max(1, Math.floor(r / 6));
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, cy + r); y += step) {
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, cx + r); x += step) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const j = (y * w + x) * 4; sr += d[j]; sg += d[j + 1]; sb += d[j + 2]; n++;
    }
  }
  if (!n) return null;
  sr /= n; sg /= n; sb /= n;
  const tol2 = tolerance * tolerance * 3;
  const edge2 = (tolerance * 0.9) ** 2 * 3;
  const visited = new Uint8Array(ww * hh);
  const queue = new Int32Array(ww * hh);
  let qh = 0, qt = 0;
  const a = sel.a;
  const val = subtract ? 0 : 255;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const li = (y - y0) * ww + (x - x0);
      visited[li] = 1; queue[qt++] = li;
      a[y * w + x] = val;
    }
  }
  const reach2 = reach * reach;
  while (qh < qt) {
    const li = queue[qh++];
    const lx = li % ww, ly = (li / ww) | 0;
    const gx = lx + x0, gy = ly + y0;
    const j = (gy * w + gx) * 4;
    const pr = d[j], pg = d[j + 1], pb = d[j + 2];
    for (let k = 0; k < 4; k++) {
      const nx = k === 0 ? lx - 1 : k === 1 ? lx + 1 : lx;
      const ny = k === 2 ? ly - 1 : k === 3 ? ly + 1 : ly;
      if (nx < 0 || ny < 0 || nx >= ww || ny >= hh) continue;
      const ni = ny * ww + nx;
      if (visited[ni]) continue;
      visited[ni] = 1;
      const X = nx + x0, Y = ny + y0;
      if ((X - cx) ** 2 + (Y - cy) ** 2 > reach2) continue;
      const q = (Y * w + X) * 4;
      const dr = d[q] - sr, dg = d[q + 1] - sg, db = d[q + 2] - sb;
      if (dr * dr + dg * dg + db * db > tol2) continue;
      const er = d[q] - pr, eg = d[q + 1] - pg, eb = d[q + 2] - pb;
      if (er * er + eg * eg + eb * eb > edge2) continue; // borde: no cruzar
      a[Y * w + X] = val;
      queue[qt++] = ni;
    }
  }
  return { x: x0, y: y0, w: ww, h: hh };
}

/* ---------------------------------------------- hormigas marchando */

let outlineCache: { v: number; path: Path2D } | null = null;

/** Contorno de la selección (coordenadas de documento) para dibujar las hormigas marchando. */
export function selectionOutline(maxSide = 1600): Path2D | null {
  if (!current) return null;
  if (outlineCache?.v === version) return outlineCache.path;
  const W = current.width, H = current.height;
  const f = Math.max(1, Math.ceil(Math.max(W, H) / maxSide));
  const gw = Math.ceil(W / f), gh = Math.ceil(H / f);
  const full = getSelectionData();
  if (!full) return null;
  const g = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    const sy = Math.min(H - 1, Math.floor(y * f + f / 2)) * W;
    for (let x = 0; x < gw; x++) g[y * gw + x] = full.a[sy + Math.min(W - 1, Math.floor(x * f + f / 2))] >= 128 ? 1 : 0;
  }
  const path = new Path2D();
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= gw || y >= gh ? 0 : g[y * gw + x]);
  const sx = (x: number) => Math.min(W, x * f), sy = (y: number) => Math.min(H, y * f);
  for (let y = 0; y <= gh; y++) {
    let start = -1;
    for (let x = 0; x <= gw; x++) {
      const edge = x < gw && at(x, y) !== at(x, y - 1);
      if (edge && start < 0) start = x;
      if (!edge && start >= 0) { path.moveTo(sx(start), sy(y)); path.lineTo(sx(x), sy(y)); start = -1; }
    }
  }
  for (let x = 0; x <= gw; x++) {
    let start = -1;
    for (let y = 0; y <= gh; y++) {
      const edge = y < gh && at(x, y) !== at(x - 1, y);
      if (edge && start < 0) start = y;
      if (!edge && start >= 0) { path.moveTo(sx(x), sy(start)); path.lineTo(sx(x), sy(y)); start = -1; }
    }
  }
  outlineCache = { v: version, path };
  return path;
}
