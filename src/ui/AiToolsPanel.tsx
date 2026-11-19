/**
 * Pestaña «IA»: acciones que se aplican a la capa activa. Todo corre en tu dispositivo.
 * Cada acción muestra su estado (descarga → ejecución → resultado), progreso, se puede cancelar y
 * los cambios en el documento se deshacen con el historial del editor.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { useEditor } from '../core/store';
import type { Layer, ModuleId, ProgressEvent } from '../core/contracts';
import { caption, detectNsfw, estimateDepth, install, ocr, removeBackground, upscale } from '../ai/client';
import type { NsfwResult, OcrResult } from '../ai/types';
import { getModuleSpec } from '../ai/registry';
import { getStates, subscribe } from '../ai/status';
import { openPortrait } from '../ai/uiBus';
import { Icon } from './icons';
import { useUI } from './uiStore';
import './ext/ai.css';

// ------------------------------------------------------------------ tipos y estado (persisten al cambiar de pestaña)

type ActionId = 'remove-bg' | 'upscale' | 'depth' | 'portrait' | 'parallax' | 'ocr' | 'caption' | 'nsfw';
type Phase = 'idle' | 'downloading' | 'running' | 'done' | 'error' | 'cancelled';

type JobResult =
  | { kind: 'doc'; label: string; pastLen: number; summary: string }
  | { kind: 'ocr'; ocr: OcrResult }
  | { kind: 'caption'; text: string }
  | { kind: 'nsfw'; nsfw: NsfwResult };

interface Job {
  phase: Phase;
  progress: number | null;
  detail?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
  result?: JobResult;
}

interface PanelState {
  jobs: Partial<Record<ActionId, Job>>;
  running: ActionId | null;
  controller: AbortController | null;
  scale: 2 | 4;
  set(id: ActionId, patch: Partial<Job>): void;
}

const usePanel = create<PanelState>()((set, get) => ({
  jobs: {},
  running: null,
  controller: null,
  scale: 2,
  set: (id, patch) => set({ jobs: { ...get().jobs, [id]: { ...(get().jobs[id] ?? { phase: 'idle', progress: null, startedAt: Date.now() }), ...patch } } }),
}));

interface RunCtx {
  layer: Layer & { bitmap: ImageBitmap };
  signal: AbortSignal;
  onProgress: (e: ProgressEvent) => void;
}

interface ActionDef {
  id: ActionId;
  module: ModuleId;
  title: string;
  desc: string;
  /** Abre un diálogo propio en vez de ejecutar aquí. */
  dialog?: () => void;
  run?: (c: RunCtx) => Promise<JobResult>;
}

/** Añade una capa resultado con la misma posición/escala/rotación que la capa origen. */
function addResultLayer(src: Layer, bitmap: ImageBitmap, name: string, label: string): void {
  const ow = src.bitmap?.width ?? bitmap.width, oh = src.bitmap?.height ?? bitmap.height;
  const sx = src.scaleX * (ow / bitmap.width), sy = src.scaleY * (oh / bitmap.height);
  const cx = src.x + ow / 2, cy = src.y + oh / 2;
  useEditor.getState().addLayer(
    { name, kind: 'image', bitmap, x: cx - bitmap.width / 2, y: cy - bitmap.height / 2, scaleX: sx, scaleY: sy, rotation: src.rotation },
    { label },
  );
}

function docResult(label: string, summary: string): JobResult {
  return { kind: 'doc', label, summary, pastLen: useEditor.getState().past.length };
}

function stillThere(id: string): boolean {
  return !!useEditor.getState().doc?.layers.some((l) => l.id === id);
}

