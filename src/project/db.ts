/** IndexedDB mínimo para proyectos y autoguardado. Dos almacenes: «meta» (listado ligero) y «data» (JSON + blobs). */
import type { ProjectBundle } from './bundle';

const DB_NAME = 'estudio-foto-proyectos';
const SESSION_ID = '__session__';

export interface ProjectMeta {
  id: string; name: string; createdAt: number; updatedAt: number;
  width: number; height: number; layers: number; bytes: number; thumb?: Blob;
}

interface DataRecord { id: string; json: ProjectBundle['json']; blobs: Record<string, Blob>; savedAt?: number }

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('indexeddb-unavailable')); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('meta', { keyPath: 'id' });
        db.createObjectStore('data', { keyPath: 'id' });
      };
      req.onsuccess = () => {
        req.result.onversionchange = () => { req.result.close(); dbp = null; };
        resolve(req.result);
      };
      req.onerror = () => { dbp = null; reject(req.error ?? new Error('indexeddb-error')); };
      req.onblocked = () => { dbp = null; reject(new Error('indexeddb-blocked')); };
    });
  }
  return dbp;
}

function run<T>(stores: string[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => IDBRequest | void): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const req = fn(tx);
    tx.oncomplete = () => resolve((req ? req.result : undefined) as T);
    tx.onerror = () => reject(tx.error ?? new Error('indexeddb-error'));
    tx.onabort = () => reject(tx.error ?? new Error('indexeddb-abort'));
  }));
}

let persistAsked = false;
function askPersist() {
  if (persistAsked) return;
  persistAsked = true;
  try { void navigator.storage?.persist?.(); } catch { /* opcional */ }
}

const bundleBytes = (b: ProjectBundle) => Object.values(b.blobs).reduce((n, x) => n + x.size, 0);

export function metaFor(id: string, b: ProjectBundle, thumb?: Blob): ProjectMeta {
  const j = b.json;
  return { id, name: j.name, createdAt: j.createdAt, updatedAt: j.updatedAt, width: j.doc.width, height: j.doc.height, layers: j.doc.layers.length, bytes: bundleBytes(b), thumb };
}

export async function putProject(meta: ProjectMeta, bundle: ProjectBundle): Promise<void> {
  askPersist();
  await run(['meta', 'data'], 'readwrite', (tx) => {
    tx.objectStore('data').put({ id: meta.id, json: bundle.json, blobs: bundle.blobs } satisfies DataRecord);
    tx.objectStore('meta').put(meta);
  });
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const all = await run<ProjectMeta[]>(['meta'], 'readonly', (tx) => tx.objectStore('meta').getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getMeta(id: string): Promise<ProjectMeta | undefined> {
  return run<ProjectMeta | undefined>(['meta'], 'readonly', (tx) => tx.objectStore('meta').get(id));
}

export async function getBundle(id: string): Promise<ProjectBundle | null> {
  const r = await run<DataRecord | undefined>(['data'], 'readonly', (tx) => tx.objectStore('data').get(id));
  return r ? { json: r.json, blobs: r.blobs } : null;
}

export async function deleteProject(id: string): Promise<void> {
  await run(['meta', 'data'], 'readwrite', (tx) => { tx.objectStore('meta').delete(id); tx.objectStore('data').delete(id); });
}

export async function renameProject(id: string, name: string): Promise<void> {
  const [meta, data] = await Promise.all([getMeta(id), run<DataRecord | undefined>(['data'], 'readonly', (tx) => tx.objectStore('data').get(id))]);
  if (!meta || !data) return;
  await run(['meta', 'data'], 'readwrite', (tx) => {
    tx.objectStore('meta').put({ ...meta, name });
    tx.objectStore('data').put({ ...data, json: { ...data.json, name } });
  });
}

/* ------------------------------------------------------------- sesión (autoguardado) */

export async function putSession(bundle: ProjectBundle): Promise<void> {
  askPersist();
  await run(['data'], 'readwrite', (tx) => { tx.objectStore('data').put({ id: SESSION_ID, json: bundle.json, blobs: bundle.blobs, savedAt: Date.now() } satisfies DataRecord); });
}

export async function getSession(): Promise<{ bundle: ProjectBundle; savedAt: number } | null> {
  const r = await run<DataRecord | undefined>(['data'], 'readonly', (tx) => tx.objectStore('data').get(SESSION_ID));
  return r ? { bundle: { json: r.json, blobs: r.blobs }, savedAt: r.savedAt ?? r.json.updatedAt } : null;
}

export async function clearSession(): Promise<void> {
  await run(['data'], 'readwrite', (tx) => { tx.objectStore('data').delete(SESSION_ID); });
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try { const e = await navigator.storage?.estimate?.(); return e ? { usage: e.usage ?? 0, quota: e.quota ?? 0 } : null; } catch { return null; }
}
