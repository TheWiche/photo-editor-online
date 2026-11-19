import { useEffect, useId, useRef, type ReactNode } from 'react';
import '../creative.css';
import { Icon, type IconName } from '../../ui/icons';
import { paintPreview, type AnyCanvas } from '../util';
import { useCreative, type SectionId } from '../store';

/** Sección plegable con título y una línea de explicación. */
export function Section({ id, title, hint, icon, children }: { id: SectionId; title: string; hint: string; icon: IconName; children: ReactNode }) {
  const open = useCreative((s) => s.open === id);
  const setOpen = useCreative((s) => s.setOpen);
  const bid = useId();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (open) ref.current?.scrollIntoView({ block: 'nearest' }); }, [open]);
  return (
    <section className={`cr-section ${open ? 'is-open' : ''}`} ref={ref} data-section={id}>
      <button type="button" className="cr-head" aria-expanded={open} aria-controls={bid} onClick={() => setOpen(open ? null : id)}>
        <Icon name={icon} size={16} />
        <span className="cr-head-text"><strong>{title}</strong><small>{hint}</small></span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} />
      </button>
      {open && <div className="cr-body" id={bid}>{children}</div>}
    </section>
  );
}

/** Subtítulo con explicación de una función. */
export function Func({ title, hint, children }: { title: string; hint: string; children?: ReactNode }) {
  return (
    <div className="cr-func">
      <h4>{title}</h4>
      <p className="cr-hint">{hint}</p>
      {children}
    </div>
  );
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }) {
  const id = useId();
  return (
    <label className="cr-color" htmlFor={id}>
      <span>{label}</span>
      <input id={id} type="color" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="cr-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function TextField({ label, value, onChange, placeholder, multiline }: { label: string; value: string; onChange(v: string): void; placeholder?: string; multiline?: boolean }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {multiline
        ? <textarea id={id} rows={2} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        : <input id={id} type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}

export function SelectField<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange(v: T): void }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

/** Lienzo de vista previa: `render` se vuelve a ejecutar cuando cambian `deps`. */
export function Preview({ render, deps, label = 'Vista previa', height = 190 }: { render: () => AnyCanvas | null; deps: unknown[]; label?: string; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      try { const c = render(); if (c) paintPreview(ref.current, c); } catch (e) { console.warn('preview', e); }
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return (
    <div className="cr-preview" style={{ height }}>
      <canvas ref={ref} aria-label={label} role="img" />
    </div>
  );
}

export function Row({ children }: { children: ReactNode }) { return <div className="cr-row">{children}</div>; }
