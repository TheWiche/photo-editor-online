/**
 * Geometría capa ↔ documento para las herramientas de IA (misma convención que src/core/render.ts:
 * la capa se dibuja trasladada a su centro, rotada y escalada).
 */
import { createCanvas, ctx2d, type AnyCanvas } from '../imageUtils';

export interface LayerGeometry {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  /** grados */
  rotation: number;
}

export interface DocSize {
  width: number;
  height: number;
}

export const IDENTITY: LayerGeometry = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };

/** Punto del documento → píxel de la capa (0..w, 0..h). */
export function docToLayer(g: LayerGeometry, w: number, h: number, p: { x: number; y: number }) {
  const cx = g.x + w / 2, cy = g.y + h / 2;
  const r = (-g.rotation * Math.PI) / 180;
  const dx = p.x - cx, dy = p.y - cy;
  const rx = dx * Math.cos(r) - dy * Math.sin(r);
  const ry = dx * Math.sin(r) + dy * Math.cos(r);
  return { x: rx / (g.scaleX || 1) + w / 2, y: ry / (g.scaleY || 1) + h / 2 };
}

/** Píxel de la capa → punto del documento. */
export function layerToDoc(g: LayerGeometry, w: number, h: number, p: { x: number; y: number }) {
  const cx = g.x + w / 2, cy = g.y + h / 2;
  const r = (g.rotation * Math.PI) / 180;
  const lx = (p.x - w / 2) * g.scaleX, ly = (p.y - h / 2) * g.scaleY;
  return { x: cx + lx * Math.cos(r) - ly * Math.sin(r), y: cy + lx * Math.sin(r) + ly * Math.cos(r) };
}

const isIdentity = (g: LayerGeometry, w: number, h: number, doc: DocSize) =>
  g.x === 0 && g.y === 0 && g.scaleX === 1 && g.scaleY === 1 && g.rotation % 360 === 0 && w === doc.width && h === doc.height;

/** Dibuja algo con el tamaño de la capa en un lienzo del tamaño del documento. */
export function layerSpaceToDoc(src: CanvasImageSource, w: number, h: number, g: LayerGeometry, doc: DocSize): AnyCanvas {
  const c = createCanvas(doc.width, doc.height);
  const ctx = ctx2d(c);
  ctx.imageSmoothingEnabled = true;
  if (isIdentity(g, w, h, doc)) {
    ctx.drawImage(src, 0, 0);
    return c;
  }
  ctx.translate(g.x + w / 2, g.y + h / 2);
  ctx.rotate((g.rotation * Math.PI) / 180);
  ctx.scale(g.scaleX, g.scaleY);
  ctx.drawImage(src, -w / 2, -h / 2, w, h);
  return c;
}

/** Inverso: algo del tamaño del documento (p. ej. la selección) → píxeles de la capa. */
export function docSpaceToLayer(src: CanvasImageSource, w: number, h: number, g: LayerGeometry, doc: DocSize): AnyCanvas {
  const c = createCanvas(w, h);
  const ctx = ctx2d(c);
  ctx.imageSmoothingEnabled = true;
  if (isIdentity(g, w, h, doc)) {
    ctx.drawImage(src, 0, 0);
    return c;
  }
  ctx.translate(w / 2, h / 2);
  ctx.scale(1 / (g.scaleX || 1), 1 / (g.scaleY || 1));
  ctx.rotate((-g.rotation * Math.PI) / 180);
  ctx.translate(-(g.x + w / 2), -(g.y + h / 2));
  ctx.drawImage(src, 0, 0, doc.width, doc.height);
  return c;
}

// ------------------------------------------------------------------ máscaras (alfa)

/** Desenfoque de caja separable sobre un canal (3 pasadas ≈ gaussiano). In situ. */
export function blurAlpha(a: Uint8ClampedArray | Float32Array, W: number, H: number, radius: number): void {
  const r = Math.max(0, Math.round(radius / 1.7));
  if (r < 1) return;
  const tmp = new Float32Array(Math.max(W, H));
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < H; y++) {
      const o = y * W;
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += a[o + Math.min(W - 1, Math.max(0, x))];
      for (let x = 0; x < W; x++) {
        tmp[x] = acc / (2 * r + 1);
        acc += a[o + Math.min(W - 1, x + r + 1)] - a[o + Math.max(0, x - r)];
      }
      for (let x = 0; x < W; x++) a[o + x] = tmp[x];
    }
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += a[Math.min(H - 1, Math.max(0, y)) * W + x];
      for (let y = 0; y < H; y++) {
        tmp[y] = acc / (2 * r + 1);
        acc += a[Math.min(H - 1, y + r + 1) * W + x] - a[Math.max(0, y - r) * W + x];
      }
      for (let y = 0; y < H; y++) a[y * W + x] = tmp[y];
    }
  }
}

/** Dilatación binaria (cuadrada, separable) de radio r. Devuelve una máscara nueva. */
export function dilate(bin: Uint8Array, W: number, H: number, r: number): Uint8Array {
  if (r < 1) return bin.slice();
  const tmp = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    let last = -1e9;
    const o = y * W;
    // pasada izquierda→derecha y derecha→izquierda: distancia al «1» más cercano en la fila
    const dist = new Int32Array(W).fill(1e9);
    for (let x = 0; x < W; x++) {
      if (bin[o + x]) last = x;
      dist[x] = x - last;
    }
    last = 1e9;
    for (let x = W - 1; x >= 0; x--) {
      if (bin[o + x]) last = x;
      dist[x] = Math.min(dist[x], last - x);
      tmp[o + x] = dist[x] <= r ? 1 : 0;
    }
  }
  const out = new Uint8Array(W * H);
  const dist = new Int32Array(H);
  for (let x = 0; x < W; x++) {
    let last = -1e9;
    for (let y = 0; y < H; y++) {
      if (tmp[y * W + x]) last = y;
      dist[y] = y - last;
    }
    last = 1e9;
    for (let y = H - 1; y >= 0; y--) {
      if (tmp[y * W + x]) last = y;
      out[y * W + x] = Math.min(dist[y], last - y) <= r ? 1 : 0;
    }
  }
  return out;
}

export function bboxOf(bin: Uint8Array, W: number, H: number): { x: number; y: number; width: number; height: number } | null {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    const o = y * W;
    for (let x = 0; x < W; x++) {
      if (bin[o + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}