const ACTIONS: ActionDef[] = [
  {
    id: 'remove-bg', module: 'remove-bg', title: 'Quitar fondo', desc: 'Deja solo al sujeto con fondo transparente, incluso el cabello.',
    run: async ({ layer, signal, onProgress }) => {
      const r = await removeBackground(layer.bitmap, { signal, onProgress });
      if (!stillThere(layer.id)) throw new Error('La capa ya no existe');
      useEditor.getState().replaceLayerBitmap(layer.id, r, `${layer.name} sin fondo`, 'Quitar fondo');
      return docResult('Quitar fondo', 'Fondo eliminado en la capa activa.');
    },
  },
  {
    id: 'upscale', module: 'upscale', title: 'Ampliar resolución', desc: 'Reconstruye detalle al agrandar ×2 o ×4. En CPU puede tardar minutos.',
    run: async ({ layer, signal, onProgress }) => {
      const s = usePanel.getState().scale;
      const r = await upscale(layer.bitmap, s, { signal, onProgress });
      if (!stillThere(layer.id)) throw new Error('La capa ya no existe');
      const label = `Ampliar ×${s}`;
      useEditor.getState().replaceLayerBitmap(layer.id, r, undefined, label);
      return docResult(label, `Ahora mide ${r.width}×${r.height} px (mantiene su tamaño en el lienzo).`);
    },
  },
  {
    id: 'depth', module: 'depth', title: 'Mapa de profundidad', desc: 'Crea una capa en grises: claro = cerca, oscuro = lejos.',
    run: async ({ layer, signal, onProgress }) => {
      const r = await estimateDepth(layer.bitmap, { signal, onProgress });
      addResultLayer(layer, r, 'Profundidad', 'Mapa de profundidad');
      return docResult('Mapa de profundidad', 'Nueva capa «Profundidad» encima de la activa.');
    },
  },
  { id: 'portrait', module: 'depth', title: 'Modo retrato (bokeh)', desc: 'Desenfoca el fondo según la distancia. Elige el punto de enfoque con un clic.', dialog: () => openPortrait('bokeh') },
  { id: 'parallax', module: 'depth', title: 'Efecto 3D (parallax)', desc: 'Anima la foto con movimiento en profundidad. Exporta GIF o vídeo WebM.', dialog: () => openPortrait('parallax') },
  {
    id: 'ocr', module: 'ocr', title: 'Leer texto (OCR)', desc: 'Extrae el texto de la imagen (español e inglés) para copiarlo o descargarlo.',
    run: async ({ layer, signal }) => ({ kind: 'ocr', ocr: await ocr(layer.bitmap, { signal }) }),
  },
  {
    id: 'caption', module: 'caption', title: 'Describir imagen', desc: 'Genera una descripción (en inglés, experimental).',
    run: async ({ layer, signal, onProgress }) => ({ kind: 'caption', text: await caption(layer.bitmap, { signal, onProgress }) }),
  },
  {
    id: 'nsfw', module: 'nsfw', title: 'Revisar contenido sensible', desc: 'Avisa si la imagen podría contener desnudos. Solo informa: no bloquea nada.',
    run: async ({ layer, signal, onProgress }) => ({ kind: 'nsfw', nsfw: await detectNsfw(layer.bitmap, { signal, onProgress }) }),
  },
];

function activeImageLayer(): (Layer & { bitmap: ImageBitmap }) | null {
  const s = useEditor.getState();
  const l = s.doc?.layers.find((x) => x.id === s.doc?.activeLayerId);
  return l?.bitmap ? (l as Layer & { bitmap: ImageBitmap }) : null;
}

const isCancel = (e: unknown) => (e as Error)?.name === 'AbortError';

