/**
 * SELECCIÓN INTELIGENTE (SlimSAM) lista para una herramienta de lienzo.
 *
 *   const r = await segmentFromPoints(layer.bitmap, [{ x, y, label: 1 }], { doc, layer, imageKey: layer.id });
 *   setSelection(r.mask);            // máscara del tamaño del documento (alfa 255 = seleccionado)
 *
 * - Los puntos van en COORDENADAS DEL DOCUMENTO (las del clic sobre el lienzo); se convierten a
 *   píxeles de la capa con su posición/escala/rotación.
 * - label 1 = «forma parte del objeto», 0 = «no forma parte» (p. ej. Alt+clic).
 * - El primer clic analiza la imagen (unos segundos); los siguientes con el mismo `imageKey`
 *   reutilizan el análisis y son casi instantáneos.
 */
import type { SegmentPoint } from '../types';
import { segmentPoint } from '../client';
import { createCanvas, ctx2d } from '../imageUtils';
import { bboxOf, blurAlpha, docToLayer, IDENTITY, layerSpaceToDoc, type DocSize, type LayerGeometry } from './geometry';

export interface SegmentFromPointsOptions {
  /** Tamaño del documento. Si se omite, se usa el tamaño de la capa. */
  doc?: DocSize;
  /** Posición/escala/rotación de la capa en el documento (por defecto, en 0,0 sin transformar). */
  layer?: LayerGeometry;
  /** Clave para reutilizar el análisis de la misma imagen (p. ej. `${layer.id}:${versión}`). */
  imageKey?: string;
  /** Suavizado del borde en px del documento (0 = borde duro). Por defecto 1. */
  feather?: number;
  /** Amplía (+) o contrae (−) la selección en px del documento. */
  grow?: number;
  signal?: AbortSignal;
}

export interface SmartSelection {
  /** Máscara del tamaño del DOCUMENTO: blanco, alfa 255 = seleccionado. Pásala a setSelection(). */
  mask: ImageBitmap;
  /** La misma máscara a resolución de la capa (por si la herramienta la necesita). */
  layerMask: ImageData;
  /** Confianza del modelo (0..1). */
  score: number;
  /** Rectángulo de la selección en el documento (px), o null si quedó vacía. */
  bbox: { x: number; y: number; width: number; height: number } | null;
  /** Puntos realmente usados, en píxeles de la capa. */
  layerPoints: SegmentPoint[];
}

export async function segmentFromPoints(layerBitmap: ImageBitmap, points: SegmentPoint[], opts: SegmentFromPointsOptions = {}): Promise<SmartSelection> {
  const W = layerBitmap.width, H = layerBitmap.height;
  const g = opts.layer ?? IDENTITY;
  const doc = opts.doc ?? { width: W, height: H };
  const layerPoints: SegmentPoint[] = points
    .map((p) => ({ ...docToLayer(g, W, H, p), label: p.label ?? 1 }) as SegmentPoint)
    .filter((p) => p.x >= 0 && p.y >= 0 && p.x < W && p.y < H);
  if (!layerPoints.some((p) => (p.label ?? 1) === 1)) {
    throw new Error('Haz clic sobre el objeto dentro de la imagen de la capa.');
  }
  const res = await segmentPoint(layerBitmap, layerPoints, { imageKey: opts.imageKey, signal: opts.signal });
  res.bitmap.close();
  const layerMask = res.mask; // W×H, alfa 255 dentro

  // Ajustes de borde a resolución de la capa (convertimos px del documento → px de la capa).
  const pxScale = 1 / Math.max(1e-6, (Math.abs(g.scaleX) + Math.abs(g.scaleY)) / 2);
  const grow = (opts.grow ?? 0) * pxScale;
  const feather = (opts.feather ?? 1) * pxScale;
  if (grow !== 0 || feather > 0) {
    const a = new Float32Array(W * H);
    for (let i = 0; i < a.length; i++) a[i] = layerMask.data[i * 4 + 3];
    if (grow !== 0) {
      // Crecer/contraer: desenfocar y umbralizar desplazado.
      blurAlpha(a, W, H, Math.abs(grow) * 2);
      const th = grow > 0 ? 40 : 215;
      for (let i = 0; i < a.length; i++) a[i] = a[i] >= th ? 255 : 0;
    }
    if (feather > 0) blurAlpha(a, W, H, feather);
    for (let i = 0; i < a.length; i++) {
      const k = i * 4;
      layerMask.data[k] = 255; layerMask.data[k + 1] = 255; layerMask.data[k + 2] = 255;
      layerMask.data[k + 3] = a[i];
    }
  }

  const lc = createCanvas(W, H);
  ctx2d(lc).putImageData(layerMask, 0, 0);
  const docCanvas = layerSpaceToDoc(lc as CanvasImageSource, W, H, g, doc);
  const docData = ctx2d(docCanvas).getImageData(0, 0, doc.width, doc.height);
  const bin = new Uint8Array(doc.width * doc.height);
  for (let i = 0; i < bin.length; i++) bin[i] = docData.data[i * 4 + 3] >= 128 ? 1 : 0;
  const mask = await createImageBitmap(docData);
  return { mask, layerMask, score: res.score, bbox: bboxOf(bin, doc.width, doc.height), layerPoints };
}

/** Atajo: segmenta y deja el resultado como selección activa (contrato src/core/selection.ts). */
export async function selectFromPoints(layerBitmap: ImageBitmap, points: SegmentPoint[], opts: SegmentFromPointsOptions = {}): Promise<SmartSelection> {
  const r = await segmentFromPoints(layerBitmap, points, opts);
  const { setSelection } = await import('../../core/selection');
  setSelection(await createImageBitmap(r.mask));
  return r;
}
