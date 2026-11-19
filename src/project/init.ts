/** Arranque único de las funciones de producto. Se importa desde src/ui/ext/product.tsx. */
import { startAutosave } from './autosave';
import { initIncoming } from './incoming';
import { initProjects } from './projects';
import { initPwa } from './pwa';

let done = false;
export function initProduct() {
  if (done || typeof window === 'undefined') return;
  done = true;
  initProjects();
  startAutosave();
  initPwa();
  initIncoming();
}
