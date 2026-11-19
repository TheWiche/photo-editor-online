/** Utilidades de imagen válidas en hilo principal y en Web Worker (OffscreenCanvas). */

export type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
export type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

export function createCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

export function ctx2d(canvas: AnyCanvas, willReadFrequently = true): Ctx2D {
  const ctx = canvas.getContext('2d', { willReadFrequently }) as Ctx2D | null;
  if (!ctx) throw new Error('No se pudo crear un contexto 2D');
  return ctx;
}

export function bitmapToImageData(bmp: ImageBitmap | AnyCanvas, width = bmp.width, height = bmp.height): ImageData {
  const c = createCanvas(width, height);
  const ctx = ctx2d(c);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp as CanvasImageSource, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

export function imageDataToBitmap(data: ImageData): Promise<ImageBitmap> {
  return createImageBitmap(data);
}

export function hasTransparency(data: ImageData): boolean {
  const d = data.data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
  return false;
}

/** Convierte datos de 1, 3 o 4 canales a ImageData RGBA. */
export function toImageData(src: ArrayLike<number>, width: number, height: number, channels: number): ImageData {
  const out = new ImageData(width, height);
  const o = out.data;
  const n = width * height;
  if (channels === 4) {
    o.set(src as ArrayLike<number>);
  } else if (channels === 3) {
    for (let i = 0, j = 0, k = 0; i < n; i++, j += 3, k += 4) {
      o[k] = src[j]; o[k + 1] = src[j + 1]; o[k + 2] = src[j + 2]; o[k + 3] = 255;
    }
  } else if (channels === 1) {
    for (let i = 0, k = 0; i < n; i++, k += 4) {
      const v = src[i];
      o[k] = v; o[k + 1] = v; o[k + 2] = v; o[k + 3] = 255;
    }
  } else if (channels === 2) {
    for (let i = 0, j = 0, k = 0; i < n; i++, j += 2, k += 4) {
      const v = src[j];
      o[k] = v; o[k + 1] = v; o[k + 2] = v; o[k + 3] = src[j + 1];
    }
  }
  return out;
}

/** Copia una imagen para poder transferirla al worker sin invalidar el original. */
export async function cloneBitmap(src: ImageBitmap): Promise<ImageBitmap> {
  return createImageBitmap(src);
}
