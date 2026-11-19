import { useState } from 'react';
import { useEditor } from '../../core/store';
import { Slider } from '../../ui/controls';
import { PRESETS, renderSafeGuide, type CanvasPreset } from '../templates';
import { addCanvasLayer, needDoc, toast } from '../util';
import { Check, ColorField, Func, Section } from './kit';

export function TemplatesSection() {
  const [sel, setSel] = useState<CanvasPreset>(PRESETS[0]);
  const [bg, setBg] = useState('#ffffff');
  const [transparent, setTransparent] = useState(false);
  const [guide, setGuide] = useState(true);
  const [pct, setPct] = useState(5);

  const create = async () => {
    const st = useEditor.getState();
    if (st.doc && st.dirty && !window.confirm('Se creará un lienzo nuevo y se cerrará el documento actual. ¿Continuar?')) return;
    await st.newDocument(sel.w, sel.h, transparent ? null : bg, sel.name);
    if (guide) await addCanvasLayer(renderSafeGuide(sel.w, sel.h, sel.safe), 'Guía de zona segura');
    toast(`Lienzo «${sel.name}» ${sel.w}×${sel.h} creado`, 'success');
  };
  const addGuideHere = async () => {
    if (!needDoc()) return;
    const d = useEditor.getState().doc!;
    const m = Math.round((Math.min(d.width, d.height) * pct) / 100);
    await addCanvasLayer(renderSafeGuide(d.width, d.height, [m, m, m, m]), 'Guía de zona segura');
    toast('Guía añadida: ocúltala antes de exportar', 'info');
  };

  const groups = ['Redes', 'Tiendas', 'Impresión'] as const;
  return (
    <Section id="templates" icon="file" title="Plantillas de redes y catálogos" hint="Crea un lienzo con el tamaño exacto de cada plataforma y guías de zona segura.">
      {groups.map((g) => (
        <Func key={g} title={g} hint={g === 'Redes' ? 'Tamaños recomendados por cada red social.' : g === 'Tiendas' ? 'Fotos de producto para marketplaces.' : 'Documentos para imprimir a 300 ppp.'}>
          {PRESETS.filter((p) => p.group === g).map((p) => (
            <button key={p.id} type="button" className={`cr-preset ${sel.id === p.id ? 'is-on' : ''}`} onClick={() => setSel(p)} aria-pressed={sel.id === p.id}>
              <strong>{p.name} · {p.w}×{p.h}</strong>
              <small>{p.note}</small>
            </button>
          ))}
        </Func>
      ))}
      <Func title="Opciones del lienzo" hint="La guía es una capa semitransparente: ocúltala o bórrala antes de exportar.">
        <Check label="Fondo transparente" checked={transparent} onChange={setTransparent} />
        {!transparent && <ColorField label="Color de fondo" value={bg} onChange={setBg} />}
        <Check label="Añadir guía de zona segura" checked={guide} onChange={setGuide} />
      </Func>
      <button type="button" className="btn btn-primary" onClick={() => void create()}>Crear lienzo «{sel.name}»</button>
      <Func title="Guía en el documento actual" hint="Marca un margen seguro (%) en la imagen que ya tienes abierta.">
        <Slider label="Margen seguro" value={pct} min={1} max={25} defaultValue={5} unit=" %" onChange={setPct} />
        <button type="button" className="btn" onClick={() => void addGuideHere()}>Añadir guía de margen</button>
      </Func>
    </Section>
  );
}
