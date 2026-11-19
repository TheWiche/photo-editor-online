/**
 * Hooks y utilidades para que el editor use los módulos de IA.
 *
 *   const { installed, status } = useModuleStatus('remove-bg');
 *   if (!(await ensureInstalled('remove-bg'))) return; // abre el Centro de módulos si falta
 *   const result = await removeBackground(bitmap);
 *
 * Para mostrar el Centro cuando se pide: `const { open, focusId, close } = useHubRequest();`
 * (o escuchar el evento de ventana 'centro-modulos:abrir').
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { ModuleId } from '../core/contracts';
import { getModuleSpec, type ModuleSpec } from '../ai/registry';
import {
  closeModuleHub,
  getHubRequest,
  getStates,
  openModuleHub,
  subscribe,
  subscribeHub,
  type HubRequest,
  type ModuleState,
} from '../ai/status';
import { cancelInstall, detectBackend, ensureStatusLoaded, install, isInstalled, uninstall, type BackendInfo } from '../ai/client';

export { openModuleHub, closeModuleHub } from '../ai/status';

export interface UseModuleStatus extends ModuleState {
  info: ModuleSpec;
  installed: boolean;
  downloading: boolean;
  /** Descarga el módulo (una sola vez). Los errores quedan en `error`. */
  install: () => Promise<void>;
  cancel: () => void;
  remove: () => Promise<void>;
}

/** Estado en vivo de todos los módulos. */
export function useModuleStates(): Record<ModuleId, ModuleState> {
  useEffect(() => {
    void ensureStatusLoaded();
  }, []);
  return useSyncExternalStore(subscribe, getStates, getStates);
}

/** Estado en vivo de un módulo + acciones. */
export function useModuleStatus(id: ModuleId): UseModuleStatus {
  const states = useModuleStates();
  const st = states[id];
  const doInstall = useCallback(() => install(id).catch(() => undefined), [id]);
  const cancel = useCallback(() => cancelInstall(id), [id]);
  const remove = useCallback(() => uninstall(id), [id]);
  return {
    ...st,
    info: getModuleSpec(id),
    installed: st.status === 'installed',
    downloading: st.status === 'downloading',
    install: doInstall,
    cancel,
    remove,
  };
}

/**
 * Comprueba (contra la caché real) si el módulo está instalado. Si no lo está, abre el
 * Centro de módulos resaltando ese módulo y devuelve false.
 */
export async function ensureInstalled(id: ModuleId, opts: { openHub?: boolean } = {}): Promise<boolean> {
  const spec = getModuleSpec(id);
  if (spec.availability === 'proximamente') return false;
  if (await isInstalled(id)) return true;
  if (opts.openHub !== false) openModuleHub(id);
  return false;
}

/** Petición de abrir/cerrar el Centro de módulos (para el componente que lo muestra). */
export function useHubRequest(): HubRequest & { close: () => void; openHub: (id?: ModuleId | null) => void } {
  const req = useSyncExternalStore(subscribeHub, getHubRequest, getHubRequest);
  return { ...req, close: closeModuleHub, openHub: (id?: ModuleId | null) => openModuleHub(id ?? null) };
}

/** Motor detectado (WebGPU o WASM). null mientras se detecta. */
export function useBackend(): BackendInfo | null {
  const [b, setB] = useState<BackendInfo | null>(null);
  useEffect(() => {
    let alive = true;
    void detectBackend().then((r) => alive && setB(r));
    return () => {
      alive = false;
    };
  }, []);
  return b;
}
