/** Acciones de proyectos: guardar/abrir en IndexedDB, duplicar, renombrar, eliminar, archivo .estudio y apertura de archivos entrantes. */
import { ratioValue, uid } from '../core/defaults';
import { fitRatioRect, useEditor } from '../core/store';
import { openFiles } from '../ui/files';
import { useUI } from '../ui/uiStore';
import { t } from '../i18n';
import { decodeEstudio, deserializeBundle, encodeEstudio, makeThumbBlob, PROJECT_EXT, PROJECT_MIME, serializeSnapshot, type ProjectBundle } from './bundle';
import * as db from './db';
import { getSourceInfo, onDocLifecycle, setSourceInfo, startDocTracking } from './docState';
import { pickFile, saveToDisk } from './fsAccess';
import { useProduct } from './state';

const toast = (text: string, kind: 'info' | 'success' | 'error' = 'info') => useUI.getState().toast(text, kind);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

let fileHandle: Awaited<ReturnType<typeof saveToDisk>>['handle'] | null = null;

export function initProjects() {
  startDocTracking();
  // Un documento nuevo o cerrado deja de estar asociado a un proyecto/archivo anterior.
  onDocLifecycle(() => { useProduct.getState().set({ currentId: null }); fileHandle = null; });
}

/** Pregunta antes de reemplazar un documento con cambios sin guardar. */
export function confirmDiscard(): boolean {
  const s = useEditor.getState();
  return !s.doc || !s.dirty || window.confirm(t('confirm.discard'));
}

/** Sustituye el documento del editor (vía useEditor.setState, la API pública de zustand) y reinicia el historial. */
export function applyDocument(d: Awaited<ReturnType<typeof deserializeBundle>>, opts: { projectId?: string | null; dirty?: boolean } = {}) {
  const s = useEditor.getState();
  const ratio = ratioValue(s.cropRatio, d.doc.width, d.doc.height);
  useEditor.setState({
    doc: d.doc, masks: d.masks, past: [], future: [], lastKey: null, lastTime: 0,
    fileName: d.name, dirty: !!opts.dirty,
    cropRect: s.tool === 'crop' ? fitRatioRect(d.doc.width, d.doc.height, ratio) : null,
  });
  useEditor.getState().fitToScreen(true);
  setSourceInfo(d.source ? { meta: d.source } : null);
  useProduct.getState().set({ currentId: opts.projectId ?? null });
}

/* ------------------------------------------------------------------ IndexedDB */

export async function saveProject(opts: { asNew?: boolean; name?: string } = {}): Promise<db.ProjectMeta | null> {
  const s = useEditor.getState();
  const { doc, masks } = s;
  if (!doc) return null;
  const prod = useProduct.getState();
  prod.set({ busy: t('busy.saving') });
  try {
    const name = (opts.name ?? s.fileName).trim() || 'sin-titulo';
    const reuse = !opts.asNew && prod.currentId ? prod.currentId : null;
    const prev = reuse ? await db.getMeta(reuse) : undefined;
    const id = prev ? prev.id : uid('p');
    const bundle = await serializeSnapshot(doc, masks, name, { createdAt: prev?.createdAt, source: getSourceInfo()?.meta });
    const thumb = await makeThumbBlob(doc, masks);
    const meta = db.metaFor(id, bundle, thumb);
    await db.putProject(meta, bundle);
    const now = useEditor.getState();
    if (now.doc === doc && now.masks === masks) useEditor.setState({ dirty: false });
    useProduct.getState().set({ currentId: id });
    await db.clearSession().catch(() => {});
    toast(t('save.done', { name }), 'success');
    return meta;
  } catch (e) {
    toast(t('err.save', { msg: errMsg(e) }), 'error');
    return null;
  } finally {
    useProduct.getState().set({ busy: null });
  }
}

export async function loadBundle(bundle: ProjectBundle, opts: { projectId?: string | null; dirty?: boolean } = {}) {
  const d = await deserializeBundle(bundle);
  applyDocument(d, opts);
}

export async function openProject(id: string): Promise<boolean> {
  if (!confirmDiscard()) return false;
  useProduct.getState().set({ busy: t('busy.opening') });
  try {
    const bundle = await db.getBundle(id);
    if (!bundle) throw new Error(t('err.notFound'));
    await loadBundle(bundle, { projectId: id });
    return true;
  } catch (e) {
    toast(t('err.open', { msg: errMsg(e) }), 'error');
    return false;
  } finally {
    useProduct.getState().set({ busy: null });
  }
}

