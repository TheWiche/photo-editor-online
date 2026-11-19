import { useEffect, useMemo, useRef, useState } from 'react';
import { Slider } from '../../ui/controls';
import { COLLAGE_SIZES, layoutsFor, renderCollage, type CollageOptions } from '../collage';
import { addCanvasLayer, loadBitmap, thumbOf, toast } from '../util';
import { ColorField, Func, Preview, Row, Section, SelectField } from './kit';

type Img = { id: number; name: string; bmp: ImageBitmap; thumb: ImageBitmap };
let nid = 1;

export function CollageSection() {
  const [imgs, setImgs] = useState<Img[]>([]);
  const [layoutId, setLayoutId] = useState('grid');
  const [sizeId, setSizeId] = useState('1:1');
  const [gap, setGap] = useState(16);
  const [margin, setMargin] = useState(16);
  const [radius, setRadius] = useState(0);
  const [bg, setBg] = useState('#ffffff');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const n = Math.min(9, imgs.length);
  const layouts = useMemo(() => layoutsFor(Math.max(2, n)), [n]);
  const layout = layouts.find((l) => l.id === layoutId) ?? layouts[0];
  const size = COLLAGE_SIZES.find((s) => s.id === sizeId)!;
  const opts: CollageOptions = { w: size.w, h: size.h, gap, margin, radius, background: bg };

  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const room = 9 - imgs.length;
      const next: Img[] = [];
      for (const f of [...files].slice(0, room)) {
        try { const bmp = await loadBitmap(f, 2000); next.push({ id: nid++, name: f.name, bmp, thumb: await createImageBitmap(thumbOf(bmp, 240) as unknown as ImageBitmapSource) }); }
        catch { toast(`No se pudo abrir «${f.name}»`, 'error'); }
      }
      if (files.length > room) toast('El máximo es 9 imágenes.', 'info');
      setImgs((v) => [...v, ...next]);
    } finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  const move = (i: number, d: number) => setImgs((v) => { const a = v.slice(); const j = i + d; if (j < 0 || j >= a.length) return v; [a[i], a[j]] = [a[j], a[i]]; return a; });
  const remove = (i: number) => setImgs((v) => { v[i]?.bmp.close(); return v.filter((_, k) => k !== i); });

  const create = async () => {
    if (imgs.length < 2) { toast('Elige entre 2 y 9 imágenes.', 'error'); return; }
    setBusy(true);
    try {
      await addCanvasLayer(renderCollage(imgs.map((i) => i.bmp), layout, opts), `Collage ${n} fotos`);
      toast('Collage creado como capa', 'success');
    } catch (e) { toast(`No se pudo crear el collage: ${(e as Error).message}`, 'error'); } finally { setBusy(false); }
  };

  return (
    <Section id="collage" icon="layers" title="Collage / cuadrícula" hint="Combina de 2 a 9 fotos en una plantilla de rejilla con separación y fondo.">
      <Func title="1. Elige tus fotos" hint="Puedes seleccionar varias a la vez. Usa ◀ ▶ para cambiar el orden.">
        <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => void pick(e.target.files)} />
        <button type="button" className="btn" disabled={busy || imgs.length >= 9} onClick={() => input.current?.click()}>
          {imgs.length ? `Añadir más (${imgs.length}/9)` : 'Elegir imágenes…'}
        </button>
        {imgs.length > 0 && (
          <div className="cr-thumbs">
            {imgs.map((im, i) => (
              <div key={im.id} className="cr-thumb" title={im.name}>
                <ThumbCanvas bmp={im.thumb} />
                <div className="cr-thumb-bar">
                  <button type="button" onClick={() => move(i, -1)} aria-label="Mover antes">◀</button>
                  <button type="button" onClick={() => remove(i)} aria-label="Quitar">✕</button>
                  <button type="button" onClick={() => move(i, 1)} aria-label="Mover después">▶</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Func>
      <Func title="2. Plantilla y formato" hint="La plantilla depende de cuántas fotos elijas.">
        <div className="cr-chips" role="radiogroup" aria-label="Plantilla">
          {layouts.map((l) => <button key={l.id} type="button" role="radio" aria-checked={layout.id === l.id} className={`cr-chip ${layout.id === l.id ? 'is-on' : ''}`} onClick={() => setLayoutId(l.id)}>{l.name}</button>)}
        </div>
        <SelectField label="Tamaño del collage" value={sizeId} options={COLLAGE_SIZES.map((s) => ({ value: s.id, label: `${s.label} (${s.w}×${s.h})` }))} onChange={setSizeId} />
        <Preview deps={[imgs, layout, sizeId, gap, margin, radius, bg]} height={200}
          render={() => (imgs.length ? renderCollage(imgs.slice(0, 9).map((i) => i.thumb), layout, opts, 260 / Math.max(size.w, size.h)) : null)} />
      </Func>
      <Func title="3. Separación y fondo" hint="El espacio entre fotos deja ver el color de fondo.">
        <Slider label="Separación" value={gap} min={0} max={80} defaultValue={16} unit=" px" onChange={setGap} />
        <Slider label="Margen exterior" value={margin} min={0} max={120} defaultValue={16} unit=" px" onChange={setMargin} />
        <Slider label="Esquinas redondeadas" value={radius} min={0} max={120} unit=" px" onChange={setRadius} />
        <Row><ColorField label="Fondo" value={bg} onChange={setBg} /></Row>
      </Func>
      <button type="button" className="btn btn-primary" disabled={busy || imgs.length < 2} onClick={() => void create()}>Crear collage</button>
    </Section>
  );
}

function ThumbCanvas({ bmp }: { bmp: ImageBitmap }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { const c = ref.current; if (!c) return; c.width = bmp.width; c.height = bmp.height; c.getContext('2d')?.drawImage(bmp, 0, 0); }, [bmp]);
  return <canvas ref={ref} />;
}
