/**
 * «Centro de módulos»: el sitio desde el que se descargan (una sola vez) los modelos de IA locales.
 * Componente autónomo, sin props. Para abrirlo resaltando un módulo usa `openModuleHub(id)`
 * (ver useModule.ts); este panel lee esa petición para resaltar y desplazar la tarjeta.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ModuleId } from '../core/contracts';
import { MODULES, ORT_RUNTIME_MB, type ModuleSpec } from '../ai/registry';
import type { ModuleState } from '../ai/status';
import type { BackendInfo, VariantKey } from '../ai/types';
import { estimate, refreshInstalled, requestPersistence } from '../ai/client';
import type { StorageEstimate } from '../ai/cache';
import { useBackend, useHubRequest, useModuleStates, useModuleStatus } from './useModule';
import './modules.css';

const nf1 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 0 });
const pct = new Intl.NumberFormat('es-ES', { style: 'percent', maximumFractionDigits: 0 });

function fmtBytes(b: number): string {
  if (!Number.isFinite(b) || b <= 0) return '0 MB';
  if (b >= 1e9) return `${nf1.format(b / 1e9)} GB`;
  if (b >= 1e6) return `${nf1.format(b / 1e6)} MB`;
  return `${nf1.format(b / 1e3)} KB`;
}

function variantOf(b: BackendInfo | null): VariantKey {
  if (!b || b.backend !== 'webgpu') return 'wasm';
  return b.f16 ? 'webgpu-f16' : 'webgpu';
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export default function ModuleHub() {
  const states = useModuleStates();
  const backend = useBackend();
  const online = useOnline();
  const hub = useHubRequest();
  const [storage, setStorage] = useState<StorageEstimate | null>(null);

  const installedCount = MODULE_IDS_LIST.filter((id) => states[id].status === 'installed').length;
  const busy = MODULE_IDS_LIST.some((id) => states[id].status === 'downloading');
  const runtimeInstalled = MODULES.some((m) => m.needsRuntime && states[m.id].status === 'installed');

  // Re-verifica la caché real al abrir el Centro.
  useEffect(() => {
    void refreshInstalled();
  }, []);

  // Recalcula el espacio usado cuando cambia el número de instalados o termina una descarga.
  useEffect(() => {
    let alive = true;
    void estimate().then((e) => alive && setStorage(e));
    return () => {
      alive = false;
    };
  }, [installedCount, busy]);

  const askPersist = async () => {
    await requestPersistence();
    setStorage(await estimate());
  };

  const usedFraction = storage && storage.quotaBytes > 0 ? Math.min(1, storage.usedBytes / storage.quotaBytes) : 0;

  return (
    <section className="mh" aria-labelledby="mh-title">
      <header className="mh-header">
        <div>
          <h2 id="mh-title" className="mh-title">Centro de módulos</h2>
          <p className="mh-subtitle">
            Herramientas de inteligencia artificial que funcionan <strong>dentro de tu navegador</strong>: tus fotos nunca
            se suben a ningún servidor.
          </p>
        </div>
        <div className="mh-count" aria-live="polite">
          <span className="mh-count-num">{installedCount}</span>
          <span className="mh-count-label">de {MODULES.length} instalados</span>
        </div>
      </header>

      <div className="mh-notice" role="note">
        <IconDownload />
        <p>
          Cada módulo <strong>se descarga una sola vez y queda guardado en tu dispositivo</strong>. Después funciona sin
          internet y no se vuelve a descargar al reabrir la app.
        </p>
      </div>

      {!online && (
        <div className="mh-notice mh-notice--warn" role="status">
          <IconOffline />
          <p>Estás sin conexión. Puedes usar los módulos ya instalados, pero para descargar nuevos necesitas internet.</p>
        </div>
      )}

      <div className="mh-panels">
        <div className={`mh-panel mh-backend mh-backend--${backend?.backend ?? 'pending'}`}>
          <div className="mh-panel-head">
            <IconChip />
            <span className="mh-panel-title">
              {backend ? (backend.backend === 'webgpu' ? 'Aceleración WebGPU activa' : 'Modo compatible (WebAssembly)') : 'Detectando tu equipo…'}
            </span>
          </div>
          <p className="mh-panel-text">{backend?.reasonEs ?? 'Comprobando si tu navegador puede usar la tarjeta gráfica.'}</p>
          {backend?.adapter && <p className="mh-panel-small">GPU: {backend.adapter}</p>}
        </div>

        <div className="mh-panel mh-storage">
          <div className="mh-panel-head">
            <IconDisk />
            <span className="mh-panel-title">Almacenamiento</span>
            {storage?.persisted ? (
              <span className="mh-badge mh-badge--ok">Protegido</span>
            ) : (
              <button type="button" className="mh-link" onClick={askPersist}>
                Proteger del borrado automático
              </button>
            )}
          </div>
          {storage?.supported ? (
            <>
              <div className="mh-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(usedFraction * 100)} aria-label="Espacio usado">
                <span style={{ width: `${Math.max(usedFraction * 100, storage.usedBytes > 0 ? 1 : 0)}%` }} />
              </div>
              <p className="mh-panel-text">
                Módulos: <strong>{fmtBytes(storage.modulesBytes)}</strong> · Total del sitio: {fmtBytes(storage.usedBytes)} de{' '}
                {fmtBytes(storage.quotaBytes)} disponibles
              </p>
            </>
          ) : (
            <p className="mh-panel-text">Tu navegador no informa del espacio disponible.</p>
          )}
          {!storage?.persisted && (
            <p className="mh-panel-small">
              Si el disco se llena, el navegador podría borrar los modelos. «Proteger» le pide que los conserve.
            </p>
          )}
        </div>
      </div>

      <ul className="mh-grid">
        {MODULES.map((m) => (
          <li key={m.id}>
            <ModuleCard
              spec={m}
              state={states[m.id]}
              variant={variantOf(backend)}
              runtimeInstalled={runtimeInstalled}
              focused={hub.focusId === m.id}
              focusSeq={hub.seq}
              online={online}
            />
          </li>
        ))}
      </ul>

      <p className="mh-footnote">
        Los modelos proceden de Hugging Face y jsDelivr y se guardan en la caché de este sitio. Puedes eliminarlos cuando
        quieras para liberar espacio.
      </p>
    </section>
  );
}

const MODULE_IDS_LIST: ModuleId[] = MODULES.map((m) => m.id);

interface CardProps {
  spec: ModuleSpec;
  state: ModuleState;
  variant: VariantKey;
  runtimeInstalled: boolean;
  focused: boolean;
  focusSeq: number;
  online: boolean;
}

function ModuleCard({ spec, state, variant, runtimeInstalled, focused, focusSeq, online }: CardProps) {
  const mod = useModuleStatus(spec.id);
  const ref = useRef<HTMLElement>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focused, focusSeq]);

  useEffect(() => {
    if (!confirmRemove) return;
    const t = window.setTimeout(() => setConfirmRemove(false), 4000);
    return () => window.clearTimeout(t);
  }, [confirmRemove]);

  const soon = spec.availability === 'proximamente';
  const sizeMB = state.status === 'installed' && state.bytes ? state.bytes / 1e6 : spec.sizeByVariantMB[variant];
  const extraRuntime = spec.needsRuntime && !runtimeInstalled && state.status !== 'installed';

  const statusLabel = useMemo(() => {
    if (soon) return 'Próximamente';
    if (state.checking) return 'Comprobando…';
    switch (state.status) {
      case 'installed':
        return 'Instalado';
      case 'downloading':
        return 'Descargando';
      case 'error':
        return 'Error';
      default:
        return 'No instalado';
    }
  }, [soon, state.checking, state.status]);

  const onRemove = async () => {
    if (!confirmRemove) return setConfirmRemove(true);
    setRemoving(true);
    try {
      await mod.remove();
    } finally {
      setRemoving(false);
      setConfirmRemove(false);
    }
  };

  return (
    <article ref={ref} className={`mh-card mh-card--${state.status}${focused ? ' mh-card--focus' : ''}`} aria-labelledby={`mh-${spec.id}`}>
      <div className="mh-card-head">
        <h3 id={`mh-${spec.id}`} className="mh-card-title">
          {spec.nameEs}
        </h3>
        <span className={`mh-status mh-status--${soon ? 'soon' : state.status}`}>
          {state.status === 'installed' && <IconCheck />}
          {statusLabel}
        </span>
      </div>

      {spec.availability === 'experimental' && <span className="mh-badge mh-badge--exp">Experimental</span>}

      <p className="mh-card-desc">{spec.descriptionEs}</p>

      <details className="mh-more">
        <summary>Más información</summary>
        <p>{spec.detailsEs}</p>
        <dl>
          <dt>Modelo</dt>
          <dd>{spec.modelRepo}</dd>
          <dt>Motor</dt>
          <dd>{spec.engine}</dd>
          <dt>Licencia</dt>
          <dd>{spec.licenseEs}</dd>
        </dl>
      </details>

      <p className="mh-size">
        <span>
          {state.status === 'installed' ? 'Ocupa' : 'Descarga'}: <strong>~{nf1.format(sizeMB)} MB</strong>
        </span>
        {extraRuntime && <span className="mh-size-extra">+ motor de IA compartido ~{ORT_RUNTIME_MB} MB (solo la primera vez)</span>}
      </p>

      {state.status === 'downloading' && (
        <div className="mh-progress" aria-live="polite">
          <div
            className={`mh-bar${state.fraction == null ? ' mh-bar--indeterminate' : ''}`}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={state.fraction == null ? undefined : Math.round(state.fraction * 100)}
            aria-label={`Descargando ${spec.nameEs}`}
          >
            <span style={{ width: `${(state.fraction ?? 0) * 100}%` }} />
          </div>
          <div className="mh-progress-text">
            <span>
              {fmtBytes(state.loadedBytes)} de {fmtBytes(state.totalBytes)}
              {state.fraction != null && ` · ${pct.format(state.fraction)}`}
            </span>
            {state.file && (
              <span className="mh-progress-file" title={state.file}>
                {state.file}
              </span>
            )}
          </div>
        </div>
      )}

      {state.status === 'error' && state.error && (
        <p className="mh-error" role="alert">
          {state.error}
        </p>
      )}

      <div className="mh-actions">
        {soon ? (
          <button type="button" className="mh-btn" disabled>
            Próximamente
          </button>
        ) : state.status === 'downloading' ? (
          <button type="button" className="mh-btn mh-btn--ghost" onClick={mod.cancel}>
            Cancelar
          </button>
        ) : state.status === 'installed' ? (
          <>
            <span className="mh-installed">
              <IconCheck /> Listo, funciona sin internet
            </span>
            <button type="button" className={`mh-btn mh-btn--danger${confirmRemove ? ' mh-btn--confirm' : ''}`} onClick={onRemove} disabled={removing}>
              {removing ? 'Eliminando…' : confirmRemove ? '¿Seguro? Eliminar' : 'Eliminar'}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="mh-btn mh-btn--primary"
            onClick={() => void mod.install()}
            disabled={!online || state.checking}
            title={!online ? 'Necesitas conexión para descargar' : undefined}
          >
            <IconDownload />
            {state.status === 'error' ? 'Reintentar' : 'Descargar'}
          </button>
        )}
      </div>
    </article>
  );
}

// ------------------------------------------------------------------ iconos (SVG en línea)

const svg = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

function IconDownload() {
  return (
    <svg {...svg}>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}
function IconCheck() {
  return (
    <svg {...svg} width={14} height={14}>
      <path d="m5 12 5 5L20 7" />
    </svg>
  );
}
function IconChip() {
  return (
    <svg {...svg}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
    </svg>
  );
}
function IconDisk() {
  return (
    <svg {...svg}>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
      <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </svg>
  );
}
function IconOffline() {
  return (
    <svg {...svg}>
      <path d="M2 2l20 20" />
      <path d="M8.5 16.5a5 5 0 0 1 7 0" />
      <path d="M5 13a10 10 0 0 1 5.2-2.8M19 13a10 10 0 0 0-2.4-1.7" />
      <path d="M12 20h.01" />
    </svg>
  );
}
