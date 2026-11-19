import { useState } from 'react';
import { useEditor } from '../core/store';
import { caption, estimateDepth, ocr, removeBackground, upscale } from '../ai/client';
import { ensureInstalled, useModuleStates } from '../modules/useModule';
import type { ModuleId } from '../core/contracts';
import { Icon } from './icons';
import { useUI } from './uiStore';

interface Action { id: ModuleId; title: string; desc: string; run: (b: ImageBitmap) => Promise<void> }

/** Pestaña «IA»: acciones que se aplican a la capa activa. Todo corre en tu dispositivo. */
export function AiToolsPanel() {
  const [busy, setBusy] = useState<ModuleId | null>(null);
  const [text, setText] = useState('');
  const states = useModuleStates();
  const toast = useUI((s) => s.toast);
  const openDialog = useUI((s) => s.openDialog);

  const actions: Action[] = [
    { id: 'remove-bg', title: 'Quitar fondo', desc: 'Deja solo al sujeto con fondo transparente, incluso cabello.',
      run: async (b) => { const r = await removeBackground(b); const s = useEditor.getState(); s.replaceLayerBitmap(s.doc!.activeLayerId!, r, 'Sin fondo', 'Quitar fondo'); } },
    { id: 'upscale', title: 'Ampliar x2', desc: 'Recupera nitidez en fotos pequeñas o pixeladas. Puede tardar.',
      run: async (b) => { const r = await upscale(b, 2); const s = useEditor.getState(); s.replaceLayerBitmap(s.doc!.activeLayerId!, r, undefined, 'Ampliar x2'); } },
    { id: 'depth', title: 'Mapa de profundidad', desc: 'Crea una capa gris: claro = cerca, oscuro = lejos.',
      run: async (b) => { const r = await estimateDepth(b); useEditor.getState().addLayerFromBitmap(r, 'Profundidad'); } },
    { id: 'ocr', title: 'Leer texto (OCR)', desc: 'Extrae el texto de la imagen para copiarlo.',
      run: async (b) => { const r = await ocr(b); setText(r.text.trim() || '(No se encontró texto)'); } },
    { id: 'caption', title: 'Describir imagen', desc: 'Genera una descripción (en inglés, experimental).',
      run: async (b) => { setText(await caption(b)); } },
  ];

  const go = async (a: Action) => {
    const s = useEditor.getState();
    const layer = s.doc?.layers.find((l) => l.id === s.doc?.activeLayerId);
    if (!layer?.bitmap) { toast('Selecciona una capa de imagen primero.', 'error'); return; }
    if (!(await ensureInstalled(a.id, { openHub: false }))) {
      toast('Este módulo aún no está descargado. Se descarga una sola vez.', 'info');
      openDialog('ai');
      return;
    }
    setBusy(a.id);
    try { await a.run(layer.bitmap); toast(`${a.title}: listo`, 'success'); }
    catch (e) { toast(`${a.title} falló: ${e instanceof Error ? e.message : e}`, 'error'); }
    finally { setBusy(null); }
  };

  return (
    <div className="ai-tools">
      <p className="muted">Se ejecuta en tu dispositivo; tus fotos no se suben a ningún servidor.</p>
      {actions.map((a) => {
        const installed = states[a.id]?.status === 'installed';
        return (
          <button key={a.id} type="button" className="btn ai-action" disabled={busy !== null} onClick={() => void go(a)}>
            <Icon name="sparkles" size={15} />
            <span><strong>{a.title}</strong>{installed ? '' : ' · requiere descarga'}<br /><small>{a.desc}</small></span>
            {busy === a.id && <span className="spinner" aria-label="Procesando" />}
          </button>
        );
      })}
      <button type="button" className="btn" onClick={() => openDialog('ai')}>Abrir Centro de módulos</button>
      {text && (
        <div className="ai-result">
          <textarea readOnly value={text} rows={6} aria-label="Resultado" />
          <button type="button" className="btn" onClick={() => void navigator.clipboard?.writeText(text)}>Copiar</button>
        </div>
      )}
    </div>
  );
}
