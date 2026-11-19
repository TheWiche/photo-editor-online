/**
 * Persistencia de modelos de IA.
 *
 *  - Transformers.js guarda sus archivos en la Cache API 'transformers-cache' (env.useBrowserCache = true).
 *  - Los archivos propios (LaMa, motor ONNX Runtime, scripts de Tesseract) van en la Cache API 'modelos-ia-v1'.
 *  - Los idiomas de Tesseract van en el IndexedDB que el propio Tesseract consulta antes de descargar.
 *  - El «registro de instalados» se guarda en localStorage + IndexedDB (con try/catch) y SIEMPRE se
 *    verifica contra la caché real: si el navegador borró algo, el módulo vuelve a «no instalado».
 *
 * Este archivo se puede importar desde el hilo principal y desde el Web Worker
 * (las funciones que usan localStorage comprueban que exista).
 */
import type { ModuleId, ProgressEvent } from '../core/contracts';
import type { InstallOutcome, VariantKey } from './types';
import { CancelledError } from './types';
import { getModuleSpec, MODULE_IDS, repoPrefixes } from './registry';

export const TRANSFORMERS_CACHE = 'transformers-cache';
export const OWN_CACHE = 'modelos-ia-v1';

const RECORDS_LS_KEY = 'estudio-foto:modulos-ia:v1';
const RECORDS_DB = 'estudio-foto-ia';
const RECORDS_STORE = 'instalados';

export interface InstallRecord {
  id: ModuleId;
  version: number;
  variant: VariantKey;
  /** Archivos propios del módulo en Cache API. */
  urls: string[];
  /** Archivos compartidos (motor ONNX Runtime): solo se borran si ningún otro módulo los usa. */
  sharedUrls: string[];
  /** Claves 'db|store|key' en IndexedDB. */
  idbKeys: string[];
  bytes: number;
  installedAt: number;
}

export type Records = Partial<Record<ModuleId, InstallRecord>>;

const hasCaches = () => typeof caches !== 'undefined';

// ------------------------------------------------------------------ almacenamiento persistente

/** Pide al navegador que no borre nuestros datos al quedarse sin espacio. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function isPersisted(): Promise<boolean> {
  try {
    return (await navigator.storage?.persisted?.()) ?? false;
  } catch {
    return false;
  }
}

export interface StorageEstimate {
  /** Bytes usados por todo el sitio (cachés + IndexedDB + ...). */
  usedBytes: number;
  /** Cuota disponible para el sitio (estimación del navegador). */
  quotaBytes: number;
  /** Bytes ocupados por los módulos instalados (según el registro). */
  modulesBytes: number;
  persisted: boolean;
  supported: boolean;
}

export async function estimate(): Promise<StorageEstimate> {
  let usedBytes = 0;
  let quotaBytes = 0;
  let supported = false;
  try {
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      usedBytes = e.usage ?? 0;
      quotaBytes = e.quota ?? 0;
      supported = true;
    }
  } catch {
    /* sin soporte */
  }
  const recs = readRecords();
  const shared = new Set<string>();
  let modulesBytes = 0;
  for (const r of Object.values(recs)) {
    if (!r) continue;
    modulesBytes += r.bytes;
    for (const u of r.sharedUrls) shared.add(u);
  }
  modulesBytes += await sumCachedBytes([...shared]).catch(() => 0);
  return { usedBytes, quotaBytes, modulesBytes, persisted: await isPersisted(), supported };
}

// ------------------------------------------------------------------ IndexedDB mínimo

function idbOpen(db: string, store: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB no disponible'));
    const req = indexedDB.open(db);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(store)) req.result.createObjectStore(store);
    };
    req.onsuccess = () => {
      const conn = req.result;
      if (conn.objectStoreNames.contains(store)) return resolve(conn);
      // La base existe pero sin el almacén: subimos de versión para crearlo.
      const v = conn.version + 1;
      conn.close();
      const up = indexedDB.open(db, v);
      up.onupgradeneeded = () => up.result.createObjectStore(store);
      up.onsuccess = () => resolve(up.result);
      up.onerror = () => reject(up.error);
    };
    req.onerror = () => reject(req.error);
  });
}

async function idbTx<T>(db: string, store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const conn = await idbOpen(db, store);
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = conn.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? req.error);
      tx.onabort = () => reject(tx.error ?? new Error('Transacción abortada'));
    });
  } finally {
    conn.close();
  }
}

export const idb = {
  get: <T = unknown>(db: string, store: string, key: string) => idbTx<T>(db, store, 'readonly', (s) => s.get(key) as IDBRequest<T>),
  set: (db: string, store: string, key: string, value: unknown) => idbTx(db, store, 'readwrite', (s) => s.put(value, key)).then(() => undefined),
  del: (db: string, store: string, key: string) => idbTx(db, store, 'readwrite', (s) => s.delete(key)).then(() => undefined),
  has: async (db: string, store: string, key: string) => {
    try {
      const n = await idbTx<number>(db, store, 'readonly', (s) => s.count(key));
      return n > 0;
    } catch {
      return false;
    }
  },
};

