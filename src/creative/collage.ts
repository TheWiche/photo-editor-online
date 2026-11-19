/** Collage: plantillas de rejilla para 2–9 imágenes. */
import { createCanvas, ctx2d, drawCover, roundRectPath, type AnyCanvas } from './util';

type R = [number, number, number, number];
export interface CollageLayout { id: string; name: string; rects: R[] }

const grid = (n: number): R[] => {
  const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
  const out: R[] = [];
  for (let r = 0; r < rows; r++) {
    const cnt = r === rows - 1 ? n - cols * (rows - 1) : cols;
    for (let c = 0; c < cnt; c++) out.push([c / cnt, r / rows, 1 / cnt, 1 / rows]);
  }
  return out;
};
const strips = (n: number, vertical: boolean): R[] =>
  Array.from({ length: n }, (_, i) => (vertical ? [i / n, 0, 1 / n, 1] : [0, i / n, 1, 1 / n]) as R);
const heroLeft = (n: number): R[] => [[0, 0, 0.62, 1], ...Array.from({ length: n - 1 }, (_, i) => [0.62, i / (n - 1), 0.38, 1 / (n - 1)] as R)];
const heroTop = (n: number): R[] => [[0, 0, 1, 0.62], ...Array.from({ length: n - 1 }, (_, i) => [i / (n - 1), 0.62, 1 / (n - 1), 0.38] as R)];

export function layoutsFor(n: number): CollageLayout[] {
  const list: CollageLayout[] = [{ id: 'grid', name: 'Cuadrícula', rects: grid(n) }];
  if (n <= 5) {
    list.push({ id: 'cols', name: 'Columnas', rects: strips(n, true) }, { id: 'rows', name: 'Filas', rects: strips(n, false) });
  }
  if (n >= 3) list.push({ id: 'hero-l', name: 'Destacada izq.', rects: heroLeft(n) }, { id: 'hero-t', name: 'Destacada arriba', rects: heroTop(n) });
  if (n === 4 || n === 6 || n === 8) list.push({ id: 'wide', name: '2 columnas', rects: Array.from({ length: n }, (_, i) => [(i % 2) / 2, Math.floor(i / 2) / (n / 2), 0.5, 1 / (n / 2)] as R) });
  return list;
}

export interface CollageOptions {
  w: number; h: number;
  gap: number;      // px entre imágenes
  margin: number;   // px de margen exterior
  radius: number;
  background: string;
}

export const COLLAGE_SIZES: { id: string; label: string; w: number; h: number }[] = [
  { id: '1:1', label: 'Cuadrado 1:1', w: 1080, h: 1080 },
  { id: '4:5', label: 'Vertical 4:5', w: 1080, h: 1350 },
  { id: '9:16', label: 'Historia 9:16', w: 1080, h: 1920 },
  { id: '16:9', label: 'Horizontal 16:9', w: 1920, h: 1080 },
];

export function renderCollage(images: (CanvasImageSource & { width: number; height: number })[], layout: CollageLayout, o: CollageOptions, k = 1): AnyCanvas {
  const W = Math.round(o.w * k), H = Math.round(o.h * k);
  const c = createCanvas(W, H);
  const ctx = ctx2d(c);
  ctx.fillStyle = o.background; ctx.fillRect(0, 0, W, H);
  const m = o.margin * k, g = o.gap * k;
  const aw = W - 2 * m, ah = H - 2 * m;
  layout.rects.forEach(([rx, ry, rw, rh], i) => {
    const img = images[i];
    if (!img) return;
    // Espacio entre celdas: cada celda cede g/2 por cada borde interior.
    const x0 = m + rx * aw + (rx > 0.001 ? g / 2 : 0), y0 = m + ry * ah + (ry > 0.001 ? g / 2 : 0);
    const x1 = m + (rx + rw) * aw - (rx + rw < 0.999 ? g / 2 : 0), y1 = m + (ry + rh) * ah - (ry + rh < 0.999 ? g / 2 : 0);
    ctx.save();
    roundRectPath(ctx, x0, y0, x1 - x0, y1 - y0, o.radius * k);
    ctx.clip();
    drawCover(ctx, img, x0, y0, x1 - x0, y1 - y0);
    ctx.restore();
  });
  return c;
}
