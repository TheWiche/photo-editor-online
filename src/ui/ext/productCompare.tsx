import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor } from '../../core/store';
import { useLang } from '../../i18n';
import { getOriginal } from '../../project/docState';
import { fitScale, renderSnapshot } from '../../project/snapshot';
import { useProduct } from '../../project/state';
import { Icon } from '../icons';

const MAX_SIDE = 2400;

/** Pinta un lienzo DOM dentro de un contenedor (para no codificar a imagen sólo por comparar). */
function CanvasSlot({ canvas }: { canvas: HTMLCanvasElement | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host || !canvas) return;
    canvas.className = 'pr-cmp-canvas';
    host.replaceChildren(canvas);
    return () => { host.replaceChildren(); };
  }, [canvas]);
  return <div ref={ref} className="pr-cmp-slot" aria-hidden="true" />;
}

/** Comparador antes/después con deslizador arrastrable. Atajos: «\» o Alt+B; Esc para cerrar. */
export function CompareOverlay() {
  const { t } = useLang();
  const open = useProduct((s) => s.compareOpen);
  const doc = useEditor((s) => s.doc);
  const masks = useEditor((s) => s.masks);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [pos, setPos] = useState(50);
  const [canvases, setCanvases] = useState<{ before: HTMLCanvasElement; after: HTMLCanvasElement; same: boolean } | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const stack = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const close = useCallback(() => useProduct.getState().set({ compareOpen: false }), []);

  useEffect(() => { if (open) setHost(document.getElementById('main-canvas')); }, [open]);
  useEffect(() => { if (open && !doc) close(); }, [open, doc, close]);

  // Render de «antes» (original al abrir) y «después» (estado actual).
  useEffect(() => {
    if (!open || !doc) { setCanvases(null); return; }
    const orig = getOriginal() ?? { doc, masks };
    const make = (s: { doc: typeof doc; masks: typeof masks }) => renderSnapshot(s, fitScale(s.doc, MAX_SIDE), { background: null, preferDom: true }) as HTMLCanvasElement;
    const timer = setTimeout(() => setCanvases({ before: make(orig), after: make({ doc, masks }), same: orig.doc === doc && orig.masks === masks }), 30);
    return () => clearTimeout(timer);
  }, [open, doc, masks]);

  // Ajusta el marco al tamaño del área disponible respetando la proporción del documento actual.
  useLayoutEffect(() => {
    const el = area.current;
    if (!open || !el || !doc) return;
    const calc = () => {
      const r = el.getBoundingClientRect();
      const k = Math.min(r.width / doc.width, r.height / doc.height);
      setBox({ w: Math.max(10, Math.floor(doc.width * k)), h: Math.max(10, Math.floor(doc.height * k)) });
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, doc, host]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, close]);

  const move = (clientX: number) => {
    const r = stack.current?.getBoundingClientRect();
    if (r && r.width) setPos(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)));
  };

  if (!open || !host || !doc) return null;
  return createPortal(
    <div className="pr-cmp" role="dialog" aria-label={t('compare.title')}>
      <div className="pr-cmp-bar">
        <strong>{t('compare.title')}</strong>
        <span className="muted">{canvases?.same ? t('compare.noChanges') : t('compare.hint')}</span>
        <button type="button" className="icon-btn" onClick={close} aria-label={t('common.close')}><Icon name="x" /></button>
      </div>
      <div className="pr-cmp-area" ref={area}>
        {box && (
          <div className="pr-cmp-stack" ref={stack} style={{ width: box.w, height: box.h }}
            onPointerDown={(e) => { dragging.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); move(e.clientX); }}
            onPointerMove={(e) => { if (dragging.current) move(e.clientX); }}
            onPointerUp={() => { dragging.current = false; }} onPointerCancel={() => { dragging.current = false; }}>
            <div className="pr-cmp-checker" />
            <CanvasSlot canvas={canvases?.after ?? null} />
            <div className="pr-cmp-before" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
              <CanvasSlot canvas={canvases?.before ?? null} />
            </div>
            <span className="pr-cmp-tag pr-cmp-tag-l" style={{ opacity: pos > 12 ? 1 : 0 }}>{t('compare.before')}</span>
            <span className="pr-cmp-tag pr-cmp-tag-r" style={{ opacity: pos < 88 ? 1 : 0 }}>{t('compare.after')}</span>
            <div className="pr-cmp-line" style={{ left: `${pos}%` }}>
              <button type="button" className="pr-cmp-handle" role="slider" aria-label={t('compare.slider')} aria-valuemin={0} aria-valuemax={100}
                aria-valuenow={Math.round(pos)} aria-valuetext={`${Math.round(pos)} %`}
                onKeyDown={(e) => {
                  const step = e.shiftKey ? 10 : 2;
                  if (e.key === 'ArrowLeft') { e.preventDefault(); setPos((p) => Math.max(0, p - step)); }
                  else if (e.key === 'ArrowRight') { e.preventDefault(); setPos((p) => Math.min(100, p + step)); }
                  else if (e.key === 'Home') { e.preventDefault(); setPos(0); }
                  else if (e.key === 'End') { e.preventDefault(); setPos(100); }
                }}>
                <Icon name="compare" size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    host,
  );
}
