/** File System Access API con alternativa de descarga / <input type=file>. */
import { downloadBlob } from '../core/export';

interface PickerType { description: string; accept: Record<string, string[]> }
type SaveHandle = { name: string; createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }> };
type FsWindow = Window & {
  showSaveFilePicker?: (o: { suggestedName?: string; types?: PickerType[]; id?: string }) => Promise<SaveHandle>;
  showOpenFilePicker?: (o: { types?: PickerType[]; multiple?: boolean; id?: string }) => Promise<{ getFile(): Promise<File> }[]>;
};
const w = () => window as FsWindow;

export const canSaveToDisk = () => typeof w().showSaveFilePicker === 'function';
export const isAbort = (e: unknown) => (e as { name?: string })?.name === 'AbortError';

export type SaveResult = 'saved' | 'downloaded' | 'cancelled';

export interface SaveOpts { types?: PickerType[]; handle?: SaveHandle | null; forcePicker?: boolean; id?: string }

/**
 * Guarda el blob. Con File System Access abre «Guardar como» (o reescribe el `handle` dado);
 * sin ella descarga el archivo. Devuelve también el handle por si se quiere reutilizar.
 */
export async function saveToDisk(blob: Blob, fileName: string, opts: SaveOpts = {}): Promise<{ result: SaveResult; handle?: SaveHandle }> {
  if (canSaveToDisk()) {
    try {
      const handle = !opts.forcePicker && opts.handle
        ? opts.handle
        : await w().showSaveFilePicker!({ suggestedName: fileName, types: opts.types, id: opts.id });
      const ws = await handle.createWritable();
      await ws.write(blob);
      await ws.close();
      return { result: 'saved', handle };
    } catch (e) {
      if (isAbort(e)) return { result: 'cancelled' };
      if (!opts.handle || opts.forcePicker) console.warn('showSaveFilePicker falló; se descarga el archivo', e);
      // el handle puede haber perdido el permiso: se vuelve a preguntar la próxima vez
    }
  }
  downloadBlob(blob, fileName);
  return { result: 'downloaded' };
}

/** Pide un archivo al usuario (File System Access si existe, si no <input>). */
export async function pickFile(types: PickerType[], accept: string): Promise<File | null> {
  if (typeof w().showOpenFilePicker === 'function') {
    try {
      const [h] = await w().showOpenFilePicker!({ types, multiple: false });
      return await h.getFile();
    } catch (e) {
      if (isAbort(e)) return null;
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
