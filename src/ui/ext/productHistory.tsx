import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../../core/store';
import { useLang } from '../../i18n';
import { buildTimeline, cachedThumb, jumpTo, requestThumb, type TimelineItem } from '../../project/history';

function HistThumb({ item }: { item: TimelineItem }) {
  const [src, setSrc] = useState<string | undefined>(() => (item.doc ? cachedThumb(item.doc, item.masks) : undefined));
  useEffect(() => {
    if (!item.doc) return;
    const hit = cachedThumb(item.doc, item.masks);
    if (hit) { setSrc(hit); return; }
    let live = true;
    // Retardo corto: si el documento cambia sin parar (p. ej. arrastrando un deslizador) no se generan miniaturas de más.
    const timer = setTimeout(() => { void requestThumb(item.doc!, item.masks).then((u) => { if (live) setSrc(u); }); }, item.kind === 'current' ? 350 : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [item.doc, item.masks, item.kind]);
  return <span className="pr-hthumb">{src ? <img src={src} alt="" /> : null}</span>;
}

export function HistoryPanel() {
  const { t, tn } = useLang();
  const past = useEditor((s) => s.past);
  const future = useEditor((s) => s.future);
  const doc = useEditor((s) => s.doc);
  const masks = useEditor((s) => s.masks);
  const list = useRef<HTMLOListElement>(null);
  const items = buildTimeline({ past, future, doc, masks });
  const curIndex = past.length;

  useEffect(() => { list.current?.querySelector('[aria-current="step"]')?.scrollIntoView({ block: 'nearest' }); }, [curIndex, items.length]);

  if (!doc) return <div className="empty">{t('history.noDoc')}</div>;
  return (
    <div className="pr-history">
      <p className="panel-hint">{t('history.hint')}</p>
      <ol className="pr-hlist" ref={list} aria-label={t('history.title')}>
        {items.map((it) => {
          const current = it.index === curIndex;
          const label = it.label || t('history.initial');
          return (
            <li key={it.key}>
              <button type="button" className={`pr-hitem ${current ? 'is-current' : ''} ${it.kind === 'future' ? 'is-future' : ''}`}
                aria-current={current ? 'step' : undefined} onClick={() => jumpTo(it.index)}
                title={current ? t('history.current') : it.index < curIndex ? tn('history.back', curIndex - it.index) : tn('history.forward', it.index - curIndex)}>
                <HistThumb item={it} />
                <span className="pr-hlabel">
                  <span>{label}</span>
                  <span className="muted">{current ? t('history.current') : it.kind === 'future' ? t('history.redo') : `#${it.index}`}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="pr-hfoot muted">{tn('history.steps', past.length)}</div>
    </div>
  );
}
