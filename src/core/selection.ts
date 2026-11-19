/**
 * SELECCIÓN ACTIVA (contrato). Dueño: agente de edición clásica (lo implementa de verdad).
 * La máscara es un ImageBitmap del tamaño del documento: alfa 255 = seleccionado.
 * Otros módulos (IA, retoque) llaman solo a esta API.
 */
type Listener = () => void;
let current: ImageBitmap | null = null;
const listeners = new Set<Listener>();

export const getSelection = (): ImageBitmap | null => current;
export function setSelection(mask: ImageBitmap | null): void {
  current?.close?.();
  current = mask;
  listeners.forEach((l) => l());
}
export const clearSelection = () => setSelection(null);
export const subscribeSelection = (l: Listener) => { listeners.add(l); return () => { listeners.delete(l); }; };
