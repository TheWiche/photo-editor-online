/** Texto con efectos (contorno, sombra, resplandor, degradado, arco) rasterizado a capa. */
import { createCanvas, ctx2d, EMOJI_FONT, rad, type AnyCanvas, type Ctx2D } from './util';
import { hexA } from './frames';

export interface TextFxOptions {
  text: string;
  font: string;
  size: number;
  bold: boolean; italic: boolean;
  fill: string;
  gradient: boolean; fill2: string; gradAngle: number;
  stroke: boolean; strokeColor: string; strokeWidth: number;
  shadow: boolean; shadowColor: string; shadowBlur: number; shadowX: number; shadowY: number;
  glow: boolean; glowColor: string; glowSize: number;
  /** -100..100: curvatura sobre un arco (0 = recto). */
  arc: number;
  align: 'left' | 'center' | 'right';
}

export const DEFAULT_TEXTFX: TextFxOptions = {
  text: 'Tu texto', font: 'Inter, system-ui, sans-serif', size: 120, bold: true, italic: false,
  fill: '#ffffff', gradient: false, fill2: '#ff6bd5', gradAngle: 90,
  stroke: true, strokeColor: '#111111', strokeWidth: 8,
  shadow: false, shadowColor: '#000000', shadowBlur: 12, shadowX: 6, shadowY: 8,
  glow: false, glowColor: '#4f8cff', glowSize: 24,
  arc: 0, align: 'center',
};

interface Glyph { ch: string; x: number; y: number; rot: number }

export function renderTextFx(o: TextFxOptions, k = 1): AnyCanvas {
  const size = Math.max(4, o.size * k);
  const fontStr = `${o.italic ? 'italic ' : ''}${o.bold ? '800 ' : '400 '}${size}px ${o.font},${EMOJI_FONT}`;
  const m = ctx2d(createCanvas(8, 8));
  m.font = fontStr;
  const sw = o.stroke ? o.strokeWidth * k : 0;
  const effPad = Math.ceil(sw + (o.glow ? o.glowSize * k * 2 : 0) + (o.shadow ? o.shadowBlur * k * 1.6 + Math.max(Math.abs(o.shadowX), Math.abs(o.shadowY)) * k : 0) + size * 0.12 + 2);

  const glyphs: Glyph[] = [];
  let bx0 = 0, by0 = 0, bx1 = 0, by1 = 0;
  const lh = size * 1.18;
  if (Math.abs(o.arc) < 2) {
    const lines = (o.text || ' ').split('\n');
    const widths = lines.map((l) => m.measureText(l).width);
    const maxW = Math.max(...widths);
    bx1 = maxW; by1 = lh * lines.length;
    lines.forEach((l, i) => {
      const x = o.align === 'left' ? 0 : o.align === 'right' ? maxW - widths[i] : (maxW - widths[i]) / 2;
      glyphs.push({ ch: l, x, y: i * lh + size * 0.9, rot: 0 });
    });
  } else {
    const str = (o.text || ' ').replace(/\n/g, ' ');
    const chars = [...str];
    const adv = chars.map((ch) => m.measureText(ch).width);
    const total = adv.reduce((a, b) => a + b, 0);
    const theta = Math.max(0.15, (Math.abs(o.arc) / 100) * rad(330));
    const R = total / theta;
    const up = o.arc > 0;
    let a = up ? -Math.PI / 2 - theta / 2 : Math.PI / 2 + theta / 2;
    const pts: number[][] = [];
    chars.forEach((ch, i) => {
      const half = (adv[i] / 2 / R) * (up ? 1 : -1);
      a += half;
      const rr = up ? R : R; // baseline sobre el círculo
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      glyphs.push({ ch, x, y, rot: up ? a + Math.PI / 2 : a - Math.PI / 2 });
      pts.push([x, y]);
      a += half;
    });
    // Caja aproximada: puntos de la línea base ± tamaño de fuente.
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    bx0 = Math.min(...xs) - size * 0.7; bx1 = Math.max(...xs) + size * 0.7;
    by0 = Math.min(...ys) - size * 1.0; by1 = Math.max(...ys) + size * 1.0;
  }
  const W = Math.min(8192, Math.ceil(bx1 - bx0 + effPad * 2)), H = Math.min(8192, Math.ceil(by1 - by0 + effPad * 2));
  const ox = effPad - bx0, oy = effPad - by0;

  const layer = (draw: (c: Ctx2D) => void): AnyCanvas => {
    const c = createCanvas(W, H); const x = ctx2d(c);
    x.font = fontStr; x.textBaseline = 'alphabetic'; x.lineJoin = 'round'; x.miterLimit = 2;
    draw(x); return c;
  };
  const eachGlyph = (c: Ctx2D, fn: (c: Ctx2D, g: Glyph) => void) => {
    for (const g of glyphs) {
      c.save(); c.translate(ox + g.x, oy + g.y); c.rotate(g.rot);
      if (Math.abs(o.arc) >= 2) c.textAlign = 'center'; else c.textAlign = 'left';
      fn(c, g); c.restore();
    }
  };

  const fillL = layer((c) => {
    eachGlyph(c, (x, g) => { x.fillStyle = '#000'; x.fillText(g.ch, 0, 0); });
    c.globalCompositeOperation = 'source-in';
    if (o.gradient) {
      const a = rad(o.gradAngle), cx = W / 2, cy = H / 2, r = Math.hypot(W, H) / 2 * 0.7;
      const g = c.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      g.addColorStop(0, o.fill); g.addColorStop(1, o.fill2);
      c.fillStyle = g;
    } else c.fillStyle = o.fill;
    c.fillRect(0, 0, W, H);
  });
  const strokeL = sw > 0 ? layer((c) => {
    c.strokeStyle = o.strokeColor; c.lineWidth = sw * 2;
    eachGlyph(c, (x, g) => x.strokeText(g.ch, 0, 0));
  }) : null;

  const out = createCanvas(W, H);
  const ctx = ctx2d(out);
  const silhouette = layer((c) => { if (strokeL) c.drawImage(strokeL as CanvasImageSource, 0, 0); c.drawImage(fillL as CanvasImageSource, 0, 0); });
  if (o.glow) {
    ctx.save();
    ctx.shadowColor = o.glowColor; ctx.shadowBlur = o.glowSize * k;
    for (let i = 0; i < 3; i++) ctx.drawImage(silhouette as CanvasImageSource, 0, 0);
    ctx.restore();
  }
  if (o.shadow) {
    ctx.save();
    ctx.shadowColor = hexA(o.shadowColor, 0.85); ctx.shadowBlur = o.shadowBlur * k;
    ctx.shadowOffsetX = o.shadowX * k; ctx.shadowOffsetY = o.shadowY * k;
    ctx.drawImage(silhouette as CanvasImageSource, 0, 0);
    ctx.restore();
  }
  if (strokeL) ctx.drawImage(strokeL as CanvasImageSource, 0, 0);
  ctx.drawImage(fillL as CanvasImageSource, 0, 0);
  return out;
}
