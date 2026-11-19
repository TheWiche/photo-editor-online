/**
 * BORRADOR MÁGICO (LaMa) listo para una herramienta de lienzo.
 *
 *   const out = await eraseWithMask(layer.bitmap, strokeMask);          // máscara del tamaño de la capa
 *   useEditor.getState().replaceLayerBitmap(layer.id, out, undefined, 'Borrador mágico');
 *
 * Mejoras sobre la llamada directa al modelo:
 *  - Separa la máscara en zonas (trazos alejados) y procesa cada una con su propio recorte.
 *  - Recorte CUADRADO con contexto alrededor de la zona (sin deformar), relleno por réplica de
 *    bordes si la imagen es más pequeña que el recorte.
 *  - LaMa trabaja a 512×512; el resultado se reescala a la resolución original y se funde con un
 *    borde suave (feather) SOLO dentro de la zona borrada: el resto de la foto queda intacto.
 */
import type { ProgressEvent } from '../../core/contracts';
import { inpaint } from '../client';
import { createCanvas, ctx2d, type AnyCanvas } from '../imageUtils';
import { CancelledError } from '../types';
import { bboxOf, blurAlpha, dilate, docSpaceToLayer, type DocSize, type LayerGeometry } from './geometry';

export const LAMA_SIZE = 512;

export interface EraseOptions {
  signal?: AbortSignal;
  /** Progreso por zona procesada. */
  onProgress?: (e: ProgressEvent) => void;
  /** Ampliación de la máscara en px originales (por defecto ~0,6 % del lado largo, mín. 3). */
  dilate?: number;
  /** Ancho del borde suave en px originales (por defecto ~0,8 % del lado largo, mín. 3). */
  feather?: number;
  /** Contexto alrededor de la zona (× tamaño de la zona). Por defecto 2,2. */
  context?: number;
  /**
   * Si la máscara está en coordenadas del DOCUMENTO (p. ej. la selección activa), indica el
   * documento y la geometría de la capa para convertirla a píxeles de la capa.
   */
  maskSpace?: { doc: DocSize; layer: LayerGeometry };
}

interface Region { x0: number; y0: number; x1: number; y1: number }

function readCanvas(src: CanvasImageSource, w: number, h: number): { canvas: AnyCanvas; data: ImageData } {
  const canvas = createCanvas(w, h);
  const ctx = ctx2d(canvas);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return { canvas, data: ctx.getImageData(0, 0, w, h) };
}

/** Agrupa la máscara en zonas: componentes conexas sobre una rejilla gruesa, fusionando las que se solapan. */
function findRegions(bin: Uint8Array, W: number, H: number, gap: number): Region[] {
  const cell = Math.max(4, Math.round(gap));
  const GW = Math.ceil(W / cell), GH = Math.ceil(H / cell);
  const grid = new Uint8Array(GW * GH);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (bin[y * W + x]) grid[((y / cell) | 0) * GW + ((x / cell) | 0)] = 1;
  const seen = new Uint8Array(GW * GH);
  const regions: Region[] = [];
  const stack: number[] = [];
  for (let i = 0; i < grid.length; i++) {
    if (!grid[i] || seen[i]) continue;
    let gx0 = GW, gy0 = GH, gx1 = -1, gy1 = -1;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      const cx = c % GW, cy = (c / GW) | 0;
      if (cx < gx0) gx0 = cx;
      if (cx > gx1) gx1 = cx;
      if (cy < gy0) gy0 = cy;
      if (cy > gy1) gy1 = cy;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
          const n = ny * GW + nx;
          if (grid[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
        }
      }
    }
    regions.push({ x0: gx0 * cell, y0: gy0 * cell, x1: Math.min(W, (gx1 + 1) * cell), y1: Math.min(H, (gy1 + 1) * cell) });
  }
  return regions;
}

interface Crop { x: number; y: number; side: number }

function cropFor(r: Region, W: number, H: number, context: number): Crop {
  const rw = r.x1 - r.x0, rh = r.y1 - r.y0;
  // Al menos 512 px de lado (si la imagen lo permite) para no ampliar zonas pequeñas en exceso.
  let side = Math.max(Math.round(Math.max(rw, rh) * context), Math.min(LAMA_SIZE, Math.max(W, H)));
  side = Math.min(side, Math.max(W, H));
  const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
  let x = Math.round(cx - side / 2), y = Math.round(cy - side / 2);
  // Desplaza dentro de la imagen cuando cabe; si no cabe (imagen estrecha), queda centrado.
  x = side <= W ? Math.max(0, Math.min(W - side, x)) : Math.round((W - side) / 2);
  y = side <= H ? Math.max(0, Math.min(H - side, y)) : Math.round((H - side) / 2);
  return { x, y, side };
}

