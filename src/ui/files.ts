import { useEditor } from '../core/store';
import { useUI } from './uiStore';

export const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,image/svg+xml';

/**
 * Abre imágenes. mode 'auto': documento nuevo si no hay ninguno, si no como capa.
 * 'new': la primera crea documento nuevo. 'layer': todas como capas.
 */
export async function openFiles(files: Iterable<File | Blob>, mode: 'auto' | 'new' | 'layer' = 'auto') {
  const list = [...files].filter((f) => !f.type || f.type.startsWith('image/'));
  const { toast } = useUI.getState();
  if (!list.length) { toast('Ese archivo no es una imagen compatible', 'error'); return; }
  for (let i = 0; i < list.length; i++) {
    const hasDoc = !!useEditor.getState().doc;
    const asLayer = hasDoc && (mode === 'layer' || i > 0 || mode === 'auto');
    try {
      await useEditor.getState().openImage(list[i], { asLayer });
    } catch (e) {
      toast(`No se pudo abrir la imagen: ${(e as Error).message}`, 'error');
    }
  }
}

/** Muestra el selector de archivos del sistema. */
export function pickFiles(mode: 'auto' | 'new' | 'layer' = 'new') {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = ACCEPT;
  input.multiple = true;
  input.addEventListener('change', () => {
    if (input.files?.length) void openFiles([...input.files], mode);
  });
  input.click();
}