async function runAction(a: ActionDef): Promise<void> {
  const P = usePanel.getState();
  const toast = useUI.getState().toast;
  if (P.running) return;
  const layer = activeImageLayer();
  if (!layer) {
    toast('Selecciona una capa de imagen primero.', 'error');
    return;
  }
  const ctl = new AbortController();
  usePanel.setState({ running: a.id, controller: ctl });
  P.set(a.id, { phase: 'downloading', progress: null, startedAt: Date.now(), error: undefined, result: undefined, detail: 'Comprobando el módulo…', finishedAt: undefined });
  try {
    if (getStates()[a.module]?.status !== 'installed') {
      P.set(a.id, { detail: 'Descargando el módulo (solo esta vez)…' });
    }
    await install(a.module, undefined, ctl.signal); // muestra el aviso de descarga si hace falta
    if (a.dialog) {
      P.set(a.id, { phase: 'idle', detail: undefined });
      a.dialog();
      return;
    }
    P.set(a.id, { phase: 'running', progress: null, detail: 'Procesando en tu dispositivo…', startedAt: Date.now() });
    const result = await a.run!({
      layer,
      signal: ctl.signal,
      onProgress: (e) => P.set(a.id, { progress: e.totalBytes ? Math.min(1, e.loadedBytes / e.totalBytes) : e.progress || null, detail: e.file }),
    });
    usePanel.getState().set(a.id, { phase: 'done', progress: 1, result, finishedAt: Date.now(), detail: undefined });
    if (result.kind === 'doc') toast(`${a.title}: listo`, 'success');
  } catch (e) {
    if (isCancel(e) || ctl.signal.aborted) usePanel.getState().set(a.id, { phase: 'cancelled', detail: undefined, finishedAt: Date.now() });
    else {
      const msg = e instanceof Error ? e.message : String(e);
      usePanel.getState().set(a.id, { phase: 'error', error: msg, detail: undefined, finishedAt: Date.now() });
      toast(`${a.title} falló: ${msg}`, 'error');
    }
  } finally {
    usePanel.setState({ running: null, controller: null });
  }
}

// ------------------------------------------------------------------ utilidades de descarga de texto

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function ocrToCsv(r: OcrResult): string {
  const rows = [['texto', 'confianza', 'x', 'y', 'ancho', 'alto']];
  for (const w of r.words) rows.push([w.text, w.confidence.toFixed(1), String(w.bbox.x), String(w.bbox.y), String(w.bbox.width), String(w.bbox.height)]);
  // Separador «;» y BOM: se abre bien en hojas de cálculo con configuración regional española.
  return '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
}

