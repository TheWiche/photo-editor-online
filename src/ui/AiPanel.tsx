/**
 * Ranura de extensión para la IA. Carga de forma diferida (lazy) el Centro de módulos
 * (`src/modules/ModuleHub.tsx`) y el registro (`src/ai/registry.ts`). Se usan
 * `import.meta.glob` para que la app compile aunque esos archivos aún no existan.
 */
import { lazy, Suspense, type ComponentType } from 'react';
import { Dialog, ErrorBoundary } from './controls';
import { Icon } from './icons';
import { Tooltip } from './Tooltip';
import { useUI } from './uiStore';

const hubLoaders = import.meta.glob<{ default: ComponentType }>('../modules/ModuleHub.tsx');
const registryLoaders = import.meta.glob('../ai/registry.ts');

const hubLoader = hubLoaders['../modules/ModuleHub.tsx'];
const registryLoader = registryLoaders['../ai/registry.ts'];

const ModuleHub = hubLoader ? lazy(hubLoader) : null;

/** Precarga el registro de IA (si existe) sin bloquear la interfaz. */
export function preloadAiRegistry(): Promise<unknown> {
  return registryLoader ? registryLoader().catch(() => null) : Promise.resolve(null);
}

export function AiPlaceholder() {
  return (
    <div className="ai-placeholder">
      <Icon name="sparkles" size={36} />
      <h3>Herramientas de IA en tu navegador</h3>
      <p>
        Aquí aparecerá el <strong>Centro de módulos</strong>: quitar fondo, ampliar resolución, profundidad,
        segmentación, borrado inteligente, texto (OCR) y descripción automática.
      </p>
      <p className="muted">
        Cada modelo se descarga una sola vez y se ejecuta 100&nbsp;% en tu dispositivo: tus fotos no se suben a ningún servidor.
      </p>
    </div>
  );
}

function Loading() {
  return <div className="ai-loading" role="status"><span className="spinner" aria-hidden="true" /> Cargando módulos de IA…</div>;
}

/** Botón «Herramientas IA» + diálogo con el Centro de módulos. */
export function AiPanel() {
  const open = useUI((s) => s.dialog === 'ai');
  const openDialog = useUI((s) => s.openDialog);
  return (
    <>
      <Tooltip title="Herramientas IA" desc="Descarga modelos que funcionan sin conexión: quitar fondo, ampliar, OCR y más." side="bottom">
        <button type="button" className="btn btn-ai" data-tour="ai"
          onPointerEnter={() => { void preloadAiRegistry(); }}
          onClick={() => { void preloadAiRegistry(); openDialog('ai'); }}>
          <Icon name="sparkles" size={16} /><span className="hide-sm">Herramientas IA</span>
        </button>
      </Tooltip>
      <Dialog open={open} onClose={() => openDialog(null)} title="Herramientas IA" wide>
        {ModuleHub ? (
          <ErrorBoundary fallback={<AiPlaceholder />}>
            <Suspense fallback={<Loading />}>
              <ModuleHub />
            </Suspense>
          </ErrorBoundary>
        ) : <AiPlaceholder />}
      </Dialog>
    </>
  );
}

export default AiPanel;