export const idbKey = (db: string, store: string, key: string) => `${db}|${store}|${key}`;
const parseIdbKey = (k: string) => {
  const [db, store, ...rest] = k.split('|');
  return { db, store, key: rest.join('|') };
};

// ------------------------------------------------------------------ registro de instalados

let memoryRecords: Records = {};

export function readRecords(): Records {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(RECORDS_LS_KEY);
      if (raw) memoryRecords = JSON.parse(raw) as Records;
    }
  } catch {
    /* localStorage bloqueado: usamos la copia en memoria / IndexedDB */
  }
  return { ...memoryRecords };
}

function writeRecords(recs: Records): void {
  memoryRecords = { ...recs };
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(RECORDS_LS_KEY, JSON.stringify(recs));
  } catch {
    /* sin espacio o bloqueado */
  }
  idb.set(RECORDS_DB, RECORDS_STORE, 'records', recs).catch(() => undefined);
}

/** Recupera el registro desde IndexedDB si localStorage está vacío (p. ej. lo borró el usuario). */
export async function hydrateRecords(): Promise<Records> {
  const current = readRecords();
  if (Object.keys(current).length > 0) return current;
  try {
    const fromDb = await idb.get<Records>(RECORDS_DB, RECORDS_STORE, 'records');
    if (fromDb && typeof fromDb === 'object') {
      writeRecords(fromDb);
      return { ...fromDb };
    }
  } catch {
    /* sin IndexedDB */
  }
  return current;
}

export function saveRecord(id: ModuleId, outcome: InstallOutcome): InstallRecord {
  const spec = getModuleSpec(id);
  const sharedUrls = outcome.sharedUrls ?? [];
  const rec: InstallRecord = {
    id,
    version: spec.version,
    variant: outcome.variant,
    urls: outcome.urls.filter((u) => !sharedUrls.includes(u)),
    sharedUrls,
    idbKeys: outcome.idbKeys ?? [],
    bytes: outcome.bytes,
    installedAt: Date.now(),
  };
  const recs = readRecords();
  recs[id] = rec;
  writeRecords(recs);
  return rec;
}

function deleteRecord(id: ModuleId): void {
  const recs = readRecords();
  delete recs[id];
  writeRecords(recs);
}

export function getRecord(id: ModuleId): InstallRecord | undefined {
  return readRecords()[id];
}

