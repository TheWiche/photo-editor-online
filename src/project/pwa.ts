/** PWA: botón «Instalar app» (beforeinstallprompt), aviso de «Nueva versión disponible» y registro del service worker. */
import { create } from 'zustand';
import { registerSW } from 'virtual:pwa-register';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PwaState {
  canInstall: boolean;
  installed: boolean;
  updateReady: boolean;
  offlineReady: boolean;
  installDismissed: boolean;
  set(p: Partial<Omit<PwaState, 'set'>>): void;
}

const standalone = () => {
  try { return window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true; } catch { return false; }
};

export const usePwa = create<PwaState>()((set) => ({
  canInstall: false, installed: standalone(), updateReady: false, offlineReady: false, installDismissed: false,
  set: (p) => set(p),
}));

let deferred: BeforeInstallPromptEvent | null = null;
let updateSW: ((reload?: boolean) => Promise<void>) | null = null;
let registration: ServiceWorkerRegistration | undefined;
let started = false;

export function initPwa() {
  if (started) return;
  started = true;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    usePwa.getState().set({ canInstall: true });
  });
  window.addEventListener('appinstalled', () => { deferred = null; usePwa.getState().set({ canInstall: false, installed: true }); });
  if (!('serviceWorker' in navigator)) return;
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh: () => usePwa.getState().set({ updateReady: true }),
    onOfflineReady: () => usePwa.getState().set({ offlineReady: true }),
    onRegisteredSW: (_url, reg) => {
      registration = reg;
      // Busca versiones nuevas cada hora mientras la pestaña esté abierta.
      if (reg) setInterval(() => { if (navigator.onLine) void reg.update().catch(() => {}); }, 3600_000);
    },
  });
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  usePwa.getState().set({ canInstall: false });
  await e.prompt();
  const r = await e.userChoice;
  return r.outcome === 'accepted';
}

/** Activa la versión nueva y recarga. */
export function applyUpdate() { void updateSW?.(true); }

export async function checkForUpdate(): Promise<void> { await registration?.update().catch(() => {}); }
