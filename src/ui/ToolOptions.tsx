import { useEffect, useRef, type ReactNode } from 'react';
import type { Layer } from '../core/contracts';
import { FONT_FAMILIES, type CropRatio } from '../core/defaults';
import { layerSize } from '../core/render';
import { selectActiveLayer, selectEffectiveTool, useEditor } from '../core/store';
import { toolInfo } from '../core/tools';
import { NumberField, Segmented } from './controls';
import { Icon } from './icons';
import { IconButton } from './Tooltip';
import { useUI } from './uiStore';

const RATIOS: { value: CropRatio; label: string; title: string }[] = [
  { value: 'free', label: 'Libre', title: 'Proporción libre' },
  { value: 'original', label: 'Original', title: 'Proporción de la imagen' },
  { value: '1:1', label: '1:1', title: 'Cuadrado (perfil, Instagram)' },
  { value: '4:5', label: '4:5', title: 'Vertical (publicación de Instagram)' },
  { value: '16:9', label: '16:9', title: 'Panorámico (vídeo, portada)' },
];

function Range({ label, value, min, max, step = 1, onChange, unit = '' }: {
  label: string; value: number; min: number; max: number; step?: number; onChange(v: number): void; unit?: string;
}) {
  return (
    <label className="opt-range">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        aria-valuetext={`${Math.round(value)}${unit}`} />
      <output>{Math.round(value)}{unit}</output>
    </label>
  );
}

function TextOptions({ layer }: { layer: Layer }) {
  const update = useEditor((s) => s.updateLayer);
  const focus = useUI((s) => s.textFocus);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focus && ref.current) { ref.current.focus(); ref.current.select(); }
  }, [focus]);
  const t = layer.text!;
  const bold = /^(bold|[6-9]00)\s/.test(t.font);
  const family = t.font.replace(/^(bold|[1-9]00)\s+/, '');
  const set = (patch: Partial<typeof t>, key: string) => {
    const text = { ...t, ...patch };
    // Mantiene el centro de la caja de texto al cambiar su tamaño.
    const before = layerSize(layer);
    const after = layerSize({ ...layer, text });
    update(layer.id, {
      text, name: key === 'content' ? (text.content.split('\n')[0].slice(0, 24) || 'Texto') : layer.name,
      x: layer.x + (before.w - after.w) / 2, y: layer.y + (before.h - after.h) / 2,
    }, { label: 'Editar texto', coalesce: `text:${layer.id}:${key}` });
  };
  return (
    <>
      <textarea ref={ref} className="opt-textarea" rows={1} value={t.content} aria-label="Contenido del texto"
        onChange={(e) => set({ content: e.target.value }, 'content')} />
      <select aria-label="Tipografía" value={family} onChange={(e) => set({ font: (bold ? '700 ' : '') + e.target.value }, 'font')}>
        {FONT_FAMILIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        {!FONT_FAMILIES.some((f) => f.value === family) && <option value={family}>{family}</option>}
      </select>
      <NumberField label="Tamaño" value={t.size} min={4} max={1000} onChange={(v) => set({ size: Math.max(4, v) }, 'size')} suffix="px" />
      <button type="button" className={`chip ${bold ? 'is-on' : ''}`} aria-pressed={bold} onClick={() => set({ font: (bold ? '' : '700 ') + family }, 'bold')}>
        <strong>N</strong><span className="sr-only">Negrita</span>
      </button>
      <label className="opt-color" title="Color del texto">
        <span className="sr-only">Color del texto</span>
        <input type="color" value={t.color} onChange={(e) => set({ color: e.target.value }, 'color')} />
      </label>
      <Segmented label="Alineación" value={t.align} onChange={(align) => set({ align }, 'align')} options={[
        { value: 'left', label: '', icon: 'alignLeft', title: 'Izquierda' },
        { value: 'center', label: '', icon: 'alignCenter', title: 'Centro' },
        { value: 'right', label: '', icon: 'alignRight', title: 'Derecha' },
      ]} />
    </>
  );
}

