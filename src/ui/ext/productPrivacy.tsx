import { useEditor } from '../../core/store';
import { useLang } from '../../i18n';
import { useSourceInfo } from '../../project/docState';
import { hasAnyMetadata, type MetaItem } from '../../project/exif';
import { usePrefs } from '../../project/prefs';
import { productUI } from '../../project/state';
import { Icon } from '../icons';

const GROUPS: { id: MetaItem['group']; key: 'privacy.g.location' | 'privacy.g.personal' | 'privacy.g.camera' | 'privacy.g.capture' | 'privacy.g.software' | 'privacy.g.other' }[] = [
  { id: 'location', key: 'privacy.g.location' }, { id: 'personal', key: 'privacy.g.personal' }, { id: 'camera', key: 'privacy.g.camera' },
  { id: 'capture', key: 'privacy.g.capture' }, { id: 'software', key: 'privacy.g.software' }, { id: 'other', key: 'privacy.g.other' },
];

/** Panel «Privacidad»: qué datos trae la foto y qué pasa con ellos al exportar. */
export function PrivacyPanel() {
  const { t } = useLang();
  const hasDoc = useEditor((s) => !!s.doc);
  const info = useSourceInfo();
  const strip = usePrefs((s) => s.stripMetadata);
  const meta = info?.meta;

  if (!hasDoc) return <div className="empty">{t('privacy.noDoc')}</div>;
  const found = !!meta && hasAnyMetadata(meta);
  const flags = meta ? ([
    meta.flags.exif && 'EXIF', meta.flags.xmp && 'XMP', meta.flags.iptc && 'IPTC', meta.flags.icc && t('privacy.icc'), meta.flags.thumbnail && t('privacy.thumb'),
  ].filter(Boolean) as string[]) : [];

  return (
    <div className="pr-privacy">
      {meta?.gps && (
        <div className="pr-alert pr-alert-danger" role="alert">
          <Icon name="info" size={18} />
          <div>
            <strong>{t('privacy.gpsTitle')}</strong>
            <p>{t('privacy.gpsBody', { coords: `${meta.gps.lat.toFixed(4)}, ${meta.gps.lon.toFixed(4)}` })}</p>
            <a className="link-btn" href={`https://www.openstreetmap.org/?mlat=${meta.gps.lat}&mlon=${meta.gps.lon}#map=15/${meta.gps.lat}/${meta.gps.lon}`} target="_blank" rel="noopener noreferrer">{t('privacy.viewMap')}</a>
          </div>
        </div>
      )}
      {!meta && <p className="panel-hint">{t('privacy.noSource')}</p>}
      {meta && !found && <div className="pr-alert pr-alert-ok"><Icon name="check" size={18} /><p>{t('privacy.clean')}</p></div>}
      {meta && found && !meta.gps && <p className="panel-hint">{t('privacy.hasMeta')}</p>}

      {meta && GROUPS.map((g) => {
        const rows = meta.items.filter((i) => i.group === g.id);
        if (!rows.length) return null;
        return (
          <section key={g.id} className="pr-meta-group">
            <h3>{t(g.key)}</h3>
            <dl>
              {rows.map((r, i) => (
                <div key={i} className={r.sensitive ? 'is-sensitive' : ''}>
                  <dt>{t(r.labelKey)}</dt><dd>{r.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}
      {flags.length > 0 && <p className="muted pr-flags">{t('privacy.also', { list: flags.join(', ') })}</p>}

      <section className="pr-meta-group">
        <h3>{t('privacy.export')}</h3>
        <label className="switch">
          <input type="checkbox" checked={strip} onChange={(e) => usePrefs.getState().setStripMetadata(e.target.checked)} />
          <span className="switch-track" aria-hidden="true" />
          <span>{t('privacy.strip')}</span>
        </label>
        <p className="panel-hint">{strip ? t('privacy.stripOn') : t('privacy.stripOff')}</p>
        <button type="button" className="btn btn-sm" onClick={productUI.openExport}><Icon name="download" size={14} /> {t('privacy.openExport')}</button>
      </section>
    </div>
  );
}
