import { useEffect, useState } from 'react';
import { formatBytes } from '../../core/export';
import { useEditor } from '../../core/store';
import { useLang } from '../../i18n';
import { addCurrentPage, addLayerPages, avifSupported, exportAdvanced, FORMATS, usePdfPages, type AdvFormat } from '../../project/exporter';
import { canSaveToDisk } from '../../project/fsAccess';
import type { PdfSize } from '../../project/pdf';
import { usePrefs } from '../../project/prefs';
import { useProduct } from '../../project/state';
import { Dialog, Segmented, Slider } from '../controls';
import { Icon } from '../icons';
import { useUI } from '../uiStore';
import { readPref, writePref } from '../storage';

const SCALES = [0.25, 0.5, 1, 2, 4];

export function AdvancedExportDialog() {
  const { t } = useLang();
  const open = useProduct((s) => s.exportOpen);
  const close = () => useProduct.getState().set({ exportOpen: false });
  const doc = useEditor((s) => s.doc);
  const fileName = useEditor((s) => s.fileName);
  const toast = useUI((s) => s.toast);
  const strip = usePrefs((s) => s.stripMetadata);
  const pages = usePdfPages((s) => s.pages);
  const [format, setFormat] = useState<AdvFormat>(() => readPref<AdvFormat>('advFormat', 'jpeg'));
  const [quality, setQuality] = useState(() => readPref('advQuality', 90));
  const [scale, setScale] = useState(1);
  const [bg, setBg] = useState<'#ffffff' | '#000000'>('#ffffff');
  const [pdfSize, setPdfSize] = useState<PdfSize>('a4');
  const [toDisk, setToDisk] = useState(() => readPref('advToDisk', true));
  const [name, setName] = useState(fileName);
  const [busy, setBusy] = useState(false);
  const [avif, setAvif] = useState<boolean | null>(null);
  const fsa = canSaveToDisk();

  useEffect(() => { if (open) setName(fileName); }, [open, fileName]);
  useEffect(() => { if (open) void avifSupported().then(setAvif); }, [open]);

  if (!doc) return null;
  const info = FORMATS[format];
  const isPdf = format === 'pdf';

  const run = async () => {
    setBusy(true);
    try {
      writePref('advFormat', format); writePref('advQuality', quality); writePref('advToDisk', toDisk);
      const r = await exportAdvanced({ format, quality: quality / 100, scale, fileName: name, background: bg, stripMetadata: strip, toDisk: toDisk && fsa, pdf: { size: pdfSize } });
      if (r.via === 'cancelled') return;
      if (r.fallbackFrom) toast(t('export.fallback', { from: FORMATS[r.fallbackFrom].label, name: r.fileName }), 'info');
      toast(t(r.via === 'saved' ? 'export.saved' : 'export.done', { name: r.fileName, size: formatBytes(r.size) }), 'success');
      close();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally { setBusy(false); }
  };

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onClose={close} title={t('export.title')} footer={(
      <button type="button" className="btn btn-primary" onClick={run} disabled={busy}>
        <Icon name="download" size={16} /> {busy ? t('common.working') : fsa && toDisk ? t('export.saveToDisk') : t('export.download')}
      </button>
    )}>
      <div className="form-grid">
        <label className="field">
          <span>{t('export.fileName')}</span>
          <span className="field-inline"><input value={name} onChange={(e) => setName(e.target.value)} /><span className="muted">.{info.ext}</span></span>
        </label>
        <div className="field">
          <span>{t('export.format')}</span>
          <Segmented<AdvFormat> label={t('export.format')} value={format} onChange={setFormat}
            options={(Object.keys(FORMATS) as AdvFormat[]).map((f) => ({ value: f, label: FORMATS[f].label }))} />
          <p className="panel-hint">{t(`export.hint.${format}` as 'export.hint.jpeg')}</p>
          {format === 'avif' && avif === false && <p className="pr-error">{t('export.avifUnsupported')}</p>}
        </div>

        {!isPdf && info.lossy && (
          <Slider label={t('export.quality')} value={quality} min={10} max={100} unit="%" defaultValue={90} onChange={setQuality} onReset={() => setQuality(90)}
            help={t('export.qualityHelp')} />
        )}
        {!isPdf && (
          <div className="field">
            <span>{t('export.size')}</span>
            <Segmented label={t('export.size')} value={String(scale)} onChange={(v) => setScale(Number(v))} options={SCALES.map((s) => ({ value: String(s), label: `${s * 100}%` }))} />
            <p className="panel-hint">{Math.round(doc.width * scale)} × {Math.round(doc.height * scale)} px</p>
          </div>
        )}
        {format === 'jpeg' && (
          <div className="field">
            <span>{t('export.background')}</span>
            <Segmented<'#ffffff' | '#000000'> label={t('export.background')} value={bg} onChange={setBg}
              options={[{ value: '#ffffff', label: t('export.white') }, { value: '#000000', label: t('export.black') }]} />
          </div>
        )}

        {isPdf && (
          <div className="field">
            <span>{t('export.pageSize')}</span>
            <Segmented<PdfSize> label={t('export.pageSize')} value={pdfSize} onChange={setPdfSize}
              options={[{ value: 'a4', label: 'A4' }, { value: 'letter', label: t('export.letter') }, { value: 'fit', label: t('export.fit') }]} />
            <p className="panel-hint">{pages.length ? t('export.pagesHint') : t('export.pagesEmpty')}</p>
            {pages.length > 0 && (
              <ol className="pr-pages">
                {pages.map((p, i) => (
                  <li key={p.id}>
                    <img src={p.thumb} alt="" />
                    <span className="pr-page-name">{i + 1}. {p.label}</span>
                    <button type="button" className="icon-btn icon-btn-sm" aria-label={t('export.pageUp')} disabled={i === 0} onClick={() => usePdfPages.getState().move(p.id, -1)}><Icon name="chevronUp" size={14} /></button>
                    <button type="button" className="icon-btn icon-btn-sm" aria-label={t('export.pageDown')} disabled={i === pages.length - 1} onClick={() => usePdfPages.getState().move(p.id, 1)}><Icon name="chevronDown" size={14} /></button>
                    <button type="button" className="icon-btn icon-btn-sm" aria-label={t('export.pageRemove')} onClick={() => usePdfPages.getState().remove(p.id)}><Icon name="trash" size={14} /></button>
                  </li>
                ))}
              </ol>
            )}
            <div className="pr-row">
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void guard(addCurrentPage)}><Icon name="plus" size={14} /> {t('export.addPage')}</button>
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void guard(addLayerPages)}><Icon name="layers" size={14} /> {t('export.addLayerPages')}</button>
              {pages.length > 0 && <button type="button" className="btn btn-sm" onClick={() => usePdfPages.getState().clear()}>{t('export.clearPages')}</button>}
            </div>
          </div>
        )}

        <div className="field">
          <span>{t('export.privacy')}</span>
          <label className="switch">
            <input type="checkbox" checked={strip} onChange={(e) => usePrefs.getState().setStripMetadata(e.target.checked)} />
            <span className="switch-track" aria-hidden="true" />
            <span>{t('privacy.strip')}</span>
          </label>
          <p className="panel-hint">{strip || format !== 'jpeg' ? t('export.stripNote') : t('export.keepNote')}</p>
        </div>

        <div className="field">
          <span>{t('export.destination')}</span>
          {fsa ? (
            <label className="switch">
              <input type="checkbox" checked={toDisk} onChange={(e) => setToDisk(e.target.checked)} />
              <span className="switch-track" aria-hidden="true" />
              <span>{t('export.direct')}</span>
            </label>
          ) : <p className="panel-hint">{t('export.noFsa')}</p>}
        </div>
      </div>
    </Dialog>
  );
}
