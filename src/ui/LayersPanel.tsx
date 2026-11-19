import { useEffect, useRef, useState } from 'react';
import type { Layer } from '../core/contracts';
import { BLEND_MODES } from '../core/defaults';
import { compositor } from '../core/render';
import { selectActiveLayer, useEditor } from '../core/store';
import { Slider } from './controls';
import { pickFiles } from './files';
import { Icon } from './icons';
import { IconButton } from './Tooltip';

function LayerThumb({ layer, mask }: { layer: Layer; mask?: ImageBitmap }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    const src = compositor.source(layer);
    if (!src) return;
    const k = Math.min(c.width / src.w, c.height / src.h);
    const w = src.w * k, h = src.h * k;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src.src, (c.width - w) / 2, (c.height - h) / 2, w, h);
    if (mask) {
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(mask, (c.width - w) / 2, (c.height - h) / 2, w, h);
      ctx.globalCompositeOperation = 'source-over';
    }
  }, [layer.bitmap, layer.text, layer.kind, mask, layer]);
  return <canvas ref={ref} width={64} height={64} className="layer-thumb" aria-hidden="true" />;
}

function LayerRow({ layer, index, count, active }: { layer: Layer; index: number; count: number; active: boolean }) {
  const ed = useEditor.getState();
  const mask = useEditor((s) => s.masks[layer.id]);
  const [renaming, setRenaming] = useState(false);
  const [over, setOver] = useState(false);
  return (
    <li
      className={`layer-row ${active ? 'is-active' : ''} ${!layer.visible ? 'is-hidden' : ''} ${over ? 'is-drop' : ''}`}
      draggable={!renaming}
      onDragStart={(e) => { e.dataTransfer.setData('text/x-layer', layer.id); e.dataTransfer.effectAllowed = 'move'; }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('text/x-layer')) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const id = e.dataTransfer.getData('text/x-layer');
        if (id) { e.preventDefault(); e.stopPropagation(); ed.reorderLayer(id, index); }
      }}
    >
      <IconButton label={layer.visible ? 'Ocultar capa' : 'Mostrar capa'} className="icon-btn-sm" side="left"
        onClick={() => ed.updateLayer(layer.id, { visible: !layer.visible }, { label: layer.visible ? 'Ocultar capa' : 'Mostrar capa' })}>
        <Icon name={layer.visible ? 'eye' : 'eyeOff'} size={15} />
      </IconButton>
      <button type="button" className="layer-main" aria-pressed={active} aria-label={`Capa ${layer.name}, ${count - index} de ${count}`}
        onClick={() => ed.setActive(layer.id)} onDoubleClick={() => setRenaming(true)}>
        <LayerThumb layer={layer} mask={mask} />
        {renaming ? null : (
          <span className="layer-name">
            {layer.kind === 'text' && <Icon name="text" size={12} />} {layer.name}
            {mask && <span className="badge" title="Tiene máscara">máscara</span>}
          </span>
        )}
      </button>
      {renaming && (
        <input className="layer-rename" autoFocus defaultValue={layer.name} aria-label="Nuevo nombre de la capa"
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== layer.name) ed.updateLayer(layer.id, { name: v }, { label: 'Renombrar capa' }); setRenaming(false); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(false); }} />
      )}
      <IconButton label={layer.locked ? 'Desbloquear capa' : 'Bloquear capa'} desc="Una capa bloqueada no se puede mover ni pintar." className={`icon-btn-sm ${layer.locked ? '' : 'dim'}`} side="left"
        onClick={() => ed.updateLayer(layer.id, { locked: !layer.locked }, { label: layer.locked ? 'Desbloquear capa' : 'Bloquear capa' })}>
        <Icon name={layer.locked ? 'lock' : 'unlock'} size={14} />
      </IconButton>
    </li>
  );
}

export function LayersPanel() {
  const doc = useEditor((s) => s.doc);
  const active = useEditor(selectActiveLayer);
  const ed = useEditor.getState();
  if (!doc) return <p className="empty">Abre una imagen para ver sus capas.</p>;
  const idx = active ? doc.layers.findIndex((l) => l.id === active.id) : -1;
  const n = doc.layers.length;
  return (
    <div className="layers-panel">
      <p className="panel-hint">Las capas se apilan: la de arriba tapa a las de abajo. Arrastra para reordenar; doble clic para renombrar.</p>
      <ul className="layer-list" aria-label="Capas">
        {doc.layers.map((l, i) => ({ l, i })).reverse().map(({ l, i }) => (
          <LayerRow key={l.id} layer={l} index={i} count={n} active={l.id === doc.activeLayerId} />
        ))}
      </ul>
      <div className="layer-actions" role="toolbar" aria-label="Acciones de capa">
        <IconButton label="Añadir imagen como capa" onClick={() => pickFiles('layer')} side="top"><Icon name="image" size={16} /></IconButton>
        <IconButton label="Añadir texto" shortcut="T" onClick={() => { ed.addTextLayer(); ed.setTool('text'); }} side="top"><Icon name="text" size={16} /></IconButton>
        <IconButton label="Duplicar capa" shortcut="Ctrl+J" disabled={!active} onClick={() => active && ed.duplicateLayer(active.id)} side="top"><Icon name="duplicate" size={16} /></IconButton>
        <IconButton label="Subir capa" disabled={!active || idx >= n - 1} onClick={() => active && ed.reorderLayer(active.id, idx + 1)} side="top"><Icon name="chevronUp" size={16} /></IconButton>
        <IconButton label="Bajar capa" disabled={!active || idx <= 0} onClick={() => active && ed.reorderLayer(active.id, idx - 1)} side="top"><Icon name="chevronDown" size={16} /></IconButton>
        <IconButton label="Eliminar capa" shortcut="Supr" disabled={!active || n <= 1} onClick={() => active && ed.removeLayer(active.id)} side="top" className="danger"><Icon name="trash" size={16} /></IconButton>
      </div>
      {active && (
        <section className="layer-props" aria-label="Propiedades de la capa">
          <Slider label="Opacidad" value={Math.round(active.opacity * 100)} min={0} max={100} unit="%" defaultValue={100}
            help="Transparencia de la capa: 0 % es invisible, 100 % totalmente opaca."
            onChange={(v) => ed.updateLayer(active.id, { opacity: v / 100 }, { label: 'Opacidad', coalesce: `op:${active.id}` })}
            onReset={() => ed.updateLayer(active.id, { opacity: 1 }, { label: 'Opacidad' })} />
          <label className="field">
            <span>Modo de fusión</span>
            <select value={active.blend} onChange={(e) => ed.updateLayer(active.id, { blend: e.target.value as GlobalCompositeOperation }, { label: 'Modo de fusión' })}>
              {BLEND_MODES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
          </label>
          <p className="panel-hint">El modo de fusión decide cómo se mezcla esta capa con las de debajo (p. ej. «Multiplicar» oscurece, «Trama» aclara).</p>
        </section>
      )}
    </div>
  );
}
