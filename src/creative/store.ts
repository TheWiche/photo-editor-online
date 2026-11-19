import { create } from 'zustand';

export type SectionId = 'frames' | 'shapes' | 'stickers' | 'textfx' | 'collage' | 'templates' | 'watermark';

interface CreativeState {
  open: SectionId | null;
  batchOpen: boolean;
  setOpen(s: SectionId | null): void;
  setBatchOpen(v: boolean): void;
}

export const useCreative = create<CreativeState>((set) => ({
  open: 'frames', batchOpen: false,
  setOpen: (open) => set({ open }),
  setBatchOpen: (batchOpen) => set({ batchOpen }),
}));
