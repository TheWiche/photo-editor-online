/**
 * Seguimiento del ciclo de vida del documento, hecho sólo con la API pública del store (subscribe/setState):
 *  - «original»: instantánea del documento recién abierto (para el comparador antes/después).
 *  - metadatos de la foto de origen (panel «Privacidad»).
 *  - eventos «fresh» (documento nuevo/abierto, historial vacío) y «closed».
 */
import { useSyncExternalStore } from 'react';
import { useEditor, type EditorState } from '../core/store';
import { readPhotoMeta, type PhotoInfo } from './exif';
import type { Snapshot } from './snapshot';

export type DocEvent = 'fresh' | 'closed';
const lifecycle = new Set<(e: DocEvent) => void>();
export const onDocLifecycle = (fn: (e: DocEvent) => void) => { lifecycle.add(fn); return () => { lifecycle.delete(fn); }; };

let original: Snapshot | null = null;
export const getOriginal = () => original;

/* ---------------------------------------------------------------- metadatos de origen */

let sourceInfo: PhotoInfo | null = null;
const srcListeners = new Set<() => void>();
export const getSourceInfo = () => sourceInfo;
export function setSourceInfo(i: PhotoInfo | null) { sourceInfo = i; srcListeners.forEach((l) => l()); }
export function useSourceInfo(): PhotoInfo | null {
  return useSyncExternalStore((cb) => { srcListeners.add(cb); return () => { srcListeners.delete(cb); }; }, getSourceInfo, getSourceInfo);
}

/* ---------------------------------------------------------------- suscripción al store */

let started = false;
export function startDocTracking() {
  if (started) return;
  started = true;
  const cur = useEditor.getState();
  if (cur.doc && !cur.past.length) original = { doc: cur.doc, masks: cur.masks };
  useEditor.subscribe((s: EditorState, prev: EditorState) => {
    if (s.doc === prev.doc) return;
    if (!s.doc) {
      original = null;
      setSourceInfo(null);
      lifecycle.forEach((f) => f('closed'));
    } else if (!s.past.length && !s.future.length) {
      original = { doc: s.doc, masks: s.masks };
      setSourceInfo(null);
      lifecycle.forEach((f) => f('fresh'));
    }
  });

  // Intercepta openImage (acción pública del store) para leer los metadatos del archivo antes de que se pierdan.
  const orig = useEditor.getState().openImage;
  const wrapped: EditorState['openImage'] = async (src, opts) => {
    const hadDoc = !!useEditor.getState().doc;
    const infoP = readPhotoMeta(src);
    await orig(src, opts);
    if (opts?.asLayer && hadDoc) return;
    setSourceInfo(await infoP);
  };
  useEditor.setState({ openImage: wrapped });
}
