import { useState } from 'react';
import { useEditor } from '../../core/store';
import { Slider } from '../../ui/controls';
import { DEFAULT_SHAPE, renderShape, SHAPES, type ShapeKind, type ShapeOptions } from '../shapes';
import { addCanvasLayer, docUnit, needDoc, toast } from '../util';
import { Check, ColorField, Func, Preview, Row, Section } from './kit';

export function ShapesSection() {
  const [o, setO] = useState<ShapeOptions>(DEFAULT_SHAPE);
  const [opacity, setOpacity] = useState(1);
  const set = (p: Partial<ShapeOptions>) => setO((v) => ({ ...v, ...p }));
  const info = SHAPES.find((s) => s.kind === o.kind)!;
  const lineLike = o.kind === 'line' || o.kind === 'arrow';

  const pick = (kind: ShapeKind) => {
    const u = docUnit();
    const square = kind === 'ellipse' || kind === 'star' || kind === 'heart' || kind === 'polygon';
    set({ kind, w: Math.round(u * 0.4), h: Math.round(u * (square ? 0.4 : kind === 'line' || kind === 'arrow' ? 0.12 : 0.3)) });
  };

  const add = async () => {
    if (!needDoc()) return;
    const id = await addCanvasLayer(renderShape(o), info.label, { opacity });
    useEditor.getState().setActive(id);
    toast(`${info.label} añadido como capa`, 'success');
  };

  return (
    <Section id="shapes" icon="plus" title="Formas y flechas" hint="Rectángulos, elipses, flechas, estrellas y más, como capas editables.">
      <div className="cr-chips" role="radiogroup" aria-label="Tipo de forma">
        {SHAPES.map((s) => (
          <button key={s.kind} type="button" role="radio" aria-checked={o.kind === s.kind} className={`cr-chip ${o.kind === s.kind ? 'is-on' : ''}`} onClick={() => pick(s.kind)}>{s.label}</button>
        ))}
      </div>
      <p className="cr-hint">{info.hint}</p>
      <Preview render={() => { const k = 170 / Math.max(o.w, o.h); return renderShape(o, Math.min(1, k)); }} deps={[o]} height={150} />
      <Func title="Tamaño" hint="Ancho y alto en píxeles del documento.">
        <Slider label="Ancho" value={o.w} min={20} max={4000} step={10} defaultValue={400} unit=" px" onChange={(w) => set({ w })} />
        {!lineLike && <Slider label="Alto" value={o.h} min={20} max={4000} step={10} defaultValue={300} unit=" px" onChange={(h) => set({ h })} />}
        {lineLike && <Slider label="Tamaño de la punta" value={o.h} min={20} max={600} step={10} defaultValue={120} unit=" px" onChange={(h) => set({ h })} />}
      </Func>
      <Func title="Relleno y trazo" hint="El relleno colorea el interior; el trazo es el contorno.">
        <Row>
          {o.kind !== 'line' && <Check label={lineLike ? 'Usar color de relleno' : 'Con relleno'} checked={o.useFill} onChange={(useFill) => set({ useFill })} />}
          {o.useFill && o.kind !== 'line' && <ColorField label="Relleno" value={o.fill} onChange={(fill) => set({ fill })} />}
        </Row>
        <Row><ColorField label="Trazo" value={o.stroke} onChange={(stroke) => set({ stroke })} /><Check label="Línea discontinua" checked={o.dash} onChange={(dash) => set({ dash })} /></Row>
        <Slider label="Grosor del trazo" value={o.strokeWidth} min={0} max={60} defaultValue={6} unit=" px" onChange={(strokeWidth) => set({ strokeWidth })} />
        {o.kind === 'rect' && <Slider label="Esquinas redondeadas" value={o.radius} min={0} max={300} unit=" px" onChange={(radius) => set({ radius })} />}
        {o.kind === 'polygon' && <Slider label="Lados" value={o.sides} min={3} max={12} defaultValue={6} onChange={(sides) => set({ sides })} />}
        {o.kind === 'star' && <Slider label="Puntas" value={o.points} min={3} max={12} defaultValue={5} onChange={(points) => set({ points })} />}
        <Slider label="Opacidad" value={opacity} min={0.05} max={1} step={0.05} defaultValue={1} onChange={setOpacity} />
      </Func>
      <button type="button" className="btn btn-primary" onClick={() => void add()}>Añadir {info.label.toLowerCase()}</button>
    </Section>
  );
}
