import { useState } from 'react';
import { useEditor, selectActiveLayer } from '../../core/store';
import { Segmented } from '../../ui/controls';
import { DEFAULT_WM, drawWatermark, renderWatermarkLayer, type WatermarkOptions } from '../watermark';
import { activeImageLayer, addCanvasLayer, createCanvas, ctx2d, needDoc, replaceKeepingScale, sampleCanvas, thumbOf, toast } from '../util';
import { Func, Preview, Section } from './kit';
import { WatermarkControls } from './WatermarkControls';

export function WatermarkSection() {
  const [o, setO] = useState<WatermarkOptions>(DEFAULT_WM);
  const [target, setTarget] = useState<'doc' | 'layer'>('doc');
  const layer = useEditor(selectActiveLayer);
  const set = (p: Partial<WatermarkOptions>) => setO((v) => ({ ...v, ...p }));

  const preview = () => {
    const base = layer?.bitmap ? thumbOf(layer.bitmap, 240) : sampleCanvas(240, 170);
    const c = createCanvas(base.width, base.height);
    const x = ctx2d(c); x.drawImage(base as CanvasImageSource, 0, 0);
    drawWatermark(x, c.width, c.height, o);
    return c;
  };

  const apply = async () => {
    if (!needDoc()) return;
    if (o.kind === 'logo' && !o.logo) { toast('Elige primero un logo.', 'error'); return; }
    const d = useEditor.getState().doc!;
    if (target === 'doc') {
      await addCanvasLayer(renderWatermarkLayer(d.width, d.height, o), 'Marca de agua');
      toast('Marca de agua añadida como capa', 'success');
      return;
    }
    const l = activeImageLayer();
    if (!l?.bitmap) { toast('Selecciona una capa de imagen.', 'error'); return; }
    const c = createCanvas(l.bitmap.width, l.bitmap.height);
    const x = ctx2d(c); x.drawImage(l.bitmap, 0, 0);
    drawWatermark(x, c.width, c.height, o);
    await replaceKeepingScale(l, c, l.name, 'Marca de agua en capa');
    toast('Marca de agua aplicada a la capa', 'success');
  };

  return (
    <Section id="watermark" icon="drop" title="Marca de agua" hint="Protege tus fotos con tu nombre o logo: una esquina o en mosaico.">
      <Preview render={preview} deps={[o, layer?.bitmap]} height={170} />
      <WatermarkControls o={o} set={set} />
      <Func title="¿Dónde aplicarla?" hint="Sobre todo el documento crea una capa nueva editable; en la capa se incrusta en sus píxeles.">
        <Segmented<'doc' | 'layer'> label="Destino" value={target} onChange={setTarget}
          options={[{ value: 'doc', label: 'Todo el documento' }, { value: 'layer', label: 'Capa activa' }]} />
      </Func>
      <button type="button" className="btn btn-primary" onClick={() => void apply()}>Aplicar marca de agua</button>
    </Section>
  );
}