export async function duplicateProject(id: string): Promise<void> {
  try {
    const bundle = await db.getBundle(id);
    const meta = await db.getMeta(id);
    if (!bundle || !meta) return;
    const name = t('projects.copyName', { name: meta.name });
    const now = Date.now();
    const copy: ProjectBundle = { json: { ...bundle.json, name, createdAt: now, updatedAt: now }, blobs: bundle.blobs };
    await db.putProject({ ...db.metaFor(uid('p'), copy, meta.thumb) }, copy);
  } catch (e) { toast(t('err.generic', { msg: errMsg(e) }), 'error'); }
}

export async function renameProject(id: string, name: string): Promise<void> {
  const clean = name.trim();
  if (!clean) return;
  try {
    await db.renameProject(id, clean);
    if (useProduct.getState().currentId === id) useEditor.getState().setFileName(clean);
  } catch (e) { toast(t('err.generic', { msg: errMsg(e) }), 'error'); }
}

export async function removeProject(id: string): Promise<void> {
  try {
    await db.deleteProject(id);
    if (useProduct.getState().currentId === id) useProduct.getState().set({ currentId: null });
  } catch (e) { toast(t('err.generic', { msg: errMsg(e) }), 'error'); }
}

/* ------------------------------------------------------------- archivo .estudio */

const FILE_TYPES = [{ description: 'Proyecto de Estudio Foto', accept: { [PROJECT_MIME]: [PROJECT_EXT] } }];

export async function exportProjectFile(opts: { saveAs?: boolean } = {}): Promise<void> {
  const s = useEditor.getState();
  const { doc, masks } = s;
  if (!doc) return;
  useProduct.getState().set({ busy: t('busy.saving') });
  try {
    const bundle = await serializeSnapshot(doc, masks, s.fileName, { source: getSourceInfo()?.meta });
    const blob = encodeEstudio(bundle, await makeThumbBlob(doc, masks));
    const fname = `${s.fileName.replace(/[\\/:*?"<>|]+/g, '-') || 'proyecto'}${PROJECT_EXT}`;
    const r = await saveToDisk(blob, fname, { types: FILE_TYPES, handle: fileHandle, forcePicker: !!opts.saveAs, id: 'estudio-proyectos' });
    if (r.result === 'cancelled') return;
    if (r.handle) fileHandle = r.handle;
    const now = useEditor.getState();
    if (now.doc === doc && now.masks === masks) useEditor.setState({ dirty: false });
    toast(r.result === 'saved' ? t('file.saved', { name: r.handle?.name ?? fname }) : t('file.downloaded', { name: fname }), 'success');
  } catch (e) {
    toast(t('err.save', { msg: errMsg(e) }), 'error');
  } finally {
    useProduct.getState().set({ busy: null });
  }
}

export async function openProjectFile(file: Blob): Promise<boolean> {
  if (!confirmDiscard()) return false;
  useProduct.getState().set({ busy: t('busy.opening') });
  try {
    const { bundle } = await decodeEstudio(file);
    await loadBundle(bundle);
    toast(t('file.opened', { name: useEditor.getState().fileName }), 'success');
    return true;
  } catch (e) {
    toast(e instanceof Error && (e.message === 'bad-file' || e.message === 'bad-project') ? t('err.badFile') : t('err.open', { msg: errMsg(e) }), 'error');
    return false;
  } finally {
    useProduct.getState().set({ busy: null });
  }
}

export async function pickProjectFile(): Promise<void> {
  const f = await pickFile(FILE_TYPES, `${PROJECT_EXT},${PROJECT_MIME}`);
  if (f) await openProjectFile(f);
}

/** Abre archivos que llegan de fuera (asociación de archivos, launchQueue, «Compartir»): .estudio o imágenes. */
export async function openIncoming(files: File[]): Promise<void> {
  const proj = files.find((f) => f.name.toLowerCase().endsWith(PROJECT_EXT));
  if (proj) { await openProjectFile(proj); return; }
  const imgs = files.filter((f) => !f.type || f.type.startsWith('image/'));
  if (imgs.length) await openFiles(imgs, 'auto');
  else toast(t('err.unsupported'), 'error');
}