/** Comprueba que TODOS los archivos del registro siguen en la caché/IndexedDB. */
export async function verifyRecord(rec: InstallRecord): Promise<boolean> {
  try {
    if (rec.version !== getModuleSpec(rec.id).version) return false;
    if (rec.urls.length + rec.idbKeys.length === 0) return false;
    if (!hasCaches() && rec.urls.length + rec.sharedUrls.length > 0) return false;
    for (const u of [...rec.urls, ...rec.sharedUrls]) {
      const hit = await caches.match(u);
      if (!hit) return false;
    }
    for (const k of rec.idbKeys) {
      const { db, store, key } = parseIdbKey(k);
      if (!(await idb.has(db, store, key))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Módulos realmente instalados (registro verificado contra la caché). Limpia registros obsoletos. */
export async function listInstalled(): Promise<InstallRecord[]> {
  const recs = await hydrateRecords();
  const ok: InstallRecord[] = [];
  let changed = false;
  for (const id of MODULE_IDS) {
    const rec = recs[id];
    if (!rec) continue;
    if (await verifyRecord(rec)) ok.push(rec);
    else {
      delete recs[id];
      changed = true;
    }
  }
  if (changed) writeRecords(recs);
  return ok;
}

export async function isInstalled(id: ModuleId): Promise<boolean> {
  const rec = (await hydrateRecords())[id];
  return !!rec && (await verifyRecord(rec));
}

/** Borra los archivos de un módulo y su registro. Los archivos compartidos se conservan si otro módulo los usa. */
export async function remove(id: ModuleId): Promise<void> {
  const recs = readRecords();
  const rec = recs[id];
  const spec = getModuleSpec(id);
  const stillShared = new Set<string>();
  for (const other of Object.values(recs)) {
    if (other && other.id !== id) other.sharedUrls.forEach((u) => stillShared.add(u));
  }
  if (hasCaches()) {
    const toDelete = new Set<string>([...(rec?.urls ?? []), ...(rec?.sharedUrls ?? []).filter((u) => !stillShared.has(u))]);
    for (const f of spec.files ?? []) toDelete.add(f.url);
    // Restos de descargas parciales de Transformers.js para los repos de este módulo.
    const prefixes = repoPrefixes(spec);
    if (prefixes.length) {
      const urls = await listCacheUrls(TRANSFORMERS_CACHE, (u) => prefixes.some((p) => u.includes(p)));
      urls.forEach((u) => toDelete.add(u));
    }
    for (const name of [TRANSFORMERS_CACHE, OWN_CACHE]) {
      try {
        const cache = await caches.open(name);
        for (const u of toDelete) await cache.delete(u);
      } catch {
        /* ignorar */
      }
    }
  }
  for (const k of rec?.idbKeys ?? []) {
    const { db, store, key } = parseIdbKey(k);
    await idb.del(db, store, key).catch(() => undefined);
  }
  deleteRecord(id);
}

// ------------------------------------------------------------------ utilidades de Cache API

export async function listCacheUrls(cacheName: string, filter: (url: string) => boolean = () => true): Promise<string[]> {
  if (!hasCaches()) return [];
  try {
    if (!(await caches.has(cacheName))) return [];
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    return keys.map((r) => r.url).filter(filter);
  } catch {
    return [];
  }
}

/** Tamaño en bytes de una respuesta guardada (usa content-length si existe). */
export async function cachedBytes(url: string): Promise<number> {
  if (!hasCaches()) return 0;
  const res = await caches.match(url);
  if (!res) return 0;
  const len = Number(res.headers.get('content-length'));
  if (Number.isFinite(len) && len > 0) return len;
  try {
    return (await res.blob()).size;
  } catch {
    return 0;
  }
}

export async function sumCachedBytes(urls: string[]): Promise<number> {
  let total = 0;
  for (const u of urls) total += await cachedBytes(u);
  return total;
}

export interface CachedFetchOptions {
  cacheName?: string;
  /** Nombre legible del archivo para la barra de progreso. */
  label?: string;
  /** Tamaño esperado (bytes) si el servidor no envía content-length. */
  expectedBytes?: number;
  onProgress?: (e: ProgressEvent) => void;
  signal?: AbortSignal;
}

/**
 * Devuelve la respuesta desde la caché; si no está, la descarga UNA vez (con progreso y cancelación)
 * y la guarda. Una descarga cancelada o incompleta NO queda en la caché.
 */
export async function cachedFetch(url: string, opts: CachedFetchOptions = {}): Promise<Response> {
  const { cacheName = OWN_CACHE, label = url.split('/').pop() ?? url, onProgress, signal } = opts;
  const cache = hasCaches() ? await caches.open(cacheName) : null;
  const hit = await cache?.match(url);
  if (hit) {
    const size = Number(hit.headers.get('content-length')) || opts.expectedBytes || 0;
    onProgress?.({ file: label, loadedBytes: size, totalBytes: size, progress: 1 });
    return hit;
  }
  if (signal?.aborted) throw new CancelledError();
  let res: Response;
  try {
    res = await fetch(url, { signal, mode: 'cors', credentials: 'omit' });
  } catch (err) {
    if (signal?.aborted) throw new CancelledError();
    throw new Error(`No se pudo descargar ${label}. ¿Hay conexión a internet? (${(err as Error).message})`);
  }
  if (!res.ok) throw new Error(`Error ${res.status} al descargar ${label}`);
  const total = Number(res.headers.get('content-length')) || opts.expectedBytes || 0;
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  if (reader) {
    onProgress?.({ file: label, loadedBytes: 0, totalBytes: total, progress: 0 });
    let lastEmit = 0;
    for (;;) {
      let step: ReadableStreamReadResult<Uint8Array>;
      try {
        step = await reader.read();
      } catch (err) {
        if (signal?.aborted) throw new CancelledError();
        throw err;
      }
      if (step.done) break;
      chunks.push(step.value);
      loaded += step.value.byteLength;
      const now = Date.now();
      if (now - lastEmit > 100) {
        lastEmit = now;
        onProgress?.({ file: label, loadedBytes: loaded, totalBytes: Math.max(total, loaded), progress: total ? Math.min(1, loaded / total) : 0 });
      }
    }
  } else {
    const buf = new Uint8Array(await res.arrayBuffer());
    chunks.push(buf);
    loaded = buf.byteLength;
  }
  if (signal?.aborted) throw new CancelledError();
  const blob = new Blob(chunks as BlobPart[], { type: res.headers.get('content-type') ?? 'application/octet-stream' });
  const stored = new Response(blob, {
    status: 200,
    headers: { 'content-type': blob.type, 'content-length': String(blob.size), 'x-guardado': new Date().toISOString() },
  });
  if (cache) {
    try {
      await cache.put(url, stored.clone());
    } catch (err) {
      throw new Error(`No hay espacio suficiente para guardar ${label} en el dispositivo (${(err as Error).message}).`);
    }
  }
  onProgress?.({ file: label, loadedBytes: loaded, totalBytes: loaded, progress: 1 });
  return stored;
}

/** Crea un blob: URL a partir de un archivo de la caché (o lo descarga si falta). */
export async function cachedBlobUrl(url: string, type: string, opts: CachedFetchOptions = {}): Promise<string> {
  const res = await cachedFetch(url, opts);
  const blob = await res.blob();
  return URL.createObjectURL(new Blob([blob], { type }));
}
