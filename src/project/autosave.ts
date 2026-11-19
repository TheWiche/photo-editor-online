/** Autoguardado periódico en IndexedDB y recuperación tras un cierre inesperado. */
import { uid } from '../core/defaults';
import { useEditor } from '../core/store';
import { t } from '../i18n';
import { useUI } from '../ui/uiStore';
import { serializeSnapshot } from './bundle';
import * as db from './db';
import { getSourceInfo, onDocLifecycle } from './docState';
import { confirmDiscard, loadBundle } from './projects';
import { useProduct } from './state';

export const AUTOSAVE_SECONDS = 20;
let started = false;
let changed = false;
let saving = false;

async function archiveSession() {
  const s = await db.getSession();
  if (!s) { useProduct.getState().set({ recover: null }); return; }
  const j = s.bundle.json;
  const copy = { json: { ...j, name: t('recover.archivedName', { name: j.name }) }, blobs: s.bundle.blobs };
  await db.putProject(db.metaFor(uid('p'), copy), copy);
  await db.clearSession();
  useProduct.getState().set({ recover: null });
  useUI.getState().toast(t('recover.archived'), 'info');
}

export async function flushAutosave(): Promise<void> {
  const { doc, masks, fileName, dirty } = useEditor.getState();
  if (!doc || !dirty || saving) return;
  saving = true;
  changed = false;
  try {
    // Si hay una sesión anterior sin recuperar y el usuario ya sigue trabajando, se conserva como proyecto.
    if (useProduct.getState().recover) await archiveSession();
    const bundle = await serializeSnapshot(doc, masks, fileName, { source: getSourceInfo()?.meta });
    await db.putSession(bundle);
  } catch (e) {
    changed = true; // reintenta en el siguiente ciclo
    console.warn('Autoguardado fallido', e);
  } finally {
    saving = false;
  }
}

export async function checkRecover(): Promise<void> {
  try {
    const s = await db.getSession();
    if (!s) return;
    const j = s.bundle.json;
    useProduct.getState().set({ recover: { name: j.name, savedAt: s.savedAt, width: j.doc.width, height: j.doc.height } });
  } catch { /* sin IndexedDB: no hay recuperación */ }
}

export async function recoverSession(): Promise<void> {
  if (!confirmDiscard()) return;
  try {
    const s = await db.getSession();
    if (!s) throw new Error(t('err.notFound'));
    await loadBundle(s.bundle, { dirty: true });
    useProduct.getState().set({ recover: null });
    changed = true;
    useUI.getState().toast(t('recover.done'), 'success');
  } catch (e) {
    useUI.getState().toast(t('err.open', { msg: e instanceof Error ? e.message : String(e) }), 'error');
  }
}

export async function discardSession(): Promise<void> {
  await db.clearSession().catch(() => {});
  useProduct.getState().set({ recover: null });
}

export function startAutosave() {
  if (started) return;
  started = true;
  useEditor.subscribe((s, prev) => {
    if (s.doc && s.dirty && (s.doc !== prev.doc || s.masks !== prev.masks)) changed = true;
  });
  onDocLifecycle((e) => {
    changed = false;
    // Cerrar el documento a propósito es un cierre limpio: no hay nada que recuperar.
    if (e === 'closed' && !useProduct.getState().recover) void db.clearSession().catch(() => {});
  });
  setInterval(() => { if (changed && !useEditor.getState().busy) void flushAutosave(); }, AUTOSAVE_SECONDS * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && changed) void flushAutosave(); });
  void checkRecover();
}
