/** Marcos y bordes: borde sólido/doble, esquinas redondeadas, Polaroid y sombra paralela. */
import { createCanvas, ctx2d, roundRectPath, EMOJI_FONT, type AnyCanvas } from './util';

export type BorderStyle = 'none' | 'solid' | 'double' | 'polaroid';

export interface FrameOptions {
  border: BorderStyle;
  /** Grosor del borde en px (a tamaño real). */
  width: number;
  color: string;
  /** Color del hueco entre líneas (borde doble). */
  color2: string;
  /** Radio de esquinas en px. */
  radius: number;
  /** Texto bajo la foto (Polaroid). */
  caption: string;
  shadow: boolean;
  shadowColor: string;
  shadowBlur: number;
  shadowX: number;
  shadowY: number;
  shadowOpacity: number;
}

export const DEFAULT_FRAME: FrameOptions = {
  border: 'solid', width: 24, color: '#ffffff', color2: '#14151a', radius: 0, caption: '',
  shadow: false, shadowColor: '#000000', shadowBlur: 24, shadowX: 8, shadowY: 12, shadowOpacity: 0.5,
};

/** Márgenes del marco alrededor de la imagen. */
function pads(o: FrameOptions, w: number, h: number, k: number) {
  const b = o.border === 'none' ? 0 : o.width * k;
  if (o.border === 'polaroid') {
    const side = Math.max(b, 4 * k);
    return { l: side, r: side, t: side, b: side + Math.max(side * 2.6, Math.min(w, h) * 0.16) };
  }
  return { l: b, r: b, t: b, b };
}

/** Dibuja la imagen con su marco. `k` escala todos los valores en px (vista previa). */
export function renderFrame(src: CanvasImageSource & { width: number; height: number }, o: FrameOptions, k = 1): AnyCanvas {
  const w = src.width, h = src.height;
  const p = pads(o, w, h, k);
  const fw = w + p.l + p.r, fh = h + p.t + p.b;
  const sh = o.shadow ? { blur: o.shadowBlur * k, dx: o.shadowX * k, dy: o.shadowY * k } : { blur: 0, dx: 0, dy: 0 };
  const m = o.shadow ? { l: sh.blur * 1.6 - Math.min(0, sh.dx), r: sh.blur * 1.6 + Math.max(0, sh.dx), t: sh.blur * 1.6 - Math.min(0, sh.dy), b: sh.blur * 1.6 + Math.max(0, sh.dy) } : { l: 0, r: 0, t: 0, b: 0 };
  const W = Math.ceil(fw + m.l + m.r), H = Math.ceil(fh + m.t + m.b);
  const c = createCanvas(W, H);
  const ctx = ctx2d(c);
  ctx.imageSmoothingQuality = 'high';
  const ox = m.l, oy = m.t;
  const R = o.radius * k;

  // Silueta exterior (para sombra y relleno del marco).
  const body = () => roundRectPath(ctx, ox, oy, fw, fh, R);
  if (o.shadow) {
    ctx.save();
    ctx.shadowColor = hexA(o.shadowColor, o.shadowOpacity);
    ctx.shadowBlur = sh.blur; ctx.shadowOffsetX = sh.dx; ctx.shadowOffsetY = sh.dy;
    ctx.fillStyle = '#000'; body(); ctx.fill();
    ctx.restore();
  }

  if (o.border === 'solid' || o.border === 'polaroid') {
    ctx.fillStyle = o.color; body(); ctx.fill();
  } else if (o.border === 'double') {
    const t = p.l / 3;
    ctx.fillStyle = o.color; body(); ctx.fill();
    ctx.fillStyle = o.color2; roundRectPath(ctx, ox + t, oy + t, fw - 2 * t, fh - 2 * t, Math.max(0, R - t)); ctx.fill();
    ctx.fillStyle = o.color; roundRectPath(ctx, ox + 2 * t, oy + 2 * t, fw - 4 * t, fh - 4 * t, Math.max(0, R - 2 * t)); ctx.fill();
  }

  // Imagen interior con esquinas redondeadas.
  ctx.save();
  const inner = o.border === 'none' ? R : Math.max(0, R - p.l);
  roundRectPath(ctx, ox + p.l, oy + p.t, w, h, inner);
  ctx.clip();
  ctx.drawImage(src, ox + p.l, oy + p.t, w, h);
  if (o.border === 'polaroid') { // brillo interior sutil
    ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = Math.max(1, k); ctx.strokeRect(ox + p.l, oy + p.t, w, h);
  }
  ctx.restore();

  if (o.border === 'polaroid' && o.caption.trim()) {
    const fs = Math.min(p.b * 0.4, (fw - 2 * p.l) / Math.max(6, o.caption.length) * 1.9);
    ctx.fillStyle = '#3a3a3a';
    ctx.font = `italic ${Math.max(8, fs)}px "Segoe Print","Bradley Hand","Comic Sans MS",cursive,${EMOJI_FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(o.caption, ox + fw / 2, oy + p.t + h + (p.b - p.t) / 2, fw - 2 * p.l);
  }
  return c;
}

/** Marco que rodea todo el documento (el centro queda transparente). */
export function renderDocBorder(w: number, h: number, o: FrameOptions, k = 1): AnyCanvas {
  const c = createCanvas(w, h);
  const ctx = ctx2d(c);
  const b = o.width * k, R = o.radius * k;
  const ring = (a: number, z: number, color: string) => {
    ctx.fillStyle = color;
    roundRectPath(ctx, a, a, w - 2 * a, h - 2 * a, Math.max(0, R - a));
    roundRectPath(ctx, z, z, w - 2 * z, h - 2 * z, Math.max(0, R - z), false);
    ctx.fill('evenodd');
  };
  if (o.border === 'double') {
    const t = b / 3;
    ring(0, t, o.color); ring(t, 2 * t, o.color2); ring(2 * t, 3 * t, o.color);
  } else ring(0, b, o.color);
  return c;
}

export function hexA(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