const baseName = () => (useEditor.getState().fileName || 'imagen').replace(/[\\/:*?"<>|]+/g, '_');

// ------------------------------------------------------------------ componentes

function useTick(on: boolean) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setN((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [on]);
}

const secs = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
};

function OcrView({ r }: { r: OcrResult }) {
  const toast = useUI((s) => s.toast);
  const [text, setText] = useState(r.text);
  useEffect(() => setText(r.text), [r]);
  const empty = !r.text.trim();
  return (
    <div className="aip-result">
      <div className="aip-result-head">
        <strong>Texto reconocido</strong>
        <span className="muted">{r.words.length} palabras · confianza {Math.round(r.confidence)} %</span>
      </div>
      {empty ? (
        <p className="muted">No se encontró texto. Funciona mejor con letras nítidas, horizontales y con buen contraste.</p>
      ) : (
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} aria-label="Texto reconocido (puedes corregirlo antes de copiar)" spellCheck />
      )}
      <div className="aip-row">
        <button type="button" className="btn" disabled={empty} onClick={() => void navigator.clipboard?.writeText(text).then(() => toast('Texto copiado', 'success'), () => toast('No se pudo copiar', 'error'))}>
          <Icon name="copy" size={14} /> Copiar
        </button>
        <button type="button" className="btn" disabled={empty} onClick={() => saveBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${baseName()}-texto.txt`)}>
          <Icon name="download" size={14} /> .txt
        </button>
        <button type="button" className="btn" disabled={!r.words.length} title="Cada palabra con su confianza y posición" onClick={() => saveBlob(new Blob([ocrToCsv(r)], { type: 'text/csv;charset=utf-8' }), `${baseName()}-palabras.csv`)}>
          <Icon name="download" size={14} /> .csv
        </button>
      </div>
    </div>
  );
}

function NsfwView({ r }: { r: NsfwResult }) {
  const pct = Math.round(r.score * 100);
  const level = r.score >= 0.7 ? 'alto' : r.score >= 0.4 ? 'medio' : 'bajo';
  return (
    <div className={`aip-result aip-nsfw aip-nsfw--${level}`} role="status">
      <div className="aip-result-head">
        <strong>{level === 'alto' ? 'Posible contenido sensible' : level === 'medio' ? 'Resultado dudoso' : 'Parece contenido apto'}</strong>
        <span>{pct} %</span>
      </div>
      <div className="aip-meter" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
      <p className="muted">
        {level === 'bajo'
          ? 'No se detectan desnudos ni contenido para adultos.'
          : 'Revisa la imagen antes de compartirla; puedes difuminar zonas con las herramientas de retoque.'}{' '}
        Es orientativo y solo informa: no se bloquea ni se envía nada.
      </p>
    </div>
  );
}

function CaptionView({ text }: { text: string }) {
  const toast = useUI((s) => s.toast);
  return (
    <div className="aip-result">
      <div className="aip-result-head"><strong>Descripción</strong><span className="muted">en inglés</span></div>
      <p className="aip-caption">{text || '(sin descripción)'}</p>
      <div className="aip-row">
        <button type="button" className="btn" onClick={() => void navigator.clipboard?.writeText(text).then(() => toast('Descripción copiada', 'success'))}>
          <Icon name="copy" size={14} /> Copiar
        </button>
      </div>
    </div>
  );
}

function DocResultView({ r }: { r: Extract<JobResult, { kind: 'doc' }> }) {
  const pastLen = useEditor((s) => s.past.length);
  const lastLabel = useEditor((s) => s.past[s.past.length - 1]?.label);
  const canUndo = pastLen === r.pastLen && lastLabel === r.label;
  return (
    <div className="aip-result aip-result--doc">
      <span><Icon name="check" size={14} /> {r.summary}</span>
      <button type="button" className="btn" disabled={!canUndo} onClick={() => useEditor.getState().undo()}
        title={canUndo ? `Deshacer «${r.label}»` : 'Ya hay otros cambios encima: usa Deshacer (Ctrl+Z) en el historial'}>
        <Icon name="undo" size={14} /> Deshacer
      </button>
    </div>
  );
}

function ActionCard({ a }: { a: ActionDef }) {
  const job = usePanel((s) => s.jobs[a.id]);
  const running = usePanel((s) => s.running);
  const scale = usePanel((s) => s.scale);
  const mstates = useSyncExternalStore(subscribe, getStates, getStates);
  const mod = mstates[a.module];
  const spec = getModuleSpec(a.module);
  const me = running === a.id;
  useTick(me);
  const installed = mod?.status === 'installed';
  const phase: Phase = job?.phase ?? 'idle';
  const downloading = me && (phase === 'downloading' || mod?.status === 'downloading');
  const progress = downloading ? mod?.fraction ?? null : job?.progress ?? null;

  const statusText =
    me && downloading ? 'Descargando…' :
    me ? `Procesando · ${secs(Date.now() - (job?.startedAt ?? Date.now()))}` :
    phase === 'done' ? `Listo${job?.finishedAt ? ` en ${secs(job.finishedAt - job.startedAt)}` : ''}` :
    phase === 'error' ? 'Error' :
    phase === 'cancelled' ? 'Cancelado' :
    installed ? 'Instalado' : `Requiere descarga · ~${spec.sizeByVariantMB.wasm} MB`;

  return (
    <div className={`aip-card aip-card--${me ? 'running' : phase}`} data-action={a.id}>
      <button type="button" className="aip-main" disabled={running !== null} onClick={() => void runAction(a)} aria-describedby={`aip-st-${a.id}`}>
        <span className="aip-icon"><Icon name={a.dialog ? 'image' : 'sparkles'} size={16} /></span>
        <span className="aip-text">
          <strong>{a.title}{spec.availability === 'experimental' && <em className="aip-exp">experimental</em>}</strong>
          <small>{a.desc}</small>
        </span>
      </button>
      {a.id === 'upscale' && (
        <div className="aip-row aip-scale" role="radiogroup" aria-label="Factor de ampliación">
          {[2, 4].map((s) => (
            <button key={s} type="button" role="radio" aria-checked={scale === s} className={`chip ${scale === s ? 'is-on' : ''}`} disabled={running !== null}
              onClick={() => usePanel.setState({ scale: s as 2 | 4 })}>×{s}</button>
          ))}
        </div>
      )}
      <div className="aip-status" id={`aip-st-${a.id}`} aria-live="polite">
        <span className={`aip-dot aip-dot--${me ? 'running' : phase === 'idle' ? (installed ? 'ok' : 'off') : phase}`} aria-hidden="true" />
        <span className="aip-status-text">{statusText}</span>
        {me && (
          <button type="button" className="link-btn aip-cancel" onClick={() => usePanel.getState().controller?.abort()}>
            Cancelar
          </button>
        )}
      </div>
      {me && (
        <div className={`aip-bar${progress == null ? ' aip-bar--indet' : ''}`} role="progressbar" aria-label={`Progreso de ${a.title}`}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress == null ? undefined : Math.round(progress * 100)}>
          <span style={{ width: `${(progress ?? 0) * 100}%` }} />
        </div>
      )}
      {me && job?.detail && <p className="aip-detail" title={job.detail}>{job.detail}</p>}
      {!me && phase === 'error' && job?.error && <p className="aip-error" role="alert">{job.error}</p>}
      {!me && phase === 'done' && job?.result?.kind === 'doc' && <DocResultView r={job.result} />}
      {!me && phase === 'done' && job?.result?.kind === 'ocr' && <OcrView r={job.result.ocr} />}
      {!me && phase === 'done' && job?.result?.kind === 'caption' && <CaptionView text={job.result.text} />}
      {!me && phase === 'done' && job?.result?.kind === 'nsfw' && <NsfwView r={job.result.nsfw} />}
    </div>
  );
}

function CanvasToolsNote() {
  const mstates = useSyncExternalStore(subscribe, getStates, getStates);
  const toast = useUI((s) => s.toast);
  const items: { id: ModuleId; title: string; how: string }[] = [
    { id: 'segment', title: 'Selección inteligente', how: 'Clic sobre un objeto para seleccionarlo.' },
    { id: 'inpaint', title: 'Borrador mágico', how: 'Pinta lo que quieras borrar y la IA rellena el hueco.' },
  ];
  return (
    <div className="aip-canvas-tools">
      <p className="aip-section">Herramientas de lienzo</p>
      {items.map((it) => {
        const st = mstates[it.id];
        const spec = getModuleSpec(it.id);
        return (
          <div key={it.id} className="aip-mini">
            <span><strong>{it.title}</strong><small>{it.how}</small></span>
            {st?.status === 'installed' ? (
              <span className="aip-ok"><Icon name="check" size={13} /> Listo</span>
            ) : st?.status === 'downloading' ? (
              <span className="muted">{Math.round((st.fraction ?? 0) * 100)} %</span>
            ) : (
              <button type="button" className="btn" onClick={() => void install(it.id).catch((e) => !isCancel(e) && toast(String((e as Error).message), 'error'))}>
                <Icon name="download" size={13} /> ~{spec.sizeByVariantMB.wasm} MB
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function AiToolsPanel() {
  const openDialog = useUI((s) => s.openDialog);
  const hasImage = useEditor((s) => !!s.doc?.layers.find((l) => l.id === s.doc?.activeLayerId)?.bitmap);
  return (
    <div className="ai-tools aip">
      <p className="muted aip-lead">
        <Icon name="lock" size={13} /> Se ejecuta en tu dispositivo: tus fotos no se suben a ningún servidor.
      </p>
      {!hasImage && <p className="aip-hint">Abre una imagen y selecciona una capa de imagen para usar estas acciones.</p>}
      <p className="aip-section">Acciones sobre la capa activa</p>
      {ACTIONS.map((a) => <ActionCard key={a.id} a={a} />)}
      <CanvasToolsNote />
      <button type="button" className="btn aip-hub" onClick={() => openDialog('ai')}>
        <Icon name="sparkles" size={15} /> Abrir Centro de módulos
      </button>
    </div>
  );
}
