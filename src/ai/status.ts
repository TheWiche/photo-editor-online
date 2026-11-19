/**
 * Estado observable (sin dependencias) de los módulos de IA y de la petición de abrir el
 * Centro de módulos. Compatible con React `useSyncExternalStore`.
 */
import type { ModuleId, ModuleStatus } from '../core/contracts';
import type { VariantKey } from './types';
import { MODULE_IDS } from './registry';

export interface ModuleState {
  status: ModuleStatus;
  /** Bytes descargados / totales estimados durante la descarga. */
  loadedBytes: number;
  totalBytes: number;
  /** 0..1, o null si aún no se conoce. */
  fraction: number | null;
  /** Archivo que se está descargando ahora. */
  file?: string;
  /** Mensaje de error en español. */
  error?: string;
  /** Variante instalada y espacio que ocupa. */
  variant?: VariantKey;
  bytes?: number;
  /** true mientras se comprueba la caché al arrancar. */
  checking?: boolean;
}

const initial = (): ModuleState => ({ status: 'not-installed', loadedBytes: 0, totalBytes: 0, fraction: null, checking: true });

let snapshot: Record<ModuleId, ModuleState> = Object.fromEntries(MODULE_IDS.map((id) => [id, initial()])) as Record<
  ModuleId,
  ModuleState
>;
const listeners = new Set<() => void>();

export function getStates(): Record<ModuleId, ModuleState> {
  return snapshot;
}

export function getState(id: ModuleId): ModuleState {
  return snapshot[id];
}

export function setState(id: ModuleId, patch: Partial<ModuleState>, replace = false): void {
  const prev = snapshot[id];
  snapshot = { ...snapshot, [id]: replace ? { ...initial(), checking: false, ...patch } : { ...prev, ...patch } };
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ------------------------------------------------------------------ petición de abrir el Centro

export interface HubRequest {
  open: boolean;
  /** Módulo a resaltar al abrir (el que faltaba). */
  focusId: ModuleId | null;
  /** Se incrementa en cada petición para poder reaccionar aunque ya estuviera abierto. */
  seq: number;
}

let hub: HubRequest = { open: false, focusId: null, seq: 0 };
const hubListeners = new Set<() => void>();

export const HUB_EVENT = 'centro-modulos:abrir';

export function getHubRequest(): HubRequest {
  return hub;
}

export function subscribeHub(listener: () => void): () => void {
  hubListeners.add(listener);
  return () => hubListeners.delete(listener);
}

export function openModuleHub(focusId: ModuleId | null = null): void {
  hub = { open: true, focusId, seq: hub.seq + 1 };
  hubListeners.forEach((l) => l());
  try {
    window.dispatchEvent(new CustomEvent(HUB_EVENT, { detail: { id: focusId } }));
  } catch {
    /* fuera del navegador */
  }
}

export function closeModuleHub(): void {
  hub = { ...hub, open: false };
  hubListeners.forEach((l) => l());
}
