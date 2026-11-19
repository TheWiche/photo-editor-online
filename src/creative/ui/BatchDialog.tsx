import { useRef, useState } from 'react';
import { Dialog, Slider } from '../../ui/controls';
import { hasFolderPicker, runBatch, type BatchResult, type OutFormat, type Recipe, type ResizeMode } from '../batch';
import { DEFAULT_WM, type WatermarkOptions } from '../watermark';
import { formatBytes } from '../../core/export';
import { useCreative } from '../store';
import { toast } from '../util';
import { Check, SelectField, Func } from './kit';
import { WatermarkControls } from './WatermarkControls';

const DEFAULT_RECIPE: Recipe = {
  resizeMode: 'maxside', resizeValue: 1600, format: 'jpeg', quality: 0.85,
  brightness: 0, contrast: 0, saturation: 0, watermark: false, wm: { ...DEFAULT_WM, tile: false },
  stripMetadata: true, suffix: '-editada',
};

export function BatchDialog() {
  const open = useCreative((s) => s.batchOpen);
  const setOpen = useCreative((s) => s.setBatchOpen);
  const [files, setFiles] = useState<File[]>([]);
  const [r, setR] = useState<Recipe>(DEFAULT_RECIPE);
  const [zipOnly, setZipOnly] = useState(false);
  const [prog, setProg] = useState<{ done: number; total: number; current: string } | null>(null);
  const [res, setRes] = useState<BatchResult | null>(null);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const running = prog !== null;
  const set = (p: Partial<Recipe>) => setR((v) => ({ ...v, ...p }));
  const setWm = (p: Partial<WatermarkOptions>) => setR((v) => ({ ...v, wm: { ...v.wm, ...p } }));
  const canFolder = hasFolderPicker() && !zipOnly;

  const close = () => { if (running) abort.current?.abort(); setOpen(false); };

  const start = async () => {
    if (!files.length) { toast('Elige al menos una imagen.', 'error'); return; }
    let dir: FileSystemDirectoryHandle | null = null;
    if (canFolder) {
      try { dir = await (window as unknown as { showDirectoryPicker(o?: object): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ mode: 'readwrite' }); }
      catch { return; } // el usuario canceló
    }
    abort.current = new AbortController();
    setRes(null); setProg({ done: 0, total: files.length, current: '' });
    try {
      const out = await runBatch(files, r, dir, (done, total, current) => setProg({ done, total, current }), abort.current.signal);
      setRes(out);
      toast(out.cancelled ? `Lote cancelado (${out.ok} listas)` : `Lote terminado: ${out.ok} imágenes`, out.failed.length ? 'info' : 'success');
    } catch (e) { toast(`El lote falló: ${(e as Error).message}`, 'error'); }
    finally { setProg(null); }
  };

  const pct = prog ? Math.round((prog.done / Math.max(1, prog.total)) * 100) : 0;
  const unit = r.resizeMode === 'percent' ? '%' : 'px';

  return (
    <Dialog open={open} onClose={close} wide title="Procesamiento por lotes"
      footer={<>
        {running
          ? <button type="button" className="btn" onClick={() => abort.current?.abort()}>Cancelar</button>
          : <button type="button" className="btn" onClick={close}>Cerrar</button>}
        <button type="button" className="btn btn-primary" disabled={running || !files.length} onClick={() => void start()}>
          {canFolder ? 'Procesar y guardar en carpeta…' : 'Procesar y descargar .zip'}
        </button>
      </>}>
      <div className="cr-batch">
        <div className="cr-col">
          <Func title="1. Imágenes" hint="Elige todas las fotos que quieras. Se procesan una a una sin bloquear la página.">
            <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { setFiles([...(e.target.files ?? [])]); setRes(null); }} />
            <button type="button" className="btn" disabled={running} onClick={() => input.current?.click()}>{files.length ? `${files.length} imágenes · cambiar…` : 'Elegir imágenes…'}</button>
            {files.length > 0 && <ul className="cr-filelist" aria-label="Archivos elegidos">{files.map((f, i) => <li key={i}>{f.name} · {formatBytes(f.size)}</li>)}</ul>}
          </Func>
          <Func title="2. Tamaño" hint="Reduce las fotos para web o mensajería (nunca amplía, salvo por porcentaje).">
            <SelectField<ResizeMode> label="Redimensionar" value={r.resizeMode} onChange={(resizeMode) => set({ resizeMode, resizeValue: resizeMode === 'percent' ? 50 : 1600 })}
              options={[{ value: 'none', label: 'No cambiar' }, { value: 'maxside', label: 'Lado mayor máximo' }, { value: 'width', label: 'Ancho máximo' }, { value: 'height', label: 'Alto máximo' }, { value: 'percent', label: 'Porcentaje' }]} />
            {r.resizeMode !== 'none' && <label className="field"><span>Valor ({unit})</span>
              <input type="number" min={1} max={r.resizeMode === 'percent' ? 400 : 8192} value={r.resizeValue} onChange={(e) => set({ resizeValue: Number(e.target.value) || 1 })} /></label>}
          </Func>
          <Func title="3. Formato y calidad" hint="WebP y JPG pesan menos; PNG conserva transparencia.">
            <SelectField<OutFormat> label="Formato de salida" value={r.format} onChange={(format) => set({ format })}
              options={[{ value: 'keep', label: 'Mantener el original' }, { value: 'jpeg', label: 'JPG' }, { value: 'webp', label: 'WebP' }, { value: 'png', label: 'PNG' }]} />
            {r.format !== 'png' && <Slider label="Calidad" value={Math.round(r.quality * 100)} min={30} max={100} defaultValue={85} unit=" %" onChange={(v) => set({ quality: v / 100 })} />}
            <label className="field"><span>Sufijo del nombre</span><input type="text" value={r.suffix} onChange={(e) => set({ suffix: e.target.value.replace(/[\\/:*?"<>|]/g, '') })} /></label>
            <Check label="Quitar metadatos (EXIF, ubicación GPS)" checked={r.stripMetadata} onChange={(stripMetadata) => set({ stripMetadata })} />
          </Func>
        </div>
        <div className="cr-col">
          <Func title="4. Ajustes básicos" hint="Se aplican igual a todas las fotos.">
            <Slider label="Brillo" value={r.brightness} min={-100} max={100} onChange={(brightness) => set({ brightness })} />
            <Slider label="Contraste" value={r.contrast} min={-100} max={100} onChange={(contrast) => set({ contrast })} />
            <Slider label="Saturación" value={r.saturation} min={-100} max={100} onChange={(saturation) => set({ saturation })} />
          </Func>
          <Func title="5. Marca de agua" hint="Estampa tu nombre o logo en cada imagen.">
            <Check label="Añadir marca de agua" checked={r.watermark} onChange={(watermark) => set({ watermark })} />
            {r.watermark && <WatermarkControls o={r.wm} set={setWm} />}
          </Func>
          <Func title="Salida" hint={canFolder ? 'Tu navegador permite guardar directamente en una carpeta que elijas.' : 'Se descargará un único archivo .zip con todas las imágenes.'}>
            {hasFolderPicker() && <Check label="Descargar como .zip en lugar de carpeta" checked={zipOnly} onChange={setZipOnly} />}
          </Func>
          {prog && (
            <div role="status" aria-live="polite">
              <div className="cr-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div>
              <p className="cr-hint">{prog.done} de {prog.total} · {prog.current}</p>
            </div>
          )}
          {res && (
            <p className="cr-note" role="status">
              {res.cancelled ? 'Cancelado. ' : ''}{res.ok} imágenes guardadas ({formatBytes(res.bytes)}) {res.mode === 'zip' ? 'en un .zip descargado.' : 'en la carpeta elegida.'}
              {res.failed.length > 0 && <span className="cr-err"> {res.failed.length} con error: {res.failed.map((f) => `${f.name} (${f.error})`).join('; ')}</span>}
            </p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
