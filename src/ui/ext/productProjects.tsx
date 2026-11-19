import { useCallback, useEffect, useState } from 'react';
import { formatBytes } from '../../core/export';
import { useEditor } from '../../core/store';
import { formatDate, timeAgo, useLang } from '../../i18n';
import { discardSession, recoverSession } from '../../project/autosave';
import * as db from '../../project/db';
import { duplicateProject, exportProjectFile, openProject, pickProjectFile, removeProject, renameProject, saveProject } from '../../project/projects';
import { useProduct } from '../../project/state';
import { Dialog } from '../controls';
import { Icon } from '../icons';

function Thumb({ blob, alt }: { blob?: Blob; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) { setUrl(null); return; }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return <div className="pr-thumb">{url ? <img src={url} alt={alt} /> : <Icon name="image" size={28} />}</div>;
}

function ProjectCard({ p, current, onChange }: { p: db.ProjectMeta; current: boolean; onChange(): void }) {
  const { t, tn } = useLang();
  const [editing, setEditing] = useState(false);
  const close = () => useProduct.getState().set({ projectsOpen: false });
  const commit = async (v: string) => { setEditing(false); if (v.trim() && v.trim() !== p.name) { await renameProject(p.id, v); onChange(); } };
  return (
    <li className={`pr-card ${current ? 'is-current' : ''}`}>
      <Thumb blob={p.thumb} alt={t('projects.thumbAlt', { name: p.name })} />
      <div className="pr-card-body">
        {editing ? (
          <input autoFocus className="pr-rename" aria-label={t('projects.rename')} defaultValue={p.name}
            onBlur={(e) => void commit(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(false); }} />
        ) : (
          <strong className="pr-name" title={p.name}>{p.name}{current && <span className="pr-badge">{t('projects.current')}</span>}</strong>
        )}
        <span className="muted pr-meta">
          {p.width} × {p.height} · {tn('projects.layers', p.layers)} · {formatBytes(p.bytes)}
        </span>
        <span className="muted pr-meta" title={formatDate(p.updatedAt)}>{t('projects.updated', { when: timeAgo(p.updatedAt) })}</span>
        <div className="pr-actions">
          <button type="button" className="btn btn-sm btn-primary" onClick={async () => { if (await openProject(p.id)) close(); }}>
            <Icon name="image" size={14} /> {t('projects.open')}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}><Icon name="text" size={14} /> {t('projects.rename')}</button>
          <button type="button" className="btn btn-sm" onClick={async () => { await duplicateProject(p.id); onChange(); }}><Icon name="duplicate" size={14} /> {t('projects.duplicate')}</button>
          <button type="button" className="btn btn-sm pr-danger" onClick={async () => {
            if (window.confirm(t('projects.confirmDelete', { name: p.name }))) { await removeProject(p.id); onChange(); }
          }}><Icon name="trash" size={14} /> {t('projects.delete')}</button>
        </div>
      </div>
    </li>
  );
}

export function ProjectsDialog() {
  const { t } = useLang();
  const open = useProduct((s) => s.projectsOpen);
  const currentId = useProduct((s) => s.currentId);
  const hasDoc = useEditor((s) => !!s.doc);
  const [list, setList] = useState<db.ProjectMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const close = () => useProduct.getState().set({ projectsOpen: false });

  const refresh = useCallback(async () => {
    try { setList(await db.listProjects()); setError(null); setUsage(await db.storageEstimate()); }
    catch (e) { setList([]); setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { if (open) void refresh(); }, [open, refresh]);

  return (
    <Dialog open={open} onClose={close} title={t('projects.title')} wide footer={(
      <>
        <button type="button" className="btn" onClick={() => void pickProjectFile().then(() => close())}><Icon name="upload" size={16} /> {t('projects.importFile')}</button>
        <button type="button" className="btn" disabled={!hasDoc} onClick={() => void exportProjectFile({ saveAs: true })}><Icon name="download" size={16} /> {t('projects.exportFile')}</button>
        <button type="button" className="btn btn-primary" disabled={!hasDoc} onClick={async () => { await saveProject(); void refresh(); }}>
          <Icon name="check" size={16} /> {t('projects.saveCurrent')}
        </button>
      </>
    )}>
      <p className="panel-hint">{t('projects.hint')}</p>
      {error && <p className="pr-error" role="alert">{t('projects.dbError', { msg: error })}</p>}
      {list && !list.length && !error && <div className="empty">{t('projects.empty')}</div>}
      <ul className="pr-grid" aria-label={t('projects.title')}>
        {list?.map((p) => <ProjectCard key={p.id} p={p} current={p.id === currentId} onChange={() => void refresh()} />)}
      </ul>
      {usage && usage.quota > 0 && <p className="muted pr-usage">{t('projects.usage', { used: formatBytes(usage.usage), quota: formatBytes(usage.quota) })}</p>}
    </Dialog>
  );
}

/** Banner «Recuperar sesión» tras un cierre inesperado. */
export function RecoverBanner() {
  const { t } = useLang();
  const info = useProduct((s) => s.recover);
  if (!info) return null;
  return (
    <div className="pr-banner" role="status">
      <Icon name="reset" size={18} />
      <div className="pr-banner-text">
        <strong>{t('recover.title')}</strong>
        <span>{t('recover.body', { name: info.name, when: timeAgo(info.savedAt), size: `${info.width}×${info.height}` })}</span>
      </div>
      <button type="button" className="btn btn-sm btn-primary" onClick={() => void recoverSession()}>{t('recover.action')}</button>
      <button type="button" className="btn btn-sm" onClick={() => void discardSession()}>{t('recover.discard')}</button>
    </div>
  );
}