/** Recorte cuadrado a 512 px; lo que queda fuera de la imagen se rellena replicando el borde. */
function cropTo512(src: AnyCanvas, W: number, H: number, c: Crop): AnyCanvas {
  const out = createCanvas(LAMA_SIZE, LAMA_SIZE);
  const ctx = ctx2d(out);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const s = LAMA_SIZE / c.side;
  const sx0 = Math.max(0, c.x), sy0 = Math.max(0, c.y);
  const sx1 = Math.min(W, c.x + c.side), sy1 = Math.min(H, c.y + c.side);
  const dx0 = Math.round((sx0 - c.x) * s), dy0 = Math.round((sy0 - c.y) * s);
  const dx1 = Math.round((sx1 - c.x) * s), dy1 = Math.round((sy1 - c.y) * s);
  ctx.drawImage(src as CanvasImageSource, sx0, sy0, sx1 - sx0, sy1 - sy0, dx0, dy0, dx1 - dx0, dy1 - dy0);
  if (dx0 > 0 || dy0 > 0 || dx1 < LAMA_SIZE || dy1 < LAMA_SIZE) {
    const d = ctx.getImageData(0, 0, LAMA_SIZE, LAMA_SIZE);
    const px = d.data;
    for (let y = 0; y < LAMA_SIZE; y++) {
      const yy = Math.min(dy1 - 1, Math.max(dy0, y));
      for (let x = 0; x < LAMA_SIZE; x++) {
        if (x >= dx0 && x < dx1 && y >= dy0 && y < dy1) continue;
        const xx = Math.min(dx1 - 1, Math.max(dx0, x));
        const k = (y * LAMA_SIZE + x) * 4, j = (yy * LAMA_SIZE + xx) * 4;
        px[k] = px[j]; px[k + 1] = px[j + 1]; px[k + 2] = px[j + 2]; px[k + 3] = 255;
      }
    }
    ctx.putImageData(d, 0, 0);
  }
  return out;
}

const toBitmap = (c: AnyCanvas) => createImageBitmap(c as OffscreenCanvas | HTMLCanvasElement);

/**
 * Borra la zona marcada (alfa ≥ 128 de `maskBitmap`) y la rellena imitando el entorno.
 * `maskBitmap` debe tener el tamaño de la capa (o se escala), salvo que se pase `maskSpace`.
 * Devuelve un ImageBitmap NUEVO del mismo tamaño que la capa.
 */
