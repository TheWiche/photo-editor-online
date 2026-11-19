/**
 * Historial visual. Se apoya en `past`/`future` del store (cada HistoryEntry guarda el documento ANTERIOR a la acción
 * con su etiqueta), así que no hace falta un registro propio:
 *
 *   estados = [past[0].doc, …, past[n-1].doc, actual, future[m-1].doc, …, future[0].doc]
 *   etiqueta de past[i].doc (i>0) = past[i-1].label; del actual = past[n-1].label; del futuro j = future[j].label
 */
import type { DocumentState } from '../core/contracts';
import { useEditor, type EditorState } from '../core/store';
import type { Masks } from '../core/render';
import { thumbDataUrl } from './snapshot';

export interface TimelineItem {
  key: string;
  index: number;
  kind: 'initial' | 'past' | 'current' | 'future';
  label: string;
  doc: DocumentState | null;
  masks: Masks;
}

export function buildTimeline(s: Pick<EditorState, 'past' | 'future' | 'doc' | 'masks'>): TimelineItem[] {
  const out: TimelineItem[] = [];
  const n = s.past.length;
  s.past.forEach((e, i) => {
    out.push({ key: `p${i}`, index: i, kind: i === 0 ? 'initial' : 'past', label: i === 0 ? '' : s.past[i - 1].label, doc: e.doc, masks: e.masks });
  });
  out.push({ key: 'cur', index: n, kind: n === 0 ? 'initial' : 'current', label: n === 0 ? '' : s.past[n - 1].label, doc: s.doc, masks: s.masks });
  for (let j = s.future.length - 1; j >= 0; j--) {
    out.push({ key: `f${j}`, index: n + (s.future.length - j), kind: 'future', label: s.future[j].label, doc: s.future[j].doc, masks: s.future[j].masks });
  }
  // La entrada actual también es «inicial» si no hay pasado: se marca el índice actual aparte.
  return out;
}

/** Salta al paso `target` con undo()/redo() (API pública del store). */
export function jumpTo(target: number): void {
  const get = () => useEditor.getState();
  let guard = 200;
  while (guard-- > 0) {
    const cur = get().past.length;
    if (cur === target) return;
    if (cur > target) get().undo(); else get().redo();
    if (get().past.length === cur) return; // sin progreso
  }
}

/* --------------------------------------------------------------- miniaturas */

const cache = new WeakMap<DocumentState, WeakMap<object, string>>();
let chain: Promise<unknown> = Promise.resolve();

export function cachedThumb(doc: DocumentState, masks: Masks): string | undefined {
  return cache.get(doc)?.get(masks);
}

/** Genera miniaturas en serie, cediendo el hilo entre una y otra para no bloquear la edición. */
export function requestThumb(doc: DocumentState, masks: Masks): Promise<string> {
  const hit = cachedThumb(doc, masks);
  if (hit) return Promise.resolve(hit);
  const p = chain.then(() => new Promise<string>((resolve) => {
    setTimeout(() => {
      let url = cachedThumb(doc, masks);
      if (!url) {
        try { url = thumbDataUrl({ doc, masks }, 120); } catch { url = ''; }
        let m = cache.get(doc);
        if (!m) { m = new WeakMap(); cache.set(doc, m); }
        m.set(masks, url);
      }
      resolve(url);
    }, 4);
  }));
  chain = p.catch(() => {});
  return p;
}
