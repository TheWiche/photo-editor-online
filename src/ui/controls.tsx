import { Component, useEffect, useId, useRef, useState, type CSSProperties, type ErrorInfo, type KeyboardEvent as RKeyboardEvent, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';
import { Kbd, Tooltip } from './Tooltip';

/* ------------------------------------------------------------- Slider */

export function Slider({
  label, value, min, max, step = 1, onChange, onReset, help, unit = '', defaultValue = 0, disabled,
}: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; defaultValue?: number;
  onChange(v: number): void; onReset?(): void; help?: string; disabled?: boolean;
}) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
  const zero = ((Math.min(Math.max(defaultValue, min), max) - min) / (max - min)) * 100;
  const changed = value !== defaultValue;
  return (
    <div className={`slider ${changed ? 'is-changed' : ''}`}>
      <div className="slider-head">
        <label htmlFor={id}>{label}</label>
        {help && (
          <Tooltip title={label} desc={help} side="left">
            <button type="button" className="info-dot" aria-label={`Qué hace ${label}`}><Icon name="info" size={13} /></button>
          </Tooltip>
        )}
        <output htmlFor={id} className="slider-value">{Number.isInteger(step) ? Math.round(value) : value.toFixed(2)}{unit}</output>
        {onReset && (
          <button type="button" className="slider-reset" onClick={onReset} disabled={!changed} aria-label={`Restablecer ${label}`} title="Restablecer">
            <Icon name="reset" size={12} />
          </button>
        )}
      </div>
      <input
        id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        style={{ '--from': `${Math.min(zero, pct)}%`, '--to': `${Math.max(zero, pct)}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={onReset}
        aria-valuetext={`${Math.round(value)}${unit}`}
      />
    </div>
  );
}

/* ------------------------------------------------------------- Segmented */

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string; icon?: IconName; title?: string }[]; onChange(v: T): void; label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value}
          className={value === o.value ? 'is-on' : ''} onClick={() => onChange(o.value)} title={o.title}
          aria-label={o.icon && !o.label ? o.title : undefined}>
          {o.icon && <Icon name={o.icon} size={15} />}{o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- Dialog */

export function Dialog({ open, onClose, title, children, wide, footer }: {
  open: boolean; onClose(): void; title: string; children: ReactNode; wide?: boolean; footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`dialog ${wide ? 'dialog-wide' : ''}`} aria-labelledby={titleId}
      onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {open && (
        <div className="dialog-inner">
          <header className="dialog-head">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar"><Icon name="x" /></button>
          </header>
          <div className="dialog-body">{children}</div>
          {footer && <footer className="dialog-foot">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

/* ------------------------------------------------------------- Menú */

export interface MenuItem { label: string; icon?: IconName; shortcut?: string; onSelect(): void; disabled?: boolean; separator?: boolean }

export function Menu({ label, icon, items, tourId, buttonClass = '' }: { label: string; icon?: IconName; items: MenuItem[]; tourId?: string; buttonClass?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>('[role=menuitem]:not(:disabled)')?.focus());
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  const onKey = (e: RKeyboardEvent) => {
    const els = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); btn.current?.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
    else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <div className="menu-root" ref={root} onKeyDown={onKey}>
      <button ref={btn} type="button" className={`menu-btn ${buttonClass}`} aria-haspopup="menu" aria-expanded={open}
        aria-controls={id} onClick={() => setOpen((o) => !o)} data-tour={tourId}>
        {icon && <Icon name={icon} size={16} />}<span className="menu-btn-label">{label}</span>
      </button>
      {open && (
        <div className="menu" role="menu" id={id} aria-label={label}>
          {items.map((it, i) => it.separator ? <div key={i} className="menu-sep" role="separator" /> : (
            <button key={i} type="button" role="menuitem" disabled={it.disabled}
              onClick={() => { setOpen(false); it.onSelect(); }}>
              {it.icon ? <Icon name={it.icon} size={16} /> : <span style={{ width: 16 }} />}
              <span className="menu-label">{it.label}</span>
              {it.shortcut && <Kbd keys={it.shortcut} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------- ErrorBoundary */

export class ErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Error en panel', error, info); }
  render() { return this.state.error ? this.props.fallback : this.props.children; }
}

export function NumberField({ label, value, onChange, min, max, step = 1, suffix }: {
  label: string; value: number; onChange(v: number): void; min?: number; max?: number; step?: number; suffix?: string;
}) {
  const id = useId();
  return (
    <span className="num-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="number" value={Math.round(value * 100) / 100} min={min} max={max} step={step}
        onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(v); }} />
      {suffix && <span className="num-suffix">{suffix}</span>}
    </span>
  );
}
