import { create } from 'zustand';
import { readPref, writePref } from './storage';

export type RightTab = string; // 'layers' | 'adjust' | 'filters' | 'ai' | ids de extensiones
export type DialogId = 'export' | 'new' | 'shortcuts' | 'ai' | null;

export interface Toast { id: number; text: string; kind: 'info' | 'success' | 'error' }

interface UIState {
  rightTab: RightTab;
  /** Panel derecho abierto como hoja inferior (móvil). */
  sheetOpen: boolean;
  dialog: DialogId;
  tourOpen: boolean;
  whatOpen: boolean;
  toasts: Toast[];
  /** Se incrementa para pedir foco en el campo de texto de la barra de opciones. */
  textFocus: number;
  setRightTab(t: RightTab): void;
  setSheetOpen(o: boolean): void;
  openDialog(d: DialogId): void;
  startTour(): void;
  endTour(completed: boolean): void;
  setWhatOpen(o: boolean): void;
  toast(text: string, kind?: Toast['kind']): void;
  dismissToast(id: number): void;
  focusText(): void;
}

let toastId = 0;

export const useUI = create<UIState>()((set, get) => ({
  rightTab: 'layers',
  sheetOpen: false,
  dialog: null,
  tourOpen: false,
  whatOpen: readPref('whatOpen', typeof window === 'undefined' || window.innerWidth > 760),
  toasts: [],
  textFocus: 0,
  setRightTab: (rightTab) => set({ rightTab }),
  setSheetOpen: (sheetOpen) => set({ sheetOpen }),
  openDialog: (dialog) => set({ dialog }),
  startTour: () => set({ tourOpen: true, dialog: null }),
  endTour: (completed) => { writePref('tourDone', completed ? 'done' : 'skipped'); set({ tourOpen: false }); },
  setWhatOpen: (whatOpen) => { writePref('whatOpen', whatOpen); set({ whatOpen }); },
  toast: (text, kind = 'info') => {
    const id = ++toastId;
    set({ toasts: [...get().toasts.slice(-3), { id, text, kind }] });
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 6000 : 3200);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  focusText: () => set({ textFocus: get().textFocus + 1 }),
}));

export const isTourDone = () => readPref<string | null>('tourDone', null) !== null;