export async function eraseWithMask(layerBitmap: ImageBitmap, maskBitmap: ImageBitmap | ImageData, opts: EraseOptions = {}): Promise<ImageBitmap> {
  const W = layerBitmap.width, H = layerBitmap.height;
  const long = Math.max(W, H);
  const maskSrc: CanvasImageSource = maskBitmap instanceof ImageData ? (await createImageBitmap(maskBitmap)) : maskBitmap;
  const maskLayer = opts.maskSpace
    ? docSpaceToLayer(maskSrc, W, H, opts.maskSpace.layer, opts.maskSpace.doc)
    : readCanvas(maskSrc, W, H).canvas;
  if (maskBitmap instanceof ImageData) (maskSrc as ImageBitmap).close();
  const mData = ctx2d(maskLayer).getImageData(0, 0, W, H).data;
  const raw = new Uint8Array(W * H);
  for (let i = 0; i < raw.length; i++) raw[i] = mData[i * 4 + 3] >= 128 ? 1 : 0;
  const { canvas: imgCanvas, data: imgData } = readCanvas(layerBitmap, W, H);
  if (!bboxOf(raw, W, H)) return toBitmap(imgCanvas);

  const dil = Math.max(3, Math.round(opts.dilate ?? long * 0.006));
  const feather = Math.max(3, Math.round(opts.feather ?? long * 0.008));
  const bin = dilate(raw, W, H, dil);
  const context = opts.context ?? 2.2;

  // Zonas: trazos separados por más de ~1/6 del lado de recorte se procesan aparte;
  // zonas cuyos recortes se solapan mucho se fusionan.
  let regions = findRegions(bin, W, H, Math.max(8, long / 40));
  for (let changed = true; changed && regions.length > 1; ) {
    changed = false;
    outer: for (let i = 0; i < regions.length; i++) {
      for (let j = i + 1; j < regions.length; j++) {
        const a = regions[i], b = regions[j];
        const ca = cropFor(a, W, H, context);
        const inA = b.x0 >= ca.x && b.y0 >= ca.y && b.x1 <= ca.x + ca.side && b.y1 <= ca.y + ca.side;
        const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        if (inA || (ix > -feather * 2 && iy > -feather * 2)) {
          regions[i] = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
          regions.splice(j, 1);
          changed = true;
          break outer;
        }
      }
    }
  }
  regions = regions.slice(0, 24);

  // Máscara de fusión a resolución original: zona dilatada + borde suave (solo hacia fuera).
  const blend = new Float32Array(W * H);
  for (let i = 0; i < blend.length; i++) blend[i] = bin[i] * 255;
  blurAlpha(blend, W, H, feather);
  for (let i = 0; i < blend.length; i++) if (raw[i]) blend[i] = 255;

  const result = new Uint8ClampedArray(imgData.data);
  const maskBin = createCanvas(W, H);
  {
    const md = new ImageData(W, H);
    for (let i = 0; i < bin.length; i++) md.data[i * 4 + 3] = bin[i] ? 255 : 0;
    ctx2d(maskBin).putImageData(md, 0, 0);
  }
  let done = 0;
  for (const r of regions) {
    if (opts.signal?.aborted) throw new CancelledError();
    const crop = cropFor(r, W, H, context);
    // Imagen actual (incluye zonas ya rellenadas) y máscara de ESTA zona.
    const cur = createCanvas(W, H);
    ctx2d(cur).putImageData(new ImageData(new Uint8ClampedArray(result), W, H), 0, 0);
    const img512 = cropTo512(cur, W, H, crop);
    const zoneMask = createCanvas(W, H);
    {
      const zctx = ctx2d(zoneMask);
      zctx.drawImage(maskBin as CanvasImageSource, 0, 0);
      zctx.globalCompositeOperation = 'destination-in';
      zctx.fillRect(r.x0 - dil, r.y0 - dil, r.x1 - r.x0 + 2 * dil, r.y1 - r.y0 + 2 * dil);
    }
    const m512c = createCanvas(LAMA_SIZE, LAMA_SIZE);
    {
      const mctx = ctx2d(m512c);
      const s = LAMA_SIZE / crop.side;
      mctx.drawImage(zoneMask as CanvasImageSource, crop.x, crop.y, crop.side, crop.side, 0, 0, LAMA_SIZE, LAMA_SIZE);
      // Binarizar (el reescalado deja bordes grises) y asegurar al menos 1 px por trazo fino.
      const d = mctx.getImageData(0, 0, LAMA_SIZE, LAMA_SIZE);
      for (let i = 3; i < d.data.length; i += 4) d.data[i] = d.data[i] >= (s < 1 ? 40 : 128) ? 255 : 0;
      mctx.putImageData(d, 0, 0);
    }
    const [imgBmp, maskBmp] = await Promise.all([toBitmap(img512), toBitmap(m512c)]);
    let out512: ImageBitmap;
    try {
      out512 = await inpaint(imgBmp, maskBmp, { signal: opts.signal });
    } finally {
      imgBmp.close();
      maskBmp.close();
    }
    // Reescala el parche a la resolución original y lo funde dentro de la zona.
    const patch = createCanvas(W, H);
    const pctx = ctx2d(patch);
    pctx.imageSmoothingEnabled = true;
    pctx.imageSmoothingQuality = 'high';
    pctx.drawImage(out512, 0, 0, LAMA_SIZE, LAMA_SIZE, crop.x, crop.y, crop.side, crop.side);
    out512.close();
    const x0 = Math.max(0, crop.x), y0 = Math.max(0, crop.y);
    const x1 = Math.min(W, crop.x + crop.side), y1 = Math.min(H, crop.y + crop.side);
    const pd = pctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    const pw = x1 - x0;
    // Solo los píxeles de esta zona (más su borde suave).
    const zx0 = Math.max(x0, r.x0 - dil - feather * 2), zy0 = Math.max(y0, r.y0 - dil - feather * 2);
    const zx1 = Math.min(x1, r.x1 + dil + feather * 2), zy1 = Math.min(y1, r.y1 + dil + feather * 2);
    for (let y = zy0; y < zy1; y++) {
      for (let x = zx0; x < zx1; x++) {
        const i = y * W + x;
        const a = blend[i] / 255;
        if (a <= 0) continue;
        const k = i * 4, pk = ((y - y0) * pw + (x - x0)) * 4;
        result[k] += (pd[pk] - result[k]) * a;
        result[k + 1] += (pd[pk + 1] - result[k + 1]) * a;
        result[k + 2] += (pd[pk + 2] - result[k + 2]) * a;
        // El alfa original se conserva (LaMa trabaja en RGB).
      }
    }
    done++;
    opts.onProgress?.({ file: 'Borrador mágico', loadedBytes: done, totalBytes: regions.length, progress: done / regions.length });
  }
  return createImageBitmap(new ImageData(result, W, H));
}

/** Atajo: borra la SELECCIÓN activa (máscara del documento) de una capa. */
export function eraseSelection(
  layerBitmap: ImageBitmap,
  selection: ImageBitmap,
  doc: DocSize,
  layer: LayerGeometry,
  opts: Omit<EraseOptions, 'maskSpace'> = {},
): Promise<ImageBitmap> {
  return eraseWithMask(layerBitmap, selection, { ...opts, maskSpace: { doc, layer } });
}
