/** Formas y flechas vectoriales rasterizadas a capa. */
import { createCanvas, ctx2d, roundRectPath, type AnyCanvas, type Ctx2D } from './util';

export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'arrow' | 'star' | 'heart' | 'polygon';

export interface ShapeOptions {
  kind: ShapeKind;
  w: number; h: number;
  fill: string; useFill: boolean;
  stroke: string; strokeWidth: number;
  radius: number;   // esquinas del rectángulo
  sides: number;    // polígono
  points: number;   // estrella
  dash: boolean;
}

export const DEFAULT_SHAPE: ShapeOptions = {
  kind: 'rect', w: 400, h: 300, fill: '#4f8cff', useFill: true, stroke: '#ffffff', strokeWidth: 6, radius: 0, sides: 6, points: 5, dash: false,
};

export const SHAPES: { kind: ShapeKind; label: string; hint: string }[] = [
  { kind: 'rect', label: 'Rectángulo', hint: 'Cuadrado o rectángulo, con esquinas redondeables.' },
  { kind: 'ellipse', label: 'Elipse', hint: 'Círculo u óvalo.' },
  { kind: 'line', label: 'Línea', hint: 'Línea recta; gírala con la herramienta Mover.' },
  { kind: 'arrow', label: 'Flecha', hint: 'Para señalar algo en la imagen.' },
  { kind: 'star', label: 'Estrella', hint: 'Estrella de 3 a 12 puntas.' },
  { kind: 'heart', label: 'Corazón', hint: 'Corazón vectorial.' },
  { kind: 'polygon', label: 'Polígono', hint: 'Triángulo, pentágono, hexágono… (3 a 12 lados).' },
];

function polyPath(ctx: Ctx2D, cx: number, cy: number, rx: number, ry: number, n: number, inner = 1, rot = -Math.PI / 2) {
  ctx.beginPath();
  const total = inner < 1 ? n * 2 : n;
  for (let i = 0; i < total; i++) {
    const r = inner < 1 && i % 2 ? inner : 1;
    const a = rot + (i * 2 * Math.PI) / total;
    const x = cx + Math.cos(a) * rx * r, y = cy + Math.sin(a) * ry * r;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.closePath();
}

function heartPath(ctx: Ctx2D, x: number, y: number, w: number, h: number) {
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y + h);
  ctx.bezierCurveTo(x - w * 0.15, y + h * 0.62, x + w * 0.02, y - h * 0.08, x + w / 2, y + h * 0.28);
  ctx.bezierCurveTo(x + w * 0.98, y - h * 0.08, x + w * 1.15, y + h * 0.62, x + w / 2, y + h);
  ctx.closePath();
}

export function renderShape(o: ShapeOptions, k = 1): AnyCanvas {
  const sw = Math.max(0, o.strokeWidth * k);
  const w = Math.max(2, o.w * k), h = Math.max(2, o.h * k);
  const pad = Math.ceil(sw / 2 + 2 + (o.kind === 'arrow' ? sw * 3 : 0));
  const c = createCanvas(w + pad * 2, h + pad * 2);
  const ctx = ctx2d(c);
  ctx.translate(pad, pad);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.lineWidth = sw; ctx.strokeStyle = o.stroke; ctx.fillStyle = o.fill;
  if (o.dash && sw > 0) ctx.setLineDash([sw * 2.2, sw * 1.6]);
  const paint = (closed = true) => {
    if (o.useFill && closed) ctx.fill();
    if (sw > 0) ctx.stroke();
  };
  switch (o.kind) {
    case 'rect': roundRectPath(ctx, 0, 0, w, h, o.radius * k); paint(); break;
    case 'ellipse': ctx.beginPath(); ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); paint(); break;
    case 'line': {
      ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
      ctx.strokeStyle = sw > 0 ? o.stroke : o.fill; ctx.lineWidth = sw || 4 * k; ctx.stroke(); break;
    }
    case 'arrow': {
      const t = Math.max(sw, 4 * k), head = Math.min(w * 0.5, Math.max(t * 3.2, h * 0.5));
      const col = o.useFill ? o.fill : o.stroke;
      ctx.setLineDash([]);
      ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = t;
      ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w - head * 0.7, h / 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w, h / 2); ctx.lineTo(w - head, h / 2 - head * 0.55); ctx.lineTo(w - head, h / 2 + head * 0.55); ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    }
    case 'star': polyPath(ctx, w / 2, h / 2, w / 2, h / 2, Math.round(o.points), 0.42); paint(); break;
    case 'polygon': polyPath(ctx, w / 2, h / 2, w / 2, h / 2, Math.round(o.sides)); paint(); break;
    case 'heart': heartPath(ctx, 0, h * 0.05, w, h * 0.92); paint(); break;
  }
  return c;
}
