import { useMemo, useState } from 'react';
import { useEditor } from '../../core/store';
import { Slider } from '../../ui/controls';
import { EMOJI_SETS, renderEmoji, renderSvgSticker, SVG_STICKERS, type SvgSticker } from '../stickers';
import { addCanvasLayer, docUnit, needDoc, toast } from '../util';
import { ColorField, Func, Section, TextField } from './kit';

const DEFAULT_COLORS: Record<string, string> = { badge: '#e53950', bubble: '#4f8cff', icon: '#ffb020' };

/** Miniatura SVG inline (mismo markup que se rasteriza al insertar). */
function Thumb({ s, color }: { s: SvgSticker; color: string }) {
  const html = useMemo(() => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${s.name}">${s.svg(color, s.text ?? '')}</svg>`, [s, color]);
  return <span style={{ display: 'block', width: '100%', height: '100%' }} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function StickersSection() {
  const [cat, setCat] = useState<SvgSticker['cat']>('insignias');
  const [color, setColor] = useState('#e53950');
  const [text, setText] = useState('');
  const [size, setSize] = useState(30);
  const [sel, setSel] = useState<SvgSticker | null>(null);

  const place = async (c: ReturnType<typeof renderEmoji> | Awaited<ReturnType<typeof renderSvgSticker>>, name: string) => {
    if (!needDoc()) return;
    const u = docUnit();
    const px = Math.round((u * size) / 100);
    const id = await addCanvasLayer(c, name);
    const st = useEditor.getState();
    const l = st.doc?.layers.find((x) => x.id === id);
    if (l?.bitmap) {
      const s = px / l.bitmap.width, cx = l.x + l.bitmap.width / 2, cy = l.y + l.bitmap.height / 2;
      st.updateLayer(id, { scaleX: s, scaleY: s, x: cx - l.bitmap.width / 2, y: cy - l.bitmap.height / 2 }, { skipHistory: true });
    }
    toast(`«${name}» añadido`, 'success');
  };

  const insertSvg = async (s: SvgSticker) => { setSel(s); await place(await renderSvgSticker(s, color, text), s.name); };
  const list = SVG_STICKERS.filter((s) => s.cat === cat);

  return (
    <Section id="stickers" icon="sparkles" title="Stickers" hint="Emojis, iconos, globos de diálogo e insignias de oferta listos para pegar.">
      <Func title="Tamaño y color" hint="El tamaño es un % del lado menor del documento; el color tiñe iconos, globos e insignias.">
        <Slider label="Tamaño" value={size} min={5} max={100} defaultValue={30} unit=" %" onChange={setSize} />
        <ColorField label="Color del sticker" value={color} onChange={setColor} />
      </Func>
      <Func title="Vectoriales" hint="Dibujados en SVG: nítidos a cualquier tamaño. Algunos aceptan tu propio texto.">
        <div className="cr-chips" role="radiogroup" aria-label="Categoría">
          {(['insignias', 'globos', 'iconos'] as const).map((c) => (
            <button key={c} type="button" role="radio" aria-checked={cat === c} className={`cr-chip ${cat === c ? 'is-on' : ''}`}
              onClick={() => { setCat(c); setColor(c === 'insignias' ? DEFAULT_COLORS.badge : c === 'globos' ? DEFAULT_COLORS.bubble : DEFAULT_COLORS.icon); }}>
              {c === 'insignias' ? 'Insignias' : c === 'globos' ? 'Globos' : 'Iconos'}
            </button>
          ))}
        </div>
        {list.some((s) => s.text) && <TextField label="Texto del sticker (opcional)" value={text} onChange={setText} placeholder={sel?.text ?? '-20%, OFERTA, ¡Hola!…'} />}
        <div className="cr-grid">
          {list.map((s) => (
            <button key={s.id} type="button" className={`cr-tile ${sel?.id === s.id ? 'is-on' : ''}`} title={s.name} aria-label={`Insertar ${s.name}`} onClick={() => void insertSvg(s)}>
              <Thumb s={s} color={color} />
            </button>
          ))}
        </div>
      </Func>
      {EMOJI_SETS.map((set) => (
        <Func key={set.label} title={`Emojis · ${set.label}`} hint={set.label === 'Caras' ? 'Se insertan como imagen; así se ven igual al exportar.' : ''}>
          <div className="cr-grid">
            {set.items.map((e) => (
              <button key={e} type="button" className="cr-tile" aria-label={`Insertar emoji ${e}`} onClick={() => void place(renderEmoji(e), `Emoji ${e}`)}>{e}</button>
            ))}
          </div>
        </Func>
      ))}
    </Section>
  );
}