/** Barra contextual con las opciones de la herramienta activa. */
export function ToolOptions() {
  const tool = useEditor(selectEffectiveTool);
  const active = useEditor(selectActiveLayer);
  const hasDoc = useEditor((s) => !!s.doc);
  const brush = useEditor((s) => s.brush);
  const color = useEditor((s) => s.color);
  const cropRatio = useEditor((s) => s.cropRatio);
  const hasMask = useEditor((s) => !!(active && s.masks[active.id]));
  const ed = useEditor.getState();
  const { whatOpen, setWhatOpen } = useUI();
  const info = toolInfo(tool);

  let body: ReactNode = null;
  if (!hasDoc) body = <span className="muted">Abre una imagen para empezar.</span>;
  else switch (tool) {
    case 'move':
      body = active ? (
        <>
          <NumberField label="X" value={active.x} onChange={(x) => ed.updateLayer(active.id, { x }, { coalesce: `x:${active.id}`, label: 'Mover capa' })} />
          <NumberField label="Y" value={active.y} onChange={(y) => ed.updateLayer(active.id, { y }, { coalesce: `y:${active.id}`, label: 'Mover capa' })} />
          <NumberField label="Escala" value={Math.abs(active.scaleX) * 100} suffix="%" min={1} max={2000}
            onChange={(v) => { const k = Math.max(0.01, v / 100); ed.updateLayer(active.id, { scaleX: Math.sign(active.scaleX || 1) * k, scaleY: Math.sign(active.scaleY || 1) * k }, { coalesce: `s:${active.id}`, label: 'Escalar capa' }); }} />
          <button type="button" className="chip" onClick={() => {
            const d = useEditor.getState().doc!; const { w, h } = layerSize(active);
            ed.updateLayer(active.id, { x: (d.width - w) / 2, y: (d.height - h) / 2 }, { label: 'Centrar capa' });
          }}>Centrar</button>
          <button type="button" className="chip" onClick={() => {
            const d = useEditor.getState().doc!; const { w, h } = layerSize(active); const k = Math.min(d.width / w, d.height / h);
            ed.updateLayer(active.id, { x: (d.width - w) / 2, y: (d.height - h) / 2, scaleX: Math.sign(active.scaleX || 1) * k, scaleY: Math.sign(active.scaleY || 1) * k, rotation: 0 }, { label: 'Ajustar capa al lienzo' });
          }}>Ajustar al lienzo</button>
        </>
      ) : <span className="muted">Haz clic sobre una capa para seleccionarla.</span>;
      break;
    case 'crop':
      body = (
        <>
          <Segmented label="Proporción" value={cropRatio} onChange={ed.setCropRatio} options={RATIOS} />
          <button type="button" className="btn btn-primary btn-sm" onClick={ed.applyCrop}><Icon name="check" size={15} />Aplicar</button>
          <button type="button" className="btn btn-sm" onClick={() => ed.setTool('move')}>Cancelar</button>
        </>
      );
      break;
    case 'rotate':
      body = (
        <>
          <span className="opt-label">Imagen</span>
          <IconButton label="Girar 90° a la izquierda" onClick={() => ed.rotateDocument(-90)}><Icon name="rotate" /></IconButton>
          <IconButton label="Girar 90° a la derecha" onClick={() => ed.rotateDocument(90)}><Icon name="rotateCw" /></IconButton>
          <IconButton label="Voltear horizontal" desc="Efecto espejo de izquierda a derecha." onClick={() => ed.flipDocument('h')}><Icon name="flipH" /></IconButton>
          <IconButton label="Voltear vertical" onClick={() => ed.flipDocument('v')}><Icon name="flipV" /></IconButton>
          {active && (
            <>
              <span className="opt-sep" />
              <span className="opt-label">Capa</span>
              <Range label="Ángulo" min={-180} max={180} value={active.rotation} unit="°"
                onChange={(rotation) => ed.updateLayer(active.id, { rotation }, { coalesce: `rot:${active.id}`, label: 'Rotar capa' })} />
              <button type="button" className="chip" onClick={() => ed.updateLayer(active.id, { rotation: 0 }, { label: 'Enderezar capa' })}>0°</button>
              <IconButton label="Voltear capa horizontal" onClick={() => ed.updateLayer(active.id, { scaleX: -active.scaleX }, { label: 'Voltear capa' })}><Icon name="flipH" /></IconButton>
            </>
          )}
        </>
      );
      break;
    case 'text':
      body = active?.kind === 'text' && active.text ? <TextOptions layer={active} />
        : <span className="muted">Haz clic en el lienzo para añadir un texto.</span>;
      break;
    case 'brush': case 'eraser':
      body = (
        <>
          {tool === 'brush' && (
            <Segmented label="Modo del pincel" value={brush.mode} onChange={(mode) => ed.setBrush({ mode })} options={[
              { value: 'color', label: 'Color', title: 'Pinta con el color activo' },
              { value: 'mask', label: 'Restaurar', title: 'Vuelve a mostrar lo ocultado con el borrador' },
            ]} />
          )}
          <Range label="Tamaño" min={1} max={500} value={brush.size} unit="px" onChange={(size) => ed.setBrush({ size })} />
          <Range label="Dureza" min={0} max={100} value={brush.hardness * 100} unit="%" onChange={(v) => ed.setBrush({ hardness: v / 100 })} />
          <Range label={tool === 'eraser' ? 'Fuerza' : 'Opacidad'} min={1} max={100} value={brush.opacity * 100} unit="%" onChange={(v) => ed.setBrush({ opacity: v / 100 })} />
          {tool === 'brush' && brush.mode === 'color' && (
            <label className="opt-color" title="Color del pincel">
              <span className="sr-only">Color del pincel</span>
              <input type="color" value={color} onChange={(e) => ed.setColor(e.target.value)} />
            </label>
          )}
          {hasMask && active && (
            <button type="button" className="chip" onClick={() => ed.setLayerMask(active.id, null, 'Quitar máscara')}>Quitar máscara</button>
          )}
        </>
      );
      break;
    case 'eyedropper':
      body = (
        <>
          <span className="swatch" style={{ background: color }} aria-hidden="true" />
          <code>{color.toUpperCase()}</code>
          <span className="muted">Haz clic en la imagen para tomar un color.</span>
        </>
      );
      break;
    case 'hand':
      body = (
        <>
          <button type="button" className="chip" onClick={() => ed.fitToScreen()}>Ajustar a pantalla</button>
          <button type="button" className="chip" onClick={() => ed.zoomTo(1)}>100 %</button>
          <span className="muted hide-sm">Consejo: mantén Espacio con cualquier herramienta.</span>
        </>
      );
      break;
  }

  return (
    <div className="tool-options" role="region" aria-label={`Opciones de ${info.label}`}>
      <span className="opt-tool"><strong>{info.label}</strong></span>
      <div className="opt-body">{body}</div>
      <button type="button" className={`chip what-toggle ${whatOpen ? 'is-on' : ''}`} aria-pressed={whatOpen}
        onClick={() => setWhatOpen(!whatOpen)} aria-label="Mostrar panel ¿Qué hace?">
        <Icon name="help" size={15} /><span className="hide-sm">¿Qué hace?</span>
      </button>
    </div>
  );
}
