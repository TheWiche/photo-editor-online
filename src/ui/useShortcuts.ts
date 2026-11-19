import { useEffect } from 'react';
import type { ToolId } from '../core/defaults';
import { selectActiveLayer, useEditor } from '../core/store';
import { pickFiles } from './files';
import { useUI } from './uiStore';

const TOOL_KEYS: Record<string, ToolId> = { v: 'move', c: 'crop', r: 'rotate', t: 'text', b: 'brush', e: 'eraser', i: 'eyedropper', h: 'hand' };

export const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'V', action: 'Mover' }, { keys: 'C', action: 'Recortar' }, { keys: 'R', action: 'Rotar y voltear' },
  { keys: 'T', action: 'Texto' }, { keys: 'B', action: 'Pincel' }, { keys: 'E', action: 'Borrador de máscara' },
  { keys: 'I', action: 'Cuentagotas' }, { keys: 'H', action: 'Mano' }, { keys: 'Espacio', action: 'Mano temporal (mantener)' },
  { keys: 'Ctrl+Z', action: 'Deshacer' }, { keys: 'Ctrl+Shift+Z', action: 'Rehacer' }, { keys: 'Ctrl+S', action: 'Exportar' },
  { keys: 'Ctrl+O', action: 'Abrir imagen' }, { keys: 'Ctrl+0', action: 'Ajustar a pantalla' }, { keys: 'Ctrl+1', action: 'Zoom 100 %' },
  { keys: '+ / −', action: 'Acercar / alejar' }, { keys: '[ / ]', action: 'Tamaño del pincel' }, { keys: 'Flechas', action: 'Mover capa 1 px (Mayús: 10 px)' },
  { keys: 'Intro', action: 'Aplicar recorte' }, { keys: 'Supr', action: 'Eliminar capa activa' }, { keys: '?', action: 'Ver atajos' },
];

function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  if (t.isContentEditable) return true;
  if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
  if (t.tagName === 'INPUT') {
    const type = (t as HTMLInputElement).type;
    return !['range', 'checkbox', 'radio', 'button', 'color'].includes(type);
  }
  return false;
}

/** Atajos de teclado globales. */
export function useShortcuts() {
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      const s = useEditor.getState();
      const ui = useUI.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (ui.tourOpen) return;

      // Atajos con modificador funcionan incluso escribiendo (salvo deshacer nativo en campos).
      if (mod) {
        if (k === 's') { e.preventDefault(); if (s.doc) ui.openDialog('export'); return; }
        if (k === 'o') { e.preventDefault(); pickFiles('new'); return; }
        if (isTyping(e.target)) return;
        if (k === 'z' && e.shiftKey) { e.preventDefault(); s.redo(); return; }
        if (k === 'z') { e.preventDefault(); s.undo(); return; }
        if (k === 'y') { e.preventDefault(); s.redo(); return; }
        if (k === '0') { e.preventDefault(); s.fitToScreen(); return; }
        if (k === '1') { e.preventDefault(); s.zoomTo(1); return; }
        if (k === '=' || k === '+') { e.preventDefault(); s.zoomBy(1.25); return; }
        if (k === '-') { e.preventDefault(); s.zoomBy(0.8); return; }
        if (k === 'j' && s.doc?.activeLayerId) { e.preventDefault(); s.duplicateLayer(s.doc.activeLayerId); return; }
        return;
      }
      if (isTyping(e.target) || e.altKey) return;
      if (ui.dialog) return;

      if (e.code === 'Space') {
        if ((e.target as HTMLElement)?.tagName === 'BUTTON') return;
        e.preventDefault();
        s.setTempHand(true);
        return;
      }
      if (TOOL_KEYS[k] && !e.repeat) { s.setTool(TOOL_KEYS[k]); return; }
      if (k === '?' ) { ui.openDialog('shortcuts'); return; }
      if (k === '+' || k === '=') { s.zoomBy(1.25); return; }
      if (k === '-') { s.zoomBy(0.8); return; }
      if (k === '[') { s.setBrush({ size: Math.max(1, Math.round(s.brush.size / 1.2)) }); return; }
      if (k === ']') { s.setBrush({ size: Math.min(1000, Math.round(s.brush.size * 1.2) + 1) }); return; }
      if (k === 'enter' && s.tool === 'crop') { e.preventDefault(); s.applyCrop(); return; }
      if (k === 'escape' && s.tool === 'crop') { s.setTool('move'); return; }
      const active = selectActiveLayer(s);
      if ((k === 'delete' || k === 'backspace') && active && s.doc && s.doc.layers.length > 1) {
        e.preventDefault(); s.removeLayer(active.id); return;
      }
      if (k.startsWith('arrow') && active && !active.locked && s.doc) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        const dx = k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0;
        const dy = k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0;
        s.updateLayer(active.id, { x: active.x + dx, y: active.y + dy }, { label: 'Mover capa', coalesce: `nudge:${active.id}` });
      }
    };
    const onUp = (e: KeyboardEvent) => { if (e.code === 'Space') useEditor.getState().setTempHand(false); };
    const onBlur = () => useEditor.getState().setTempHand(false);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
}
