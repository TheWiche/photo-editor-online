/** Utilidades compartidas del módulo Creativo (lienzos, capas y color). */
import { createCanvas, ctx2d, type AnyCanvas, type Ctx2D } from '../core/render';
import { canvasToBitmap } from '../core/image';
import { useEditor, selectActiveLayer } from '../core/store';
import { useUI } from '../ui/uiStore';
import type { Layer } from '../core/contracts';

export { createCanvas, ctx2d, type AnyCanvas, type Ctx2D };

export const toast = (text: string, kind: 'info' | 'success' | 'error' = 'info') => useUI.getState().toast(text, kind);

export const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif';

/** Hay documento abierto; si no, avisa. */
export function needDoc(): boolean {
  if (useEditor.getState().doc) return true;
  toast('Abre una imagen o crea un lienzo primero (Archivo › Nuevo).', 'error');
  return false;
}

/** Capa de imagen activa (o null). */
export function activeImageLayer(): Layer | null {
  const l = selectActiveLayer(useEditor.getState());
  return l?.bitmap ? l : null;
}

/**
 * Añade un lienzo como capa nueva, centrada en el documento (o en `center`) y sin
 * reducirla si cabe. Devuelve el id de la capa.
 */
export async function addCanvasLayer(
  c: AnyCanvas, name: string, opts: { center?: { x: number; y: number }; opacity?: number; rotation?: number } = {},
): Promise<string> {
  const bmp = await canvasToBitmap(c);
  const st = useEditor.getState();
  const id = st.addLayerFromBitmap(bmp, name);
  const doc = useEditor.getState().doc;
  const layer = doc?.layers.find((l) => l.id === id);
  if (doc && layer && (opts.center || opts.opacity !== undefined || opts.rotation !== undefined)) {
    const cx = opts.center?.x ?? doc.width / 2, cy = opts.center?.y ?? doc.height / 2;
    st.updateLayer(id, {
      x: cx - bmp.width / 2, y: cy - bmp.height / 2,
      ...(opts.opacity !== undefined ? { opacity: opts.opacity } : {}),
      ...(opts.rotation !== undefined ? { rotation: opts.rotation } : {}),
    }, { skipHistory: true });
  }
  return id;
}

/**
 * Sustituye el bitmap de una capa por otro (posiblemente más grande) manteniendo el
 * tamaño de la imagen en el lienzo y el centro de la capa.
 */
export async function replaceKeepingScale(layer: Layer, c: AnyCanvas, name: string, label: string) {
  const bmp = await canvasToBitmap(c);
  const st = useEditor.getState();
  const cx = layer.x + (layer.bitmap?.width ?? bmp.width) / 2, cy = layer.y + (layer.bitmap?.height ?? bmp.height) / 2;
  st.replaceLayerBitmap(layer.id, bmp, name, label);
  st.updateLayer(layer.id, { scaleX: layer.scaleX, scaleY: layer.scaleY, x: cx - bmp.width / 2, y: cy - bmp.height / 2 }, { skipHistory: true });
}

/** Tamaño de referencia para dimensionar objetos nuevos (lado menor del documento). */
export function docUnit(): number {
  const d = useEditor.getState().doc;
  return d ? Math.min(d.width, d.height) : 1000;
}

/** Dibuja un rectángulo redondeado como trazado (sin relleno). */
export function roundRectPath(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number, begin = true) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (begin) ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Dibuja `src` cubriendo el rectángulo (recorte centrado, como object-fit: cover). */
export function drawCover(ctx: Ctx2D, src: CanvasImageSource & { width: number; height: number }, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / src.width, h / src.height);
  const sw = w / s, sh = h / s;
  ctx.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, x, y, w, h);
}

/** Carga un archivo de imagen como bitmap (con límite de tamaño para ahorrar memoria). */
export async function loadBitmap(file: Blob, maxDim = 2400): Promise<ImageBitmap> {
  const { decodeImage } = await import('../core/image');
  return decodeImage(file, maxDim);
}

/** Imagen de muestra para vistas previas cuando no hay capa de imagen. */
export function sampleCanvas(w = 320, h = 220): AnyCanvas {
  const c = createCanvas(w, h);
  const x = ctx2d(c);
  const g = x.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#3b6fd8'); g.addColorStop(0.6, '#e98a5b'); g.addColorStop(1, '#7a3b80');
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  x.fillStyle = 'rgba(255,255,255,.85)'; x.beginPath(); x.arc(w * 0.7, h * 0.35, h * 0.14, 0, Math.PI * 2); x.fill();
  x.fillStyle = 'rgba(20,15,40,.6)'; x.beginPath(); x.moveTo(0, h); x.lineTo(w * 0.3, h * 0.55); x.lineTo(w * 0.55, h * 0.8); x.lineTo(w * 0.8, h * 0.5); x.lineTo(w, h * 0.8); x.lineTo(w, h); x.fill();
  return c;
}

/** Copia/escala una fuente a un lienzo cuyo lado mayor es `max`. */
export function thumbOf(src: CanvasImageSource & { width: number; height: number }, max: number): AnyCanvas {
  const s = Math.min(1, max / Math.max(src.width, src.height));
  const c = createCanvas(src.width * s, src.height * s);
  const x = ctx2d(c);
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/** Pinta un lienzo (Offscreen o DOM) en un <canvas> de la UI sin deformar. */
export function paintPreview(target: HTMLCanvasElement | null, src: AnyCanvas, bg: 'checker' | 'none' = 'checker') {
  if (!target) return;
  target.width = src.width; target.height = src.height;
  const x = target.getContext('2d');
  if (!x) return;
  x.clearRect(0, 0, target.width, target.height);
  if (bg === 'checker') {
    const s = 10;
    for (let yy = 0; yy < target.height; yy += s) for (let xx = 0; xx < target.width; xx += s) {
      x.fillStyle = ((xx / s + yy / s) & 1) ? '#2c2f38' : '#22252c';
      x.fillRect(xx, yy, s, s);
    }
  }
  x.drawImage(src as CanvasImageSource, 0, 0);
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const rad = (d: number) => (d * Math.PI) / 180;
export const escapeXml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
