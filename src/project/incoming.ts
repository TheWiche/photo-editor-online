/** Entradas externas: archivos compartidos (share_target), launchQueue (file_handlers) y accesos directos (?accion=). */
import { useUI } from '../ui/uiStore';
import { openIncoming } from './projects';
import { productUI } from './state';

const SHARE_CACHE = 'estudio-compartido-v1';

interface LaunchParams { files: { getFile(): Promise<File> }[] }
type LaunchWindow = Window & { launchQueue?: { setConsumer(cb: (p: LaunchParams) => void): void } };

export async function consumeSharedFiles(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    if (!(await caches.has(SHARE_CACHE))) return;
    const cache = await caches.open(SHARE_CACHE);
    const reqs = await cache.keys();
    const files: File[] = [];
    for (const r of reqs) {
      const res = await cache.match(r);
      if (!res) continue;
      const blob = await res.blob();
      let name = 'imagen';
      try { name = decodeURIComponent(res.headers.get('X-File-Name') ?? name); } catch { /* nombre tal cual */ }
      files.push(new File([blob], name, { type: res.headers.get('Content-Type') ?? blob.type }));
    }
    await caches.delete(SHARE_CACHE);
    if (files.length) await openIncoming(files);
  } catch (e) {
    console.warn('No se pudieron leer los archivos compartidos', e);
  }
}

function handleQueryActions() {
  const url = new URL(location.href);
  const action = url.searchParams.get('accion');
  const shared = url.searchParams.has('compartido');
  if (!action && !shared) return;
  url.searchParams.delete('accion');
  url.searchParams.delete('compartido');
  history.replaceState(null, '', url.pathname + (url.search || '') + url.hash);
  if (action === 'nuevo') useUI.getState().openDialog('new');
  if (action === 'proyectos') productUI.openProjects();
}

export function initIncoming() {
  (window as LaunchWindow).launchQueue?.setConsumer(async (p) => {
    if (!p.files?.length) return;
    const files = await Promise.all(p.files.map((h) => h.getFile()));
    await openIncoming(files);
  });
  void consumeSharedFiles();
  handleQueryActions();
}
