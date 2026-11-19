import { useState } from 'react';
import { useEditor } from '../../core/store';
import { Slider } from '../../ui/controls';
import { DEFAULT_TEXTFX, renderTextFx, type TextFxOptions } from '../textfx';
import { addCanvasLayer, needDoc, toast, docUnit } from '../util';
import { Check, ColorField, Func, Preview, Row, Section, SelectField, TextField } from './kit';

const FONTS = [
  { value: 'Inter, system-ui, sans-serif', label: 'Inter (moderna)' },
  { value: 'Georgia, "Times New Roman", serif', label: 'Georgia (serif)' },
  { value: 'Impact, "Arial Black", sans-serif', label: 'Impact (titulares)' },
  { value: '"Courier New", monospace', label: 'Courier (máquina)' },
  { value: '"Comic Sans MS", "Segoe Print", cursive', label: 'Manuscrita' },
];

export function TextFxSection() {
  const [o, setO] = useState<TextFxOptions>(DEFAULT_TEXTFX);
  const set = (p: Partial<TextFxOptions>) => setO((v) => ({ ...v, ...p }));

  const add = async () => {
    if (!needDoc()) return;
    if (!o.text.trim()) { toast('Escribe un texto.', 'error'); return; }
    const u = docUnit();
    const k = Math.min(1, 8000 / Math.max(u, 1)); // evita lienzos enormes
    const id = await addCanvasLayer(renderTextFx({ ...o, size: Math.max(8, o.size) }, k), `Texto: ${o.text.slice(0, 20)}`);
    useEditor.getState().setActive(id);
    toast('Texto añadido como capa (ya rasterizado)', 'success');
  };

  return (
    <Section id="textfx" icon="text" title="Texto con efectos" hint="Contorno, sombra, resplandor, degradado y texto curvado. Se rasteriza a una capa.">
      <Preview render={() => renderTextFx({ ...o, size: 54 }, 1)} deps={[o]} height={130} />
      <TextField label="Texto" multiline value={o.text} onChange={(text) => set({ text })} />
      <Row>
        <SelectField label="Tipografía" value={o.font} options={FONTS} onChange={(font) => set({ font })} />
      </Row>
      <Row><Check label="Negrita" checked={o.bold} onChange={(bold) => set({ bold })} /><Check label="Cursiva" checked={o.italic} onChange={(italic) => set({ italic })} /></Row>
      <Slider label="Tamaño" value={o.size} min={16} max={600} defaultValue={120} unit=" px" onChange={(size) => set({ size })} />
      <Func title="Color y degradado" hint="Rellena las letras con un color o con una mezcla de dos colores.">
        <Row><ColorField label="Color" value={o.fill} onChange={(fill) => set({ fill })} /><Check label="Degradado" checked={o.gradient} onChange={(gradient) => set({ gradient })} /></Row>
        {o.gradient && <><ColorField label="Segundo color" value={o.fill2} onChange={(fill2) => set({ fill2 })} />
          <Slider label="Ángulo" value={o.gradAngle} min={0} max={360} defaultValue={90} unit="°" onChange={(gradAngle) => set({ gradAngle })} /></>}
      </Func>
      <Func title="Contorno" hint="Una línea alrededor de cada letra mejora la lectura sobre fotos.">
        <Check label="Contorno" checked={o.stroke} onChange={(stroke) => set({ stroke })} />
        {o.stroke && <><ColorField label="Color del contorno" value={o.strokeColor} onChange={(strokeColor) => set({ strokeColor })} />
          <Slider label="Grosor" value={o.strokeWidth} min={1} max={60} defaultValue={8} unit=" px" onChange={(strokeWidth) => set({ strokeWidth })} /></>}
      </Func>
      <Func title="Sombra" hint="Una sombra proyectada separa el texto del fondo.">
        <Check label="Sombra" checked={o.shadow} onChange={(shadow) => set({ shadow })} />
        {o.shadow && <><ColorField label="Color de la sombra" value={o.shadowColor} onChange={(shadowColor) => set({ shadowColor })} />
          <Slider label="Desenfoque" value={o.shadowBlur} min={0} max={60} defaultValue={12} unit=" px" onChange={(shadowBlur) => set({ shadowBlur })} />
          <Slider label="Desplazamiento X" value={o.shadowX} min={-40} max={40} defaultValue={6} unit=" px" onChange={(shadowX) => set({ shadowX })} />
          <Slider label="Desplazamiento Y" value={o.shadowY} min={-40} max={40} defaultValue={8} unit=" px" onChange={(shadowY) => set({ shadowY })} /></>}
      </Func>
      <Func title="Resplandor" hint="Un halo de luz de color alrededor de las letras (estilo neón).">
        <Check label="Resplandor" checked={o.glow} onChange={(glow) => set({ glow })} />
        {o.glow && <><ColorField label="Color del halo" value={o.glowColor} onChange={(glowColor) => set({ glowColor })} />
          <Slider label="Tamaño" value={o.glowSize} min={2} max={100} defaultValue={24} unit=" px" onChange={(glowSize) => set({ glowSize })} /></>}
      </Func>
      <Func title="Texto curvado" hint="Dobla el texto sobre un arco: positivo = hacia arriba (sonrisa invertida), negativo = hacia abajo.">
        <Slider label="Curvatura" value={o.arc} min={-100} max={100} defaultValue={0} onChange={(arc) => set({ arc })} />
      </Func>
      <button type="button" className="btn btn-primary" onClick={() => void add()}>Añadir texto como capa</button>
    </Section>
  );
}
