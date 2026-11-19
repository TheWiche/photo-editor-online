/** Marca de agua de texto o logo: posición, mosaico, opacidad y ángulo. */
import { createCanvas, ctx2d, rad, type AnyCanvas, type Ctx2D } from './util';

export type WmPosition = 'tl' | 'tc' | 'tr' | 'ml' | 'mc' | 'mr' | 'bl' | 'bc' | 'br';
export interface WatermarkOptions {
  kind: 'text' | 'logo';
  text: string; color: string; font: string; bold: boolean;
  logo: (CanvasImageSource & { width: number; height: number }) | null;
  position: WmPosition;
  tile: boolean;
  /** Tamaño como % del lado menor. */
  size: number;
  opacity: number;   // 0..1
  angle: number;     // grados
  margin: number;    // % del lado menor
  gap: number;       // mosaico: separación en % del tamaño
}

export const DEFAULT_WM: WatermarkOptions = {
  kind: 'text', text: '© Mi marca', color: '#ffffff', font: 'Inter, system-ui, sans-serif', bold: true, logo: null,
  position: 'br', tile: false, size: 22, opacity: 0.6, angle: 0, margin: 3, gap: 60,
};

export const WM_POSITIONS: { v: WmPosition; label: string }[] = [
  { v: 'tl', label: '↖' }, { v: 'tc', label: '↑' }, { v: 'tr', label: '↗' },
  { v: 'ml', label: '←' }, { v: 'mc', label: '●' }, { v: 'mr', label: '→' },
  { v: 'bl', label: '↙' }, { v: 'bc', label: '↓' }, { v: 'br', label: '↘' },
];

/** Mide el sello (sin rotar) con tamaño objetivo de ancho = size% del lado menor. */
function stamp(o: WatermarkOptions, minSide: number) {
  const target = (minSide * o.size) / 100;
  if (o.kind === 'logo' && o.logo) {
    const s = target / o.logo.width;
    return { w: target, h: o.logo.height * s, draw: (ctx: Ctx2D) => ctx.drawImage(o.logo!, -target / 2, -(o.logo!.height * s) / 2, target, o.logo!.height * s) };
  }
  const text = o.text || ' ';
  const m = ctx2d(createCanvas(4, 4));
  m.font = `${o.bold ? 700 : 400} 100px ${o.font}`;
  const w100 = Math.max(1, m.measureText(text).width);
  const fs = (target / w100) * 100;
  return {
    w: target, h: fs * 1.15,
    draw: (ctx: Ctx2D) => {
      ctx.font = `${o.bold ? 700 : 400} ${fs}px ${o.font}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = fs * 0.08; ctx.shadowOffsetY = fs * 0.03;
      ctx.fillStyle = o.color; ctx.fillText(text, 0, 0);
    },
  };
}

/** Dibuja la marca de agua sobre un contexto existente de w×h. */
export function drawWatermark(ctx: Ctx2D, w: number, h: number, o: WatermarkOptions) {
  if (o.kind === 'logo' && !o.logo) return;
  if (o.kind === 'text' && !o.text.trim()) return;
  const min = Math.min(w, h);
  const st = stamp(o, min);
  ctx.save();
  ctx.globalAlpha *= o.opacity;
  const place = (cx: number, cy: number) => {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rad(o.angle)); st.draw(ctx); ctx.restore();
  };
  if (o.tile) {
    const sx = st.w * (1 + o.gap / 100), sy = st.h * (1 + o.gap / 100) * 1.6;
    const diag = Math.hypot(w, h);
    ctx.translate(w / 2, h / 2); ctx.rotate(rad(o.angle)); ctx.translate(-w / 2, -h / 2);
    let row = 0;
    for (let y = -diag / 2 + h / 2; y < h / 2 + diag / 2; y += sy, row++) {
      for (let x = -diag / 2 + w / 2 + (row % 2 ? sx / 2 : 0); x < w / 2 + diag / 2; x += sx) {
        ctx.save(); ctx.translate(x, y); st.draw(ctx); ctx.restore();
      }
    }
  } else {
    const mg = (min * o.margin) / 100;
    const hw = st.w / 2, hh = st.h / 2;
    const fx = o.position[1] === 'l' ? mg + hw : o.position[1] === 'r' ? w - mg - hw : w / 2;
    const fy = o.position[0] === 't' ? mg + hh : o.position[0] === 'b' ? h - mg - hh : h / 2;
    place(fx, fy);
  }
  ctx.restore();
}

/** Capa transparente del tamaño del documento con sólo la marca (opacidad incluida). */
export function renderWatermarkLayer(w: number, h: number, o: WatermarkOptions): AnyCanvas {
  const c = createCanvas(w, h);
  drawWatermark(ctx2d(c), w, h, o);
  return c;
}
