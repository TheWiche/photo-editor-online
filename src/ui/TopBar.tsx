import { useState } from 'react';
import { copyToClipboard } from '../core/export';
import { sampleBitmap } from '../core/image';
import { useEditor } from '../core/store';
import { AiPanel } from './AiPanel';
import { Menu } from './controls';
import { pickFiles } from './files';
import { Icon } from './icons';
import { IconButton } from './Tooltip';
import { useUI } from './uiStore';

export async function openSample() {
  const bmp = await sampleBitmap();
  const s = useEditor.getState();
  if (s.doc) s.addLayerFromBitmap(bmp, 'Ejemplo');
  else {
    s.addLayerFromBitmap(bmp, 'Fondo');
    s.setFileName('ejemplo');
  }
}

export function TopBar() {
  const hasDoc = useEditor((s) => !!s.doc);
  const zoom = useEditor((s) => s.view.zoom);
  const undoLabel = useEditor((s) => s.past[s.past.length - 1]?.label);
  const redoLabel = useEditor((s) => s.future[s.future.length - 1]?.label);
  const fileName = useEditor((s) => s.fileName);
  const { undo, redo, zoomBy, zoomTo, fitToScreen, setCompare, closeDocument, setFileName } = useEditor.getState();
  const { openDialog, startTour, toast, whatOpen, setWhatOpen } = useUI();
  const [editingName, setEditingName] = useState(false);

  const copy = async () => {
    try { await copyToClipboard(); toast('Imagen copiada al portapapeles', 'success'); }
    catch (e) { toast((e as Error).message, 'error'); }
  };

  return (
    <header className="topbar">
      <div className="brand" aria-label="Estudio Foto IA">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-name hide-sm">Estudio Foto</span>
      </div>

      <Menu label="Archivo" icon="file" tourId="file" items={[
        { label: 'Nuevo lienzo…', icon: 'plus', onSelect: () => openDialog('new') },
        { label: 'Abrir imagen…', icon: 'upload', shortcut: 'Ctrl+O', onSelect: () => pickFiles('new') },
        { label: 'Añadir imagen como capa…', icon: 'layers', onSelect: () => pickFiles('layer'), disabled: !hasDoc },
        { label: 'Imagen de ejemplo', icon: 'image', onSelect: () => { void openSample(); } },
        { label: '', separator: true, onSelect: () => {} },
        { label: 'Exportar…', icon: 'download', shortcut: 'Ctrl+S', onSelect: () => openDialog('export'), disabled: !hasDoc },
        { label: 'Copiar al portapapeles', icon: 'copy', onSelect: () => { void copy(); }, disabled: !hasDoc },
        { label: '', separator: true, onSelect: () => {} },
        { label: 'Cerrar documento', icon: 'x', onSelect: () => { if (!useEditor.getState().dirty || confirm('¿Cerrar sin exportar? Se perderán los cambios.')) closeDocument(); }, disabled: !hasDoc },
      ]} />

      <div className="topbar-group" role="group" aria-label="Historial">
        <IconButton label="Deshacer" desc={undoLabel ? `Deshace: ${undoLabel}` : 'Nada que deshacer'} shortcut="Ctrl+Z" onClick={undo} disabled={!undoLabel}>
          <Icon name="undo" />
        </IconButton>
        <IconButton label="Rehacer" desc={redoLabel ? `Rehace: ${redoLabel}` : 'Nada que rehacer'} shortcut="Ctrl+Shift+Z" onClick={redo} disabled={!redoLabel}>
          <Icon name="redo" />
        </IconButton>
      </div>

      {hasDoc && (
        <div className="file-name hide-sm">
          {editingName ? (
            <input autoFocus aria-label="Nombre del archivo" defaultValue={fileName}
              onBlur={(e) => { setFileName(e.target.value.trim() || 'sin-titulo'); setEditingName(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); }} />
          ) : (
            <button type="button" className="link-btn" onClick={() => setEditingName(true)} title="Renombrar">{fileName}</button>
          )}
        </div>
      )}

      <div className="topbar-spacer" />

      <div className="topbar-group zoom-group" role="group" aria-label="Zoom">
        <IconButton label="Alejar" shortcut="-" onClick={() => zoomBy(0.8)} disabled={!hasDoc}><Icon name="zoomOut" /></IconButton>
        <IconButton label="Ajustar a la pantalla" desc="Clic: ajustar. Doble clic: 100 %." shortcut="Ctrl+0" className="zoom-value"
          onClick={() => fitToScreen()} onDoubleClick={() => zoomTo(1)} disabled={!hasDoc}>
          <span aria-hidden="true">{Math.round(zoom * 100)}%</span>
        </IconButton>
        <IconButton label="Acercar" shortcut="+" onClick={() => zoomBy(1.25)} disabled={!hasDoc}><Icon name="zoomIn" /></IconButton>
      </div>

      <IconButton label="Comparar con el original" desc="Mantén pulsado para ver la imagen sin ajustes ni filtros." className="hide-sm"
        disabled={!hasDoc}
        onPointerDown={() => setCompare(true)} onPointerUp={() => setCompare(false)} onPointerLeave={() => setCompare(false)}
        onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') setCompare(true); }} onKeyUp={() => setCompare(false)}>
        <Icon name="compare" />
      </IconButton>

      <Menu label="Ayuda" icon="help" tourId="help" buttonClass="menu-btn-compact" items={[
        { label: 'Tour guiado', icon: 'info', onSelect: startTour },
        { label: whatOpen ? 'Ocultar «¿Qué hace?»' : 'Mostrar «¿Qué hace?»', icon: 'help', onSelect: () => setWhatOpen(!whatOpen) },
        { label: 'Atajos de teclado', icon: 'keyboard', shortcut: '?', onSelect: () => openDialog('shortcuts') },
      ]} />

      <AiPanel />

      <button type="button" className="btn btn-primary" data-tour="export" onClick={() => openDialog('export')} disabled={!hasDoc}>
        <Icon name="download" size={16} /><span className="hide-sm">Exportar</span>
      </button>
    </header>
  );
}
