/**
 * Render de «instantáneas» (doc + máscaras) fuera del visor: miniaturas del historial, comparador y proyectos.
 * Usa su propio Compositor para no pisar las cachés del lienzo principal.
 */
import type { DocumentState } from '../core/contracts';
import { Compositor, createCanvas, ctx2d, type AnyCanvas, type Masks } from '../core/render';

const comp = new Compositor();

export interface Snapshot { doc: DocumentState; masks: Masks }

export function renderSnapshot(snap: Snapshot, scale: number, opts: { background?: string | null; preferDom?: boolean } = {}): AnyCanvas {
  const c = createCanvas(snap.doc.width * scale, snap.doc.height * scale, opts.preferDom);
  comp.compose(ctx2d(c), snap.doc, snap.masks, { scale: c.width / snap.doc.width, background: opts.background });
  comp.prune(new Set()); // no retiene lienzos ajustados (pueden ser enormes)
  return c;
}

export const fitScale = (doc: DocumentState, maxDim: number) => Math.min(1, maxDim / Math.max(doc.width, doc.height, 1));

/** Miniatura JPEG como dataURL (sincrónica). */
export function thumbDataUrl(snap: Snapshot, maxDim = 120): string {
  const c = renderSnapshot(snap, fitScale(snap.doc, maxDim), { background: '#22252d', preferDom: true }) as HTMLCanvasElement;
  return c.toDataURL('image/jpeg', 0.72);
}
