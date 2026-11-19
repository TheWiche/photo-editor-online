import type { UiExtension } from '../extensions';
import { Icon } from '../icons';
import { useUI } from '../uiStore';
import { useCreative, type SectionId } from '../../creative/store';
import { FramesSection } from '../../creative/ui/FramesSection';
import { ShapesSection } from '../../creative/ui/ShapesSection';
import { StickersSection } from '../../creative/ui/StickersSection';
import { TextFxSection } from '../../creative/ui/TextFxSection';
import { CollageSection } from '../../creative/ui/CollageSection';
import { TemplatesSection } from '../../creative/ui/TemplatesSection';
import { WatermarkSection } from '../../creative/ui/WatermarkSection';
import { BatchDialog } from '../../creative/ui/BatchDialog';
import { ErrorBoundary } from '../controls';
import '../../creative/creative.css';

function CreativePanel() {
  const setBatchOpen = useCreative((s) => s.setBatchOpen);
  return (
    <ErrorBoundary fallback={<p className="muted">No se pudo mostrar el panel Creativo.</p>}>
      <div className="cr-root">
        <p className="cr-intro">Añade marcos, formas, stickers, texto con efectos y más. Todo se crea como capas que puedes mover y editar.</p>
        <FramesSection />
        <ShapesSection />
        <StickersSection />
        <TextFxSection />
        <CollageSection />
        <TemplatesSection />
        <WatermarkSection />
        <button type="button" className="btn" onClick={() => setBatchOpen(true)}>
          <Icon name="duplicate" size={15} /> Procesamiento por lotes…
        </button>
        <p className="cr-hint">Aplica una receta (tamaño, formato, ajustes, marca de agua) a muchas fotos y guárdalas en una carpeta o en un .zip.</p>
      </div>
    </ErrorBoundary>
  );
}

function go(section: SectionId) {
  useCreative.getState().setOpen(section);
  const ui = useUI.getState();
  ui.setRightTab('creative');
  ui.setSheetOpen(true);
}

export default {
  tabs: [{ id: 'creative', label: 'Creativo', icon: 'wand', Component: CreativePanel }],
  menus: [{
    id: 'insert', label: 'Insertar', icon: 'plus',
    items: [
      { label: 'Marco o borde…', icon: 'image', onSelect: () => go('frames') },
      { label: 'Forma o flecha…', icon: 'plus', onSelect: () => go('shapes') },
      { label: 'Sticker o emoji…', icon: 'sparkles', onSelect: () => go('stickers') },
      { label: 'Texto con efectos…', icon: 'text', onSelect: () => go('textfx') },
      { label: 'Collage…', icon: 'layers', onSelect: () => go('collage') },
      { label: 'Marca de agua…', icon: 'drop', onSelect: () => go('watermark') },
      { label: 'Plantilla de red social…', icon: 'file', onSelect: () => go('templates') },
      { label: 'Procesamiento por lotes…', icon: 'duplicate', onSelect: () => useCreative.getState().setBatchOpen(true) },
    ],
  }],
  overlays: [BatchDialog],
} satisfies UiExtension;
