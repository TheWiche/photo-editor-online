import { useRef } from 'react';
import { Segmented, Slider } from '../../ui/controls';
import { WM_POSITIONS, type WatermarkOptions } from '../watermark';
import { loadBitmap } from '../util';
import { Check, ColorField, Row, TextField } from './kit';

/** Controles de marca de agua reutilizados en la pestaña y en el diálogo de lotes. */
export function WatermarkControls({ o, set }: { o: WatermarkOptions; set(p: Partial<WatermarkOptions>): void }) {
  const file = useRef<HTMLInputElement>(null);
  return (
    <>
      <Segmented<WatermarkOptions['kind']> label="Tipo de marca" value={o.kind} onChange={(kind) => set({ kind })}
        options={[{ value: 'text', label: 'Texto' }, { value: 'logo', label: 'Logo' }]} />
      {o.kind === 'text' ? (
        <>
          <TextField label="Texto" value={o.text} onChange={(text) => set({ text })} />
          <Row><ColorField label="Color" value={o.color} onChange={(color) => set({ color })} /><Check label="Negrita" checked={o.bold} onChange={(bold) => set({ bold })} /></Row>
        </>
      ) : (
        <>
          <input ref={file} type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) set({ logo: await loadBitmap(f, 1200) }); e.target.value = ''; }} />
          <button type="button" className="btn" onClick={() => file.current?.click()}>{o.logo ? 'Cambiar logo…' : 'Elegir logo (PNG con transparencia)…'}</button>
        </>
      )}
      <Check label="Repetir en mosaico" checked={o.tile} onChange={(tile) => set({ tile })} />
      {!o.tile && (
        <div className="field">
          <span>Posición</span>
          <div className="cr-pos" role="radiogroup" aria-label="Posición">
            {WM_POSITIONS.map((p) => (
              <button key={p.v} type="button" role="radio" aria-checked={o.position === p.v} className={o.position === p.v ? 'is-on' : ''} onClick={() => set({ position: p.v })}>{p.label}</button>
            ))}
          </div>
        </div>
      )}
      <Slider label="Tamaño" value={o.size} min={5} max={90} defaultValue={22} unit=" %" onChange={(size) => set({ size })} />
      <Slider label="Opacidad" value={o.opacity} min={0.05} max={1} step={0.05} defaultValue={0.6} onChange={(opacity) => set({ opacity })} />
      <Slider label="Ángulo" value={o.angle} min={-90} max={90} defaultValue={0} unit="°" onChange={(angle) => set({ angle })} />
      {!o.tile && <Slider label="Margen" value={o.margin} min={0} max={20} defaultValue={3} unit=" %" onChange={(margin) => set({ margin })} />}
      {o.tile && <Slider label="Separación" value={o.gap} min={0} max={300} defaultValue={60} unit=" %" onChange={(gap) => set({ gap })} />}
    </>
  );
}
