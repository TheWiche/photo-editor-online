/**
 * AVISO ANTES DE DESCARGAR. Toda descarga de modelos pasa por `confirmDownload()` (lo llama
 * `install()` de client.ts), así que el aviso aparece en TODOS los caminos: Centro de módulos,
 * panel IA, `ensureInstalled`, preámbulo…
 *
 * El diálogo lo pinta un componente de UI (src/ui/ext/ai-download.tsx) registrándose con
 * `setDownloadAsker()`. Si no hay ninguno registrado (pruebas, otra app), se descarga sin preguntar.
 */
import type { ModuleId } from '../core/contracts';
import { getModuleSpec, ORT_RUNTIME_MB } from './registry';
import { getStates } from './status';
import type { BackendInfo, VariantKey } from './types';

// ------------------------------------------------------------------ red

export interface NetInfo {
  /** 'wifi' | 'ethernet' | 'cellular' | … o undefined si el navegador no lo dice (escritorio). */
  type?: string;
  /** 'slow-2g' | '2g' | '3g' | '4g' */
  effectiveType?: string;
  saveData: boolean;
  /** Mbit/s estimados. */
  downlink?: number;
  online: boolean;
}

interface NavigatorConnection {
  type?: string;
  effectiveType?: string;
  saveData?: boolean;
  downlink?: number;
}

export function readNetInfo(): NetInfo {
  const c = (typeof navigator !== 'undefined' ? (navigator as unknown as { connection?: NavigatorConnection }).connection : undefined) ?? {};
  return {
    type: c.type,
    effectiveType: c.effectiveType,
    saveData: !!c.saveData,
    downlink: typeof c.downlink === 'number' ? c.downlink : undefined,
    online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  };
}

/** Conexión de datos móviles, «ahorro de datos» o red lenta: conviene avisar SIEMPRE. */
export function isMetered(n: NetInfo): boolean {
  return n.saveData || n.type === 'cellular' || n.type === 'wimax' || /^(slow-2g|2g|3g)$/.test(n.effectiveType ?? '');
}

/** Wi‑Fi / cable, o una red que el navegador no clasifica y que no parece móvil. */
export function isWifiLike(n: NetInfo): boolean {
  if (isMetered(n)) return false;
  return n.type === undefined || n.type === 'wifi' || n.type === 'ethernet' || n.type === 'unknown' || n.type === 'other';
}

export function describeNet(n: NetInfo): string {
  if (!n.online) return 'Sin conexión';
  const kind =
    n.type === 'wifi' ? 'Wi‑Fi' : n.type === 'ethernet' ? 'Cable (Ethernet)' : n.type === 'cellular' ? 'Datos móviles' : n.type === 'none' ? 'Sin red' : null;
  const speed = n.effectiveType ? n.effectiveType.toUpperCase().replace('SLOW-', 'muy lenta ') : null;
  const parts = [kind ?? 'Conexión', speed && `calidad ${speed}`, n.saveData && 'ahorro de datos activado'].filter(Boolean);
  return parts.join(' · ');
}

// ------------------------------------------------------------------ preferencias

const PREF_SKIP_WIFI = 'estudio-foto:ia-descarga-no-preguntar-wifi';

export function getSkipOnWifi(): boolean {
  try {
    return localStorage.getItem(PREF_SKIP_WIFI) === '1';
  } catch {
    return false;
  }
}

export function setSkipOnWifi(on: boolean): void {
  try {
    if (on) localStorage.setItem(PREF_SKIP_WIFI, '1');
    else localStorage.removeItem(PREF_SKIP_WIFI);
  } catch {
    /* sin almacenamiento */
  }
}

// ------------------------------------------------------------------ plan de descarga

export interface PlanItem {
  id: ModuleId;
  nameEs: string;
  mb: number;
  experimental: boolean;
}

export interface DownloadPlan {
  items: PlanItem[];
  /** Motor de IA compartido que falta (MB, 0 si ya está). */
  runtimeMB: number;
  runtimeLabel: string | null;
  totalMB: number;
  storage: { supported: boolean; quotaBytes: number; usedBytes: number; freeBytes: number; persisted: boolean };
  net: NetInfo;
  metered: boolean;
  /** No hay sitio (o va muy justo) para la descarga. */
  insufficient: boolean;
  /** Queda menos del 20 % libre tras descargar. */
  tight: boolean;
  backend: BackendInfo['backend'] | null;
}

