import { useState } from 'react';
import { useEditor, selectActiveLayer } from '../../core/store';
import { Segmented, Slider } from '../../ui/controls';
import { DEFAULT_FRAME, renderDocBorder, renderFrame, type BorderStyle, type FrameOptions } from '../frames';
import { activeImageLayer, addCanvasLayer, needDoc, replaceKeepingScale, sampleCanvas, thumbOf, toast } from '../util';
import { Check, ColorField, Func, Preview, Row, Section, TextField } from './kit';

export function FramesSection() {
  const [o, setO] = useState<FrameOptions>(DEFAULT_FRAME);
  const layer = useEditor(selectActiveLayer);
  const set = (p: Partial<FrameOptions>) => setO((v) => ({ ...v, ...p }));
  const bmp = layer?.bitmap ?? null;

  const preview = () => {
    const base = bmp ? thumbOf(bmp, 200) : sampleCanvas(220, 150);
    const k = base.width / (bmp?.width ?? 1000);
    return renderFrame(base as CanvasImageSource & { width: number; height: number }, o, bmp ? k : base.width / 1000);
  };

  const applyLayer = async () => {
    const l = activeImageLayer();
    if (!l?.bitmap) { toast('Selecciona una capa de imagen para enmarcarla.', 'error'); return; }
    await replaceKeepingScale(l, renderFrame(l.bitmap, o, 1), `${l.name} (marco)`, 'Aplicar marco');
    toast('Marco aplicado a la capa', 'success');
  };
  const applyDoc = async () => {
    if (!needDoc()) return;
    const d = useEditor.getState().doc!;
    if (o.border === 'polaroid' || o.border === 'none') { toast('Para el documento completo usa borde sólido o doble.', 'info'); return; }
    await addCanvasLayer(renderDocBorder(d.width, d.height, o), 'Borde del documento');
    toast('Borde añadido como capa', 'success');
  };

  return (
    <Section id="frames" icon="image" title="Marcos y bordes" hint="Rodea tu foto con un borde, esquinas suaves, estilo Polaroid o sombra.">
      <Preview render={preview} deps={[o, bmp]} />
      <Func title="Estilo de marco" hint="Sólido: una línea de color. Doble: dos líneas con hueco. Polaroid: papel blanco con espacio para una frase.">
        <Segmented<BorderStyle> label="Estilo de borde" value={o.border} onChange={(border) => set({ border })}
          options={[{ value: 'none', label: 'Sin' }, { value: 'solid', label: 'Sólido' }, { value: 'double', label: 'Doble' }, { value: 'polaroid', label: 'Polaroid' }]} />
        {o.border !== 'none' && <>
          <Slider label="Grosor" value={o.width} min={2} max={160} defaultValue={24} unit=" px" onChange={(width) => set({ width })} />
          <Row>
            <ColorField label="Color" value={o.color} onChange={(color) => set({ color })} />
            {o.border === 'double' && <ColorField label="Color del hueco" value={o.color2} onChange={(color2) => set({ color2 })} />}
          </Row>
        </>}
        {o.border === 'polaroid' && <TextField label="Pie de foto" value={o.caption} onChange={(caption) => set({ caption })} placeholder="Verano 2025" />}
      </Func>
      <Func title="Esquinas redondeadas" hint="Suaviza las esquinas de la imagen y del marco.">
        <Slider label="Radio" value={o.radius} min={0} max={300} unit=" px" onChange={(radius) => set({ radius })} />
      </Func>
      <Func title="Sombra paralela" hint="Proyecta una sombra detrás para dar sensación de profundidad.">
        <Check label="Activar sombra" checked={o.shadow} onChange={(shadow) => set({ shadow })} />
        {o.shadow && <>
          <ColorField label="Color de la sombra" value={o.shadowColor} onChange={(shadowColor) => set({ shadowColor })} />
          <Slider label="Desenfoque" value={o.shadowBlur} min={0} max={120} defaultValue={24} unit=" px" onChange={(shadowBlur) => set({ shadowBlur })} />
          <Slider label="Desplazamiento X" value={o.shadowX} min={-100} max={100} defaultValue={8} unit=" px" onChange={(shadowX) => set({ shadowX })} />
          <Slider label="Desplazamiento Y" value={o.shadowY} min={-100} max={100} defaultValue={12} unit=" px" onChange={(shadowY) => set({ shadowY })} />
          <Slider label="Opacidad" value={o.shadowOpacity} min={0} max={1} step={0.05} defaultValue={0.5} onChange={(shadowOpacity) => set({ shadowOpacity })} />
        </>}
      </Func>
      <div className="cr-actions">
        <button type="button" className="btn btn-primary" onClick={() => void applyLayer()}>Aplicar a la capa activa</button>
        <button type="button" className="btn" onClick={() => void applyDoc()}>Borde de todo el documento</button>
      </div>
      <p className="cr-note">Se puede deshacer con Ctrl+Z. El borde del documento se crea como una capa aparte que puedes mover u ocultar.</p>
    </Section>
  );
}
