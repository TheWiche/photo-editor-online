/** Estado de UI de las funciones de producto (diálogos abiertos, proyecto actual, recuperación). */
import { create } from 'zustand';

export interface RecoverInfo { name: string; savedAt: number; width: number; height: number }

interface ProductState {
  projectsOpen: boolean;
  exportOpen: boolean;
  compareOpen: boolean;
  /** Proyecto de IndexedDB asociado al documento actual. */
  currentId: string | null;
  recover: RecoverInfo | null;
  busy: string | null;
  set(p: Partial<Omit<ProductState, 'set'>>): void;
}

export const useProduct = create<ProductState>()((set) => ({
  projectsOpen: false, exportOpen: false, compareOpen: false, currentId: null, recover: null, busy: null,
  set: (p) => set(p),
}));

export const productUI = {
  openProjects: () => useProduct.getState().set({ projectsOpen: true }),
  openExport: () => useProduct.getState().set({ exportOpen: true }),
  toggleCompare: (on?: boolean) => { const s = useProduct.getState(); s.set({ compareOpen: on ?? !s.compareOpen }); },
};
