/** Preferencias de producto persistidas (localStorage con try/catch). */
import { create } from 'zustand';
import { readPref, writePref } from '../ui/storage';

interface Prefs {
  stripMetadata: boolean;
  setStripMetadata(v: boolean): void;
}

export const usePrefs = create<Prefs>()((set) => ({
  stripMetadata: readPref('stripMetadata', true),
  setStripMetadata: (v) => { writePref('stripMetadata', v); set({ stripMetadata: v }); },
}));
