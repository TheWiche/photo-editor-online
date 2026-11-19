import { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type Side = 'top' | 'bottom' | 'left' | 'right';

interface Props {
  title: string;
  desc?: ReactNode;
  shortcut?: string;
  side?: Side;
  children: ReactElement<{ 'aria-describedby'?: string }>;
}

/** Formatea atajos: «Ctrl+Z» → teclas separadas (⌘ en Mac). */
export function Kbd({ keys }: { keys: string }) {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const parts = keys.split('+').map((k) => (mac && k === 'Ctrl' ? '⌘' : mac && k === 'Alt' ? '⌥' : k));
  return (
    <span className="kbd-group">
      {parts.map((k, i) => <kbd key={i}>{k}</kbd>)}
    </span>
  );
}

/** Tooltip rico (título, descripción y atajo) accesible por ratón y teclado. */
export function Tooltip({ title, desc, shortcut, side = 'bottom', children }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const timer = useRef<number>(0);
  const id = useId();

  const show = (delay: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const hide = () => { window.clearTimeout(timer.current); setOpen(false); setPos(null); };

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', hide, true);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('scroll', hide, true); };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !anchor.current || !bubble.current) return;
    const a = anchor.current.getBoundingClientRect();
    const b = bubble.current.getBoundingClientRect();
    const gap = 8;
    let left = 0, top = 0;
    if (side === 'right') { left = a.right + gap; top = a.top + a.height / 2 - b.height / 2; }
    else if (side === 'left') { left = a.left - b.width - gap; top = a.top + a.height / 2 - b.height / 2; }
    else if (side === 'top') { left = a.left + a.width / 2 - b.width / 2; top = a.top - b.height - gap; }
    else { left = a.left + a.width / 2 - b.width / 2; top = a.bottom + gap; }
    if (top + b.height > window.innerHeight - 4) top = a.top - b.height - gap;
    if (top < 4) top = a.bottom + gap;
    left = Math.min(Math.max(6, left), window.innerWidth - b.width - 6);
    setPos({ left, top });
  }, [open, side]);

  return (
    <span
      ref={anchor}
      className="tip-anchor"
      onPointerEnter={(e) => { if (e.pointerType !== 'touch') show(450); }}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(e) => { if ((e.target as HTMLElement).matches(':focus-visible')) show(150); }}
      onBlur={hide}
    >
      {cloneElement(children, { 'aria-describedby': open ? id : undefined })}
      {open && createPortal(
        <div ref={bubble} id={id} role="tooltip" className="tooltip"
          style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}>
          <div className="tooltip-head">
            <strong>{title}</strong>
            {shortcut && <Kbd keys={shortcut} />}
          </div>
          {desc && <div className="tooltip-desc">{desc}</div>}
        </div>,
        document.body,
      )}
    </span>
  );
}

/** Botón de icono con tooltip y etiqueta accesible. */
export function IconButton({
  label, desc, shortcut, side, children, className = '', pressed, ...rest
}: {
  label: string; desc?: ReactNode; shortcut?: string; side?: Side; children: ReactNode; className?: string; pressed?: boolean;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  return (
    <Tooltip title={label} desc={desc} shortcut={shortcut} side={side}>
      <button type="button" className={`icon-btn ${className}`} aria-label={label}
        aria-keyshortcuts={shortcut?.replace(/\+/g, '+')} aria-pressed={pressed} {...rest}>
        {children}
      </button>
    </Tooltip>
  );
}
