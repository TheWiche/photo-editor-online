import { useEffect, useState } from 'react';
import { canCopyImage, copyToClipboard, exportImage, FORMAT_INFO, formatBytes, renderExport, type ExportFormat } from '../core/export';
import { useEditor } from '../core/store';
import { Dialog, Segmented, Slider } from './controls';
import { Icon } from './icons';
import { Kbd } from './Tooltip';
import { SHORTCUTS } from './useShortcuts';
import { useUI } from './uiStore';
import { readPref, writePref } from './storage';

const SCALES = [0.25, 0.5, 1, 2, 3, 4];

export function ExportDialog() {
  const open = useUI((s) => s.dialog === 'export');
  const close = () => useUI.getState().openDialog(null);
  const doc = useEditor((s) => s.doc);
  const fileName = useEditor((s) => s.fileName);
  const toast = useUI((s) => s.toast);
  const [format, setFormat] = useState<ExportFormat>(() => readPref('exportFormat', 'jpeg'));
  const [quality, setQuality] = useState(() => readPref('exportQuality', 90));
  const [scale, setScale] = useState(1);
  const [name, setName] = useState(fileName);
  const [size, setSize] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) setName(fileName); }, [open, fileName]);

  // Estimación del peso del archivo (con retardo para no bloquear mientras se mueve el control).
  useEffect(() => {
    if (!open || !doc) return;
    setSize(null);
    const big = doc.width * doc.height * scale * scale > 24_000_000;
    if (big) return;
    let cancelled = false;
    const t = setTimeout(() => {
      renderExport({ format, quality: quality / 100, scale }).then((b) => { if (!cancelled) setSize(b.size); }).catch(() => {});
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open, doc, format, quality, scale]);

  if (!doc) return null;
  const info = FORMAT_INFO[format];
  const outW = Math.round(doc.width * scale), outH = Math.round(doc.height * scale);

  const download = async () => {
    setBusy(true);
    try {
      writePref('exportFormat', format); writePref('exportQuality', quality);
      const { fileName: f } = await exportImage({ format, quality: quality / 100, scale, fileName: name });
      useEditor.setState({ dirty: false });
      toast(`Descargado: ${f}`, 'success');
      close();
    } catch (e) { toast((e as Error).message, 'error'); }
    finally { setBusy(false); }
  };
  const copy = async () => {
    setBusy(true);
    try { await copyToClipboard(scale); toast('Imagen copiada al portapapeles', 'success'); }
    catch (e) { toast((e as Error).message, 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onClose={close} title="Exportar imagen" footer={(
      <>
        {canCopyImage() && <button type="button" className="btn" onClick={copy} disabled={busy}><Icon name="copy" size={16} /> Copiar</button>}
        <button type="button" className="btn btn-primary" onClick={download} disabled={busy}>
          <Icon name="download" size={16} /> {busy ? 'Procesando…' : 'Descargar'}
        </button>
      </>
    )}>
      <div className="form-grid">
        <label className="field">
          <span>Nombre del archivo</span>
          <span className="field-inline">
            <input value={name} onChange={(e) => setName(e.target.value)} />
            <span className="muted">.{info.ext}</span>
          </span>
        </label>
        <div className="field">
          <span id="fmt-label">Formato</span>
          <Segmented<ExportFormat> label="Formato" value={format} onChange={setFormat}
            options={(Object.keys(FORMAT_INFO) as ExportFormat[]).map((f) => ({ value: f, label: FORMAT_INFO[f].label }))} />
          <p className="panel-hint">{info.hint}</p>
        </div>
        {format !== 'png' && (
          <Slider label="Calidad" value={quality} min={10} max={100} unit="%" defaultValue={90}
            help="Más calidad = archivo más pesado. Entre 80 % y 90 % la diferencia apenas se nota."
            onChange={setQuality} onReset={() => setQuality(90)} />
        )}
        <div className="field">
          <span>Tamaño</span>
          <Segmented label="Escala" value={String(scale)} onChange={(v) => setScale(Number(v))}
            options={SCALES.map((s) => ({ value: String(s), label: `${s * 100}%` }))} />
          <p className="panel-hint">
            {outW} × {outH} px · {size === null ? 'calculando peso…' : `≈ ${formatBytes(size)}`}
            {scale > 1 && ' · Ampliar no añade detalle real (prueba la superresolución con IA).'}
          </p>
        </div>
      </div>
    </Dialog>
  );
}

const PRESETS = [
  { label: 'Publicación cuadrada', w: 1080, h: 1080 },
  { label: 'Publicación vertical 4:5', w: 1080, h: 1350 },
  { label: 'Historia 9:16', w: 1080, h: 1920 },
  { label: 'Full HD 16:9', w: 1920, h: 1080 },
  { label: 'A4 a 150 ppp', w: 1240, h: 1754 },
];

export function NewDocDialog() {
  const open = useUI((s) => s.dialog === 'new');
  const close = () => useUI.getState().openDialog(null);
  const [w, setW] = useState(1080);
  const [h, setH] = useState(1080);
  const [bg, setBg] = useState<'white' | 'black' | 'none'>('white');
  const create = async () => {
    const s = useEditor.getState();
    if (s.dirty && s.doc && !confirm('¿Crear un lienzo nuevo? Se perderán los cambios no exportados.')) return;
    await s.newDocument(w, h, bg === 'white' ? '#ffffff' : bg === 'black' ? '#000000' : null);
    close();
  };
  return (
    <Dialog open={open} onClose={close} title="Nuevo lienzo" footer={(
      <button type="button" className="btn btn-primary" onClick={create}><Icon name="plus" size={16} /> Crear</button>
    )}>
      <div className="form-grid">
        <div className="preset-list" role="group" aria-label="Tamaños habituales">
          {PRESETS.map((p) => (
            <button key={p.label} type="button" className={`chip ${w === p.w && h === p.h ? 'is-on' : ''}`} onClick={() => { setW(p.w); setH(p.h); }}>
              {p.label} <span className="muted">{p.w}×{p.h}</span>
            </button>
          ))}
        </div>
        <div className="field-row">
          <label className="field"><span>Ancho (px)</span><input type="number" min={1} max={8192} value={w} onChange={(e) => setW(Number(e.target.value) || 1)} /></label>
          <label className="field"><span>Alto (px)</span><input type="number" min={1} max={8192} value={h} onChange={(e) => setH(Number(e.target.value) || 1)} /></label>
        </div>
        <div className="field">
          <span>Fondo</span>
          <Segmented<"white" | "black" | "none"> label="Fondo" value={bg} onChange={setBg} options={[
            { value: 'white', label: 'Blanco' }, { value: 'black', label: 'Negro' }, { value: 'none', label: 'Transparente' },
          ]} />
        </div>
      </div>
    </Dialog>
  );
}

export function ShortcutsDialog() {
  const open = useUI((s) => s.dialog === 'shortcuts');
  return (
    <Dialog open={open} onClose={() => useUI.getState().openDialog(null)} title="Atajos de teclado">
      <table className="shortcuts">
        <tbody>
          {SHORTCUTS.map((s) => (
            <tr key={s.keys}><td>{s.keys.includes('/') || s.keys === 'Flechas' || s.keys === 'Espacio' ? <kbd>{s.keys}</kbd> : <Kbd keys={s.keys} />}</td><td>{s.action}</td></tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
