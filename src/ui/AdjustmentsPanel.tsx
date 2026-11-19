import { useEffect, useMemo, useRef, useState } from 'react';
import type { Adjustments, Layer } from '../core/contracts';
import { DEFAULT_ADJUSTMENTS, isDefaultAdjustments } from '../core/defaults';
import { compositor, createCanvas, ctx2d, renderAdjusted, type AnyCanvas } from '../core/render';
import { selectActiveLayer, useEditor } from '../core/store';
import { ADJUSTMENT_GROUPS, FILTER_PRESETS, scalePreset, type FilterPreset } from '../core/tools';
import { Slider } from './controls';
import { Icon } from './icons';

function NoLayer() {
  return <p className="empty">Selecciona una capa de imagen o texto para ajustarla.</p>;
}

function CompareButton() {
  const setCompare = useEditor((s) => s.setCompare);
  return (
    <button type="button" className="btn btn-sm"
      onPointerDown={() => setCompare(true)} onPointerUp={() => setCompare(false)} onPointerLeave={() => setCompare(false)}
      onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') setCompare(true); }} onKeyUp={() => setCompare(false)}
      title="Mantén pulsado para ver el original">
      <Icon name="compare" size={15} /> Comparar
    </button>
  );
}

export function AdjustmentsPanel() {
  const layer = useEditor(selectActiveLayer);
  const ed = useEditor.getState();
  if (!layer) return <NoLayer />;
  const a = layer.adjustments;
  const set = (key: keyof Adjustments, v: number | boolean) =>
    ed.applyAdjustments({ [key]: v }, { layerId: layer.id, label: 'Ajuste', coalesce: `adj:${layer.id}:${key}` });
  return (
    <div className="adjust-panel">
      <div className="panel-row">
        <p className="panel-hint">Ajustes no destructivos de «{layer.name}»: puedes cambiarlos o quitarlos cuando quieras.</p>
      </div>
      <div className="panel-row gap">
        <CompareButton />
        <button type="button" className="btn btn-sm" disabled={isDefaultAdjustments(a)} onClick={() => ed.resetAdjustments(layer.id)}>
          <Icon name="reset" size={15} /> Restablecer
        </button>
      </div>
      {ADJUSTMENT_GROUPS.map((g) => (
        <fieldset key={g.title} className="adj-group">
          <legend>{g.title}</legend>
          {g.items.map((it) => (
            <Slider key={it.key} label={it.label} value={a[it.key]} min={it.min} max={it.max} help={it.help}
              defaultValue={DEFAULT_ADJUSTMENTS[it.key]}
              onChange={(v) => set(it.key, v)} onReset={() => set(it.key, DEFAULT_ADJUSTMENTS[it.key])} />
          ))}
          {g.title === 'Color' && (
            <label className="switch">
              <input type="checkbox" checked={a.grayscale} onChange={(e) => set('grayscale', e.target.checked)} />
              <span className="switch-track" aria-hidden="true" />
              <span>Blanco y negro</span>
            </label>
          )}
        </fieldset>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ Filtros */

const THUMB = 132;

function smallSource(layer: Layer): AnyCanvas | null {
  const src = compositor.source(layer);
  if (!src) return null;
  const k = Math.min(1, THUMB / Math.max(src.w, src.h));
  const c = createCanvas(src.w * k, src.h * k);
  const ctx = ctx2d(c);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src.src, 0, 0, c.width, c.height);
  return c;
}

function PresetThumb({ src, preset }: { src: AnyCanvas | null; preset: FilterPreset }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !src) return;
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      if (cancelled) return;
      const out = renderAdjusted(src, src.width, src.height, { ...DEFAULT_ADJUSTMENTS, ...preset.adjustments });
      const ctx = c.getContext('2d')!;
      c.width = src.width; c.height = src.height;
      ctx.drawImage(out, 0, 0);
    });
    return () => { cancelled = true; cancelAnimationFrame(id); };
  }, [src, preset]);
  return <canvas ref={ref} className="preset-thumb" aria-hidden="true" />;
}

function matches(a: Adjustments, p: FilterPreset, k: number): boolean {
  const target = { ...DEFAULT_ADJUSTMENTS, ...scalePreset(p, k) };
  return (Object.keys(target) as (keyof Adjustments)[]).every((key) => target[key] === a[key]);
}

export function FiltersPanel() {
  const layer = useEditor(selectActiveLayer);
  const ed = useEditor.getState();
  const [intensity, setIntensity] = useState(100);
  const srcKey = layer ? (layer.bitmap ?? JSON.stringify(layer.text)) : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const src = useMemo(() => (layer ? smallSource(layer) : null), [srcKey]);
  if (!layer) return <NoLayer />;
  const current = FILTER_PRESETS.find((p) => p.id !== 'none' && matches(layer.adjustments, p, intensity / 100))
    ?? (isDefaultAdjustments(layer.adjustments) ? FILTER_PRESETS[0] : null);

  const apply = (p: FilterPreset, k = intensity / 100) =>
    ed.applyAdjustments(scalePreset(p, k), { layerId: layer.id, replace: true, label: `Filtro ${p.name}`, coalesce: `filter:${layer.id}:${p.id}` });

  return (
    <div className="filters-panel">
      <p className="panel-hint">Un filtro es una combinación de ajustes. Elige uno y afínalo después en «Ajustes».</p>
      <div className="preset-grid" role="radiogroup" aria-label="Filtros">
        {FILTER_PRESETS.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={current?.id === p.id}
            className={`preset ${current?.id === p.id ? 'is-on' : ''}`} onClick={() => apply(p)} title={p.description}>
            <PresetThumb src={src} preset={p} />
            <span>{p.name}</span>
          </button>
        ))}
      </div>
      {current && current.id !== 'none' && (
        <Slider label={`Intensidad de ${current.name}`} value={intensity} min={0} max={100} unit="%" defaultValue={100}
          help="Mezcla el filtro con la foto original. 100 % es el filtro completo."
          onChange={(v) => { setIntensity(v); apply(current, v / 100); }}
          onReset={() => { setIntensity(100); apply(current, 1); }} />
      )}
      <div className="panel-row gap"><CompareButton /></div>
    </div>
  );
}
