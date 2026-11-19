import { useEffect, useState } from 'react';
import { useEditor } from './core/store';
import { CanvasView } from './ui/CanvasView';
import { ExportDialog, NewDocDialog, ShortcutsDialog } from './ui/Dialogs';
import { openFiles } from './ui/files';
import { Icon } from './ui/icons';
import { MobilePanelNav, RightPanel } from './ui/RightPanel';
import { Toasts } from './ui/Toasts';
import { Toolbar } from './ui/Toolbar';
import { ToolOptions } from './ui/ToolOptions';
import { TopBar } from './ui/TopBar';
import { Tour } from './ui/Tour';
import { extOverlays } from './ui/extensions';
import { isTourDone, useUI } from './ui/uiStore';
import { useShortcuts } from './ui/useShortcuts';
import { Welcome } from './ui/Welcome';
import { WhatPanel } from './ui/WhatPanel';

function useGlobalImageInput() {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const enter = (e: DragEvent) => { if (hasFiles(e)) { depth++; setDragging(true); } };
    const leave = (e: DragEvent) => { if (hasFiles(e)) { depth = Math.max(0, depth - 1); if (!depth) setDragging(false); } };
    const over = (e: DragEvent) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer!.dropEffect = 'copy'; } };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0; setDragging(false);
      if (e.dataTransfer?.files.length) void openFiles([...e.dataTransfer.files], 'auto');
    };
    const paste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const files = [...(e.clipboardData?.items ?? [])].filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
        .map((i) => i.getAsFile()).filter((f): f is File => !!f);
      if (files.length) { e.preventDefault(); void openFiles(files, 'auto'); }
    };
    const beforeUnload = (e: BeforeUnloadEvent) => {
      const s = useEditor.getState();
      if (s.doc && s.dirty) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    window.addEventListener('paste', paste);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
      window.removeEventListener('paste', paste);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, []);
  return dragging;
}

export default function App() {
  useShortcuts();
  const dragging = useGlobalImageInput();
  const hasDoc = useEditor((s) => !!s.doc);
  const busy = useEditor((s) => s.busy);
  const hasDocForDrop = hasDoc;

  useEffect(() => {
    if (isTourDone()) return;
    const t = setTimeout(() => useUI.getState().startTour(), 700);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="app">
      <a className="skip-link" href="#main-canvas">Saltar al lienzo</a>
      <TopBar />
      <ToolOptions />
      <div className="workspace">
        <Toolbar />
        <main className="stage" id="main-canvas" aria-label="Área de trabajo">
          <CanvasView />
          {!hasDoc && <Welcome />}
          <WhatPanel />
          {busy && <div className="busy" role="status"><span className="spinner" aria-hidden="true" /> {busy}</div>}
        </main>
        <RightPanel />
      </div>
      <MobilePanelNav />
      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div><Icon name="upload" size={40} /><p>{hasDocForDrop ? 'Suelta para añadir como capa' : 'Suelta para abrir la imagen'}</p></div>
        </div>
      )}
      <ExportDialog />
      <NewDocDialog />
      <ShortcutsDialog />
      <Tour />
      {extOverlays.map((O, i) => <O key={i} />)}
      <Toasts />
    </div>
  );
}
