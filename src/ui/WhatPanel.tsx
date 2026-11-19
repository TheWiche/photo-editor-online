import { selectEffectiveTool, useEditor } from '../core/store';
import { toolInfo } from '../core/tools';
import { Icon } from './icons';
import { Kbd } from './Tooltip';
import { useUI } from './uiStore';

/** Panel didáctico «¿Qué hace?» que explica la herramienta activa. */
export function WhatPanel() {
  const tool = useEditor(selectEffectiveTool);
  const hasDoc = useEditor((s) => !!s.doc);
  const open = useUI((s) => s.whatOpen);
  const setOpen = useUI((s) => s.setWhatOpen);
  if (!open || !hasDoc) return null;
  const t = toolInfo(tool);
  return (
    <aside className="what-panel" aria-label={`¿Qué hace? ${t.label}`} aria-live="polite">
      <header>
        <span className="what-kicker">¿Qué hace?</span>
        <button type="button" className="icon-btn icon-btn-sm" onClick={() => setOpen(false)} aria-label="Cerrar panel ¿Qué hace?">
          <Icon name="x" size={14} />
        </button>
      </header>
      <h3>{t.label} <Kbd keys={t.shortcut} /></h3>
      <p>{t.what}</p>
      <ol>{t.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
      <p className="what-tip"><Icon name="info" size={14} /> {t.tip}</p>
    </aside>
  );
}
