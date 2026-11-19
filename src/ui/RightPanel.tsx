import { useId, useRef, type KeyboardEvent } from 'react';
import { AdjustmentsPanel, FiltersPanel } from './AdjustmentsPanel';
import { Icon, type IconName } from './icons';
import { AiToolsPanel } from './AiToolsPanel';
import { LayersPanel } from './LayersPanel';
import { useUI, type RightTab } from './uiStore';

export const TABS: { id: RightTab; label: string; icon: IconName }[] = [
  { id: 'layers', label: 'Capas', icon: 'layers' },
  { id: 'adjust', label: 'Ajustes', icon: 'sliders' },
  { id: 'filters', label: 'Filtros', icon: 'wand' },
  { id: 'ai', label: 'IA', icon: 'sparkles' },
];

/** Panel derecho con pestañas. En móvil se muestra como hoja inferior. */
export function RightPanel() {
  const tab = useUI((s) => s.rightTab);
  const setTab = useUI((s) => s.setRightTab);
  const sheetOpen = useUI((s) => s.sheetOpen);
  const setSheetOpen = useUI((s) => s.setSheetOpen);
  const base = useId();
  const list = useRef<HTMLDivElement>(null);

  const onKey = (e: KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab);
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % TABS.length;
    if (e.key === 'ArrowLeft') n = (i - 1 + TABS.length) % TABS.length;
    if (e.key === 'Home') n = 0;
    if (e.key === 'End') n = TABS.length - 1;
    if (n >= 0) {
      e.preventDefault();
      setTab(TABS[n].id);
      list.current?.querySelectorAll<HTMLButtonElement>('[role=tab]')[n]?.focus();
    }
  };

  return (
    <aside className={`right-panel ${sheetOpen ? 'sheet-open' : ''}`} aria-label="Paneles" data-tour="panel">
      <div className="sheet-handle" aria-hidden="true" onClick={() => setSheetOpen(false)} />
      <div className="tabs" role="tablist" aria-label="Paneles" ref={list} onKeyDown={onKey}>
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" id={`${base}-tab-${t.id}`} aria-selected={tab === t.id}
            aria-controls={`${base}-panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1}
            className={`tab ${tab === t.id ? 'is-on' : ''}`} onClick={() => setTab(t.id)}>
            <Icon name={t.icon} size={15} />{t.label}
          </button>
        ))}
        <button type="button" className="icon-btn icon-btn-sm sheet-close" onClick={() => setSheetOpen(false)} aria-label="Cerrar panel">
          <Icon name="x" size={16} />
        </button>
      </div>
      <div className="tab-panel" role="tabpanel" id={`${base}-panel-${tab}`} aria-labelledby={`${base}-tab-${tab}`} tabIndex={0}>
        {tab === 'layers' && <LayersPanel />}
        {tab === 'adjust' && <AdjustmentsPanel />}
        {tab === 'filters' && <FiltersPanel />}
        {tab === 'ai' && <AiToolsPanel />}
      </div>
    </aside>
  );
}

/** Navegación inferior en móvil: abre la hoja con la pestaña elegida. */
export function MobilePanelNav() {
  const tab = useUI((s) => s.rightTab);
  const sheetOpen = useUI((s) => s.sheetOpen);
  const { setRightTab, setSheetOpen } = useUI.getState();
  return (
    <nav className="mobile-nav" aria-label="Paneles" data-tour="panel">
      {TABS.map((t) => {
        const on = sheetOpen && tab === t.id;
        return (
          <button key={t.id} type="button" aria-pressed={on} className={on ? 'is-on' : ''}
            onClick={() => { if (on) setSheetOpen(false); else { setRightTab(t.id); setSheetOpen(true); } }}>
            <Icon name={t.icon} size={18} /><span>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
