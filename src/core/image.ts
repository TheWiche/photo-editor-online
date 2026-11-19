import { createCanvas, ctx2d, type AnyCanvas } from './render';

export const MAX_DIMENSION = 8192;

/** Decodifica un Blob/File a ImageBitmap respetando la orientación EXIF y limitando el tamaño. */
export async function decodeImage(src: Blob, maxDim = MAX_DIMENSION): Promise<ImageBitmap> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(src, { imageOrientation: 'from-image' });
  } catch {
    bmp = await decodeViaElement(src);
  }
  const big = Math.max(bmp.width, bmp.height);
  if (big > maxDim) {
    const s = maxDim / big;
    const resized = await createImageBitmap(bmp, {
      resizeWidth: Math.round(bmp.width * s), resizeHeight: Math.round(bmp.height * s), resizeQuality: 'high',
    });
    bmp.close();
    bmp = resized;
  }
  return bmp;
}

function decodeViaElement(src: Blob): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(src);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || 1024, h = img.naturalHeight || 1024;
      createImageBitmap(img, { resizeWidth: w, resizeHeight: h })
        .then(resolve, reject)
        .finally(() => URL.revokeObjectURL(url));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Formato de imagen no compatible')); };
    img.src = url;
  });
}

/** Copia un lienzo a ImageBitmap. Con `transfer` (sólo OffscreenCanvas) el lienzo queda vacío. */
export async function canvasToBitmap(c: AnyCanvas, transfer = false): Promise<ImageBitmap> {
  if (transfer && 'transferToImageBitmap' in c) return (c as OffscreenCanvas).transferToImageBitmap();
  return createImageBitmap(c);
}

export async function solidBitmap(w: number, h: number, color: string | null): Promise<ImageBitmap> {
  const c = createCanvas(w, h);
  if (color) { const ctx = ctx2d(c); ctx.fillStyle = color; ctx.fillRect(0, 0, c.width, c.height); }
  return canvasToBitmap(c, true);
}

/** Imagen sintética de ejemplo (degradado + formas) para probar el editor sin archivos. */
export async function sampleBitmap(w = 1600, h = 1067): Promise<ImageBitmap> {
  const c = createCanvas(w, h);
  const ctx = ctx2d(c);
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#1d3b72'); sky.addColorStop(0.55, '#f08a4b'); sky.addColorStop(1, '#3b1d3a');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
  const sun = ctx.createRadialGradient(w * 0.68, h * 0.56, 0, w * 0.68, h * 0.56, h * 0.28);
  sun.addColorStop(0, 'rgba(255,240,190,1)'); sun.addColorStop(0.35, 'rgba(255,190,110,0.9)'); sun.addColorStop(1, 'rgba(255,140,80,0)');
  ctx.fillStyle = sun; ctx.fillRect(0, 0, w, h);
  const layersM = [['#4a2a4f', 0.62, 0.09], ['#2e1b36', 0.72, 0.07], ['#160f1f', 0.84, 0.05]] as const;
  layersM.forEach(([col, base, amp], i) => {
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) {
      const y = h * base + Math.sin(x / (140 + i * 60) + i * 2) * h * amp + Math.sin(x / 37 + i) * h * 0.01;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
  });
  return canvasToBitmap(c, true);
}

export function stripExtension(name: string): string {
  return name.replace(/\.[a-z0-9]{2,5}$/i, '') || 'imagen';
}