function variantOf(b: BackendInfo | null): VariantKey {
  if (!b || b.backend !== 'webgpu') return 'wasm';
  return b.f16 ? 'webgpu-f16' : 'webgpu';
}

export async function planDownload(ids: ModuleId[], backend: BackendInfo | null): Promise<DownloadPlan> {
  const states = getStates();
  const variant = variantOf(backend);
  const unique = [...new Set(ids)].filter((id) => states[id]?.status !== 'installed');
  const items: PlanItem[] = unique.map((id) => {
    const s = getModuleSpec(id);
    return { id, nameEs: s.nameEs, mb: s.sizeByVariantMB[variant], experimental: s.availability === 'experimental' };
  });
  // Motor compartido de Transformers.js (si ningún módulo de ese tipo está ya instalado) y
  // motor ONNX propio del Borrador mágico.
  const specs = unique.map(getModuleSpec);
  const tfInstalled = Object.entries(states).some(([id, st]) => st.status === 'installed' && !!getModuleSpec(id as ModuleId).transformers);
  const needTf = specs.some((s) => !!s.transformers) && !tfInstalled;
  const needOrt = specs.some((s) => !!s.files?.length);
  const runtimeMB = (needTf ? ORT_RUNTIME_MB : 0) + (needOrt ? ORT_RUNTIME_MB : 0);
  const totalMB = items.reduce((a, i) => a + i.mb, 0) + runtimeMB;

  let quotaBytes = 0, usedBytes = 0, supported = false, persisted = false;
  try {
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      quotaBytes = e.quota ?? 0;
      usedBytes = e.usage ?? 0;
      supported = quotaBytes > 0;
    }
    persisted = (await navigator.storage?.persisted?.()) ?? false;
  } catch {
    /* sin soporte */
  }
  const freeBytes = Math.max(0, quotaBytes - usedBytes);
  const need = totalMB * 1e6;
  // Margen: la Cache API guarda copias temporales mientras descarga.
  const insufficient = supported && freeBytes < need * 1.15 + 20e6;
  const tight = supported && !insufficient && freeBytes - need < quotaBytes * 0.2;
  const net = readNetInfo();
  return {
    items,
    runtimeMB,
    runtimeLabel: runtimeMB ? `Motor de IA compartido (se descarga una sola vez)` : null,
    totalMB,
    storage: { supported, quotaBytes, usedBytes, freeBytes, persisted },
    net,
    metered: isMetered(net),
    insufficient,
    tight,
    backend: backend?.backend ?? null,
  };
}

// ------------------------------------------------------------------ confirmación

export type DownloadAsker = (plan: DownloadPlan) => Promise<boolean>;

let asker: DownloadAsker | null = null;
let queue: Promise<unknown> = Promise.resolve();

/** La UI registra aquí su diálogo. Devuelve la función para quitarlo. */
export function setDownloadAsker(fn: DownloadAsker | null): () => void {
  asker = fn;
  return () => {
    if (asker === fn) asker = null;
  };
}

export function hasDownloadAsker(): boolean {
  return asker !== null;
}

/**
 * Pregunta antes de descargar. Resuelve true si se puede descargar. No pregunta si: no hay nada
 * que descargar, no hay UI registrada, o el usuario marcó «No volver a preguntar en Wi‑Fi»
 * y estamos en Wi‑Fi con espacio suficiente.
 */
export function confirmDownload(ids: ModuleId[], backend: BackendInfo | null): Promise<boolean> {
  const task = queue.then(async () => {
    const plan = await planDownload(ids, backend);
    if (plan.items.length === 0) return true;
    if (!asker) return true;
    if (getSkipOnWifi() && isWifiLike(plan.net) && !plan.insufficient && !plan.tight) return true;
    return asker(plan);
  });
  queue = task.catch(() => undefined);
  return task;
}
