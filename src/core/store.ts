/**
 * Estado global del editor (zustand). Documento, herramienta, vista e historial.
 *
 * Uso desde módulos de IA:
 *   const { doc, activeLayerId } = useEditor.getState();
 *   useEditor.getState().replaceLayerBitmap(id, bitmap, 'Sin fondo');
 *   useEditor.getState().addLayerFromBitmap(bitmap, 'Máscara');
 */
import { create } from 'zustand';
import type { Adjustments, DocumentState, Layer } from './contracts';
import {
  clamp, createLayer, defaultAdjustments, DEFAULT_FONT, ratioValue, uid,
  type BrushSettings, type CropRatio, type Point, type Rect, type ToolId, type ViewState,
} from './defaults';
import { decodeImage, solidBitmap, stripExtension } from './image';
import { layerCenter, layerSize, textBox, type Masks } from './render';

export interface HistoryEntry { doc: DocumentState | null; masks: Masks; label: string }

export const HISTORY_LIMIT = 50;
export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 32;

export interface UpdateOpts {
  /** Etiqueta en el historial (p.ej. «Mover capa»). */
  label?: string;
  /** Cambios seguidos con la misma clave se agrupan en un solo paso de deshacer. */
  coalesce?: string;
  /** No registrar en el historial. */
  skipHistory?: boolean;
}

export interface EditorState {
  doc: DocumentState | null;
  /** Máscaras por capa (alfa = visible). Fuera de Layer para no tocar el contrato. */
  masks: Masks;
  fileName: string;
  dirty: boolean;
  busy: string | null;

  tool: ToolId;
  /** Mano temporal mientras se mantiene Espacio. */
  tempHand: boolean;
  view: ViewState;
  viewport: { w: number; h: number };
  color: string;
  brush: BrushSettings;
  cropRatio: CropRatio;
  cropRect: Rect | null;
  /** Mantener pulsado «Comparar» muestra el original sin ajustes. */
  compare: boolean;

  past: HistoryEntry[];
  future: HistoryEntry[];
  lastKey: string | null;
  lastTime: number;

  // Documento
  openImage(src: File | Blob, opts?: { asLayer?: boolean; name?: string }): Promise<void>;
  newDocument(width: number, height: number, background?: string | null, name?: string): Promise<void>;
  closeDocument(): void;
  addLayer(partial?: Partial<Layer>, opts?: UpdateOpts): string;
  addLayerFromBitmap(bitmap: ImageBitmap, name: string): string;
  addTextLayer(at?: Point, content?: string): string;
  duplicateLayer(id: string): string | null;
  removeLayer(id: string): void;
  reorderLayer(id: string, toIndex: number): void;
  updateLayer(id: string, patch: Partial<Layer>, opts?: UpdateOpts): void;
  setActive(id: string | null): void;
  applyAdjustments(adj: Partial<Adjustments>, opts?: UpdateOpts & { layerId?: string; replace?: boolean }): void;
  resetAdjustments(layerId?: string): void;
  replaceLayerBitmap(layerId: string, bitmap: ImageBitmap, name?: string, label?: string): void;
  setLayerMask(layerId: string, mask: ImageBitmap | null, label?: string): void;
  cropDocument(rect: Rect): void;
  applyCrop(): void;
  rotateDocument(dir: 90 | -90): void;
  flipDocument(axis: 'h' | 'v'): void;
  undo(): void;
  redo(): void;

  // Herramientas y vista
  setTool(tool: ToolId): void;
  setTempHand(on: boolean): void;
  setColor(color: string): void;
  setBrush(patch: Partial<BrushSettings>): void;
  setCropRatio(r: CropRatio): void;
  setCropRect(r: Rect | null): void;
  setCompare(on: boolean): void;
  setViewport(w: number, h: number): void;
  setView(patch: Partial<ViewState>): void;
  /** Zoom manteniendo fijo el punto de pantalla (coordenadas relativas al visor). */
  zoomTo(zoom: number, anchor?: Point): void;
  zoomBy(factor: number, anchor?: Point): void;
  fitToScreen(onlyShrink?: boolean): void;
  setFileName(name: string): void;
  setBusy(msg: string | null): void;
}

/** Rectángulo centrado más grande con la proporción dada. */
export function fitRatioRect(W: number, H: number, ratio: number | null): Rect {
  if (!ratio) return { x: 0, y: 0, w: W, h: H };
  let w = W, h = W / ratio;
  if (h > H) { h = H; w = H * ratio; }
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

const normDeg = (d: number) => { let r = ((d + 180) % 360 + 360) % 360 - 180; if (r === -180) r = 180; return r; };

export const useEditor = create<EditorState>()((set, get) => {
  /** Guarda el estado actual en el historial antes de mutarlo. */
  const record = (label: string, key?: string) => {
    const s = get();
    const now = Date.now();
    if (key && s.lastKey === key && now - s.lastTime < 1500) { set({ lastTime: now }); return; }
    set({
      past: [...s.past, { doc: s.doc, masks: s.masks, label }].slice(-HISTORY_LIMIT),
      future: [], lastKey: key ?? null, lastTime: now, dirty: true,
    });
  };

  const mutate = (label: string, fn: (d: DocumentState) => DocumentState, opts: UpdateOpts = {}) => {
    const d = get().doc;
    if (!d) return;
    if (!opts.skipHistory) record(opts.label ?? label, opts.coalesce);
    set({ doc: fn(d) });
  };

  const mapLayer = (id: string, label: string, fn: (l: Layer) => Layer, opts?: UpdateOpts) =>
    mutate(label, (d) => ({ ...d, layers: d.layers.map((l) => (l.id === id ? fn(l) : l)) }), opts);

  const insertLayer = (layer: Layer, label: string, opts?: UpdateOpts) => {
    const d = get().doc;
    if (!d) return;
    const idx = d.activeLayerId ? d.layers.findIndex((l) => l.id === d.activeLayerId) : d.layers.length - 1;
    mutate(label, (doc) => {
      const layers = doc.layers.slice();
      layers.splice(idx < 0 ? layers.length : idx + 1, 0, layer);
      return { ...doc, layers, activeLayerId: layer.id };
    }, opts);
  };

  const cropRectFor = (tool: ToolId, d: DocumentState | null, ratio: CropRatio) =>
    tool === 'crop' && d ? fitRatioRect(d.width, d.height, ratioValue(ratio, d.width, d.height)) : null;

  return {
    doc: null,
    masks: {},
    fileName: 'sin-titulo',
    dirty: false,
    busy: null,
    tool: 'move',
    tempHand: false,
    view: { zoom: 1, panX: 0, panY: 0 },
    viewport: { w: 800, h: 600 },
    color: '#ffffff',
    brush: { size: 40, hardness: 0.6, opacity: 1, mode: 'color' },
    cropRatio: 'free',
    cropRect: null,
    compare: false,
    past: [],
    future: [],
    lastKey: null,
    lastTime: 0,

    async openImage(src, opts = {}) {
      set({ busy: 'Abriendo imagen…' });
      try {
        const bitmap = await decodeImage(src);
        const raw = opts.name ?? (src instanceof File ? src.name : 'imagen');
        if (opts.asLayer && get().doc) {
          get().addLayerFromBitmap(bitmap, stripExtension(raw));
          return;
        }
        const layer = createLayer({ name: 'Fondo', bitmap });
        const doc: DocumentState = { width: bitmap.width, height: bitmap.height, layers: [layer], activeLayerId: layer.id };
        const tool = get().tool;
        set({
          doc, masks: {}, past: [], future: [], lastKey: null, fileName: stripExtension(raw), dirty: false,
          cropRect: cropRectFor(tool, doc, get().cropRatio),
        });
        get().fitToScreen(true);
      } finally {
        set({ busy: null });
      }
    },

    async newDocument(width, height, background = '#ffffff', name = 'sin-titulo') {
      const w = Math.round(clamp(width, 1, 8192)), h = Math.round(clamp(height, 1, 8192));
      const bitmap = await solidBitmap(w, h, background);
      const layer = createLayer({ name: 'Fondo', bitmap });
      const doc: DocumentState = { width: w, height: h, layers: [layer], activeLayerId: layer.id };
      set({ doc, masks: {}, past: [], future: [], lastKey: null, fileName: name, dirty: false, cropRect: cropRectFor(get().tool, doc, get().cropRatio) });
      get().fitToScreen(true);
    },

    closeDocument() {
      set({ doc: null, masks: {}, past: [], future: [], cropRect: null, dirty: false, fileName: 'sin-titulo' });
    },

    addLayer(partial = {}, opts) {
      const layer = createLayer({ name: `Capa ${(get().doc?.layers.length ?? 0) + 1}`, ...partial, id: partial.id ?? uid() });
      insertLayer(layer, 'Añadir capa', opts);
      return layer.id;
    },

    addLayerFromBitmap(bitmap, name) {
      const d = get().doc;
      if (!d) {
        const layer = createLayer({ name, bitmap });
        set({ doc: { width: bitmap.width, height: bitmap.height, layers: [layer], activeLayerId: layer.id }, masks: {}, past: [], future: [], fileName: name });
        get().fitToScreen(true);
        return layer.id;
      }
      const s = Math.min(1, d.width / bitmap.width, d.height / bitmap.height);
      const layer = createLayer({
        name, bitmap, scaleX: s, scaleY: s,
        x: (d.width - bitmap.width) / 2, y: (d.height - bitmap.height) / 2,
      });
      insertLayer(layer, `Añadir «${name}»`);
      return layer.id;
    },

    addTextLayer(at, content = 'Escribe aquí') {
      const d = get().doc;
      if (!d) return '';
      const size = Math.max(16, Math.round(Math.min(d.width, d.height) / 12));
      const text = { content, font: DEFAULT_FONT, size, color: get().color, align: 'left' as const };
      const box = textBox(text);
      const p = at ?? { x: d.width / 2, y: d.height / 2 };
      const layer = createLayer({ kind: 'text', name: content.slice(0, 24) || 'Texto', text, x: p.x - box.w / 2, y: p.y - box.h / 2 });
      insertLayer(layer, 'Añadir texto');
      return layer.id;
    },

    duplicateLayer(id) {
      const d = get().doc;
      const src = d?.layers.find((l) => l.id === id);
      if (!d || !src) return null;
      const copy: Layer = { ...src, id: uid(), name: `${src.name} copia`, x: src.x + 20, y: src.y + 20, adjustments: { ...src.adjustments }, text: src.text ? { ...src.text } : undefined };
      const idx = d.layers.findIndex((l) => l.id === id);
      record('Duplicar capa');
      const layers = d.layers.slice();
      layers.splice(idx + 1, 0, copy);
      const mask = get().masks[id];
      set({ doc: { ...d, layers, activeLayerId: copy.id }, masks: mask ? { ...get().masks, [copy.id]: mask } : get().masks });
      return copy.id;
    },

    removeLayer(id) {
      const d = get().doc;
      if (!d) return;
      const idx = d.layers.findIndex((l) => l.id === id);
      if (idx < 0) return;
      record('Eliminar capa');
      const layers = d.layers.filter((l) => l.id !== id);
      const active = d.activeLayerId === id ? (layers[Math.min(idx, layers.length - 1)]?.id ?? null) : d.activeLayerId;
      const masks = { ...get().masks };
      delete masks[id];
      set({ doc: { ...d, layers, activeLayerId: active }, masks });
    },

    reorderLayer(id, toIndex) {
      mutate('Reordenar capas', (d) => {
        const from = d.layers.findIndex((l) => l.id === id);
        if (from < 0) return d;
        const to = clamp(Math.round(toIndex), 0, d.layers.length - 1);
        if (to === from) return d;
        const layers = d.layers.slice();
        const [l] = layers.splice(from, 1);
        layers.splice(to, 0, l);
        return { ...d, layers };
      });
    },

    updateLayer(id, patch, opts) {
      mapLayer(id, 'Editar capa', (l) => ({ ...l, ...patch, id: l.id }), opts);
    },

    setActive(id) {
      const d = get().doc;
      if (!d || d.activeLayerId === id) return;
      set({ doc: { ...d, activeLayerId: id } });
    },

    applyAdjustments(adj, opts = {}) {
      const d = get().doc;
      const id = opts.layerId ?? d?.activeLayerId;
      if (!d || !id) return;
      mapLayer(id, 'Ajustes', (l) => ({
        ...l, adjustments: opts.replace ? { ...defaultAdjustments(), ...adj } : { ...l.adjustments, ...adj },
      }), opts);
    },

    resetAdjustments(layerId) {
      const id = layerId ?? get().doc?.activeLayerId;
      if (id) mapLayer(id, 'Restablecer ajustes', (l) => ({ ...l, adjustments: defaultAdjustments() }));
    },

    replaceLayerBitmap(layerId, bitmap, name, label = 'Reemplazar imagen') {
      const d = get().doc;
      const old = d?.layers.find((l) => l.id === layerId);
      if (!d || !old) return;
      const { w: ow, h: oh } = layerSize(old);
      const c = layerCenter(old);
      const sameSize = ow === bitmap.width && oh === bitmap.height;
      record(label);
      const layer: Layer = {
        ...old, kind: 'image', bitmap, text: undefined, name: name ?? old.name,
        // Mantiene la huella en el lienzo aunque cambie la resolución (p.ej. superresolución).
        scaleX: old.scaleX * (ow / bitmap.width), scaleY: old.scaleY * (oh / bitmap.height),
        x: c.x - bitmap.width / 2, y: c.y - bitmap.height / 2,
      };
      let masks = get().masks;
      if (!sameSize && masks[layerId]) { masks = { ...masks }; delete masks[layerId]; }
      set({ doc: { ...d, layers: d.layers.map((l) => (l.id === layerId ? layer : l)) }, masks });
    },

    setLayerMask(layerId, mask, label = 'Máscara') {
      if (!get().doc) return;
      record(label);
      const masks = { ...get().masks };
      if (mask) masks[layerId] = mask; else delete masks[layerId];
      set({ masks });
    },

    cropDocument(rect) {
      const d = get().doc;
      if (!d) return;
      const x = Math.round(clamp(rect.x, 0, d.width - 1)), y = Math.round(clamp(rect.y, 0, d.height - 1));
      const w = Math.round(clamp(rect.w, 1, d.width - x)), h = Math.round(clamp(rect.h, 1, d.height - y));
      mutate('Recortar', (doc) => ({ ...doc, width: w, height: h, layers: doc.layers.map((l) => ({ ...l, x: l.x - x, y: l.y - y })) }));
      const nd = get().doc!;
      set({ cropRect: cropRectFor(get().tool, nd, get().cropRatio) });
      get().fitToScreen();
    },

    applyCrop() {
      const r = get().cropRect;
      if (r) get().cropDocument(r);
    },

    rotateDocument(dir) {
      mutate(dir > 0 ? 'Girar 90° derecha' : 'Girar 90° izquierda', (d) => ({
        ...d, width: d.height, height: d.width,
        layers: d.layers.map((l) => {
          const { w, h } = layerSize(l);
          const c = layerCenter(l);
          const n = dir > 0 ? { x: d.height - c.y, y: c.x } : { x: c.y, y: d.width - c.x };
          return { ...l, x: n.x - w / 2, y: n.y - h / 2, rotation: normDeg(l.rotation + dir) };
        }),
      }));
      set({ cropRect: cropRectFor(get().tool, get().doc, get().cropRatio) });
      get().fitToScreen();
    },

    flipDocument(axis) {
      mutate(axis === 'h' ? 'Voltear horizontal' : 'Voltear vertical', (d) => ({
        ...d,
        layers: d.layers.map((l) => {
          const { w, h } = layerSize(l);
          const c = layerCenter(l);
          return axis === 'h'
            ? { ...l, x: d.width - c.x - w / 2, scaleX: -l.scaleX, rotation: normDeg(-l.rotation) }
            : { ...l, y: d.height - c.y - h / 2, scaleY: -l.scaleY, rotation: normDeg(-l.rotation) };
        }),
      }));
    },

    undo() {
      const s = get();
      const prev = s.past[s.past.length - 1];
      if (!prev) return;
      set({
        past: s.past.slice(0, -1),
        future: [...s.future, { doc: s.doc, masks: s.masks, label: prev.label }],
        doc: prev.doc, masks: prev.masks, lastKey: null, dirty: true,
      });
      set({ cropRect: cropRectFor(get().tool, get().doc, get().cropRatio) });
    },

    redo() {
      const s = get();
      const next = s.future[s.future.length - 1];
      if (!next) return;
      set({
        future: s.future.slice(0, -1),
        past: [...s.past, { doc: s.doc, masks: s.masks, label: next.label }],
        doc: next.doc, masks: next.masks, lastKey: null, dirty: true,
      });
      set({ cropRect: cropRectFor(get().tool, get().doc, get().cropRatio) });
    },

    setTool(tool) {
      set({ tool, cropRect: cropRectFor(tool, get().doc, get().cropRatio) });
    },
    setTempHand(on) { if (get().tempHand !== on) set({ tempHand: on }); },
    setColor(color) { set({ color }); },
    setBrush(patch) { set({ brush: { ...get().brush, ...patch } }); },
    setCropRatio(r) {
      const d = get().doc;
      set({ cropRatio: r, cropRect: d && get().tool === 'crop' ? (r === 'free' ? get().cropRect : fitRatioRect(d.width, d.height, ratioValue(r, d.width, d.height))) : get().cropRect });
    },
    setCropRect(r) { set({ cropRect: r }); },
    setCompare(on) { set({ compare: on }); },
    setViewport(w, h) { set({ viewport: { w, h } }); },
    setView(patch) { set({ view: { ...get().view, ...patch } }); },

    zoomTo(zoom, anchor) {
      const { view, viewport, doc } = get();
      const z = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
      if (!doc) { set({ view: { ...view, zoom: z } }); return; }
      const a = anchor ?? { x: viewport.w / 2, y: viewport.h / 2 };
      // Punto del documento bajo el ancla, relativo al centro del documento.
      const dx = (a.x - viewport.w / 2 - view.panX) / view.zoom;
      const dy = (a.y - viewport.h / 2 - view.panY) / view.zoom;
      set({ view: { zoom: z, panX: a.x - viewport.w / 2 - dx * z, panY: a.y - viewport.h / 2 - dy * z } });
    },
    zoomBy(factor, anchor) { get().zoomTo(get().view.zoom * factor, anchor); },

    fitToScreen(onlyShrink = false) {
      const { doc, viewport } = get();
      if (!doc) return;
      const pad = viewport.w < 600 ? 24 : 64;
      let z = Math.min((viewport.w - pad) / doc.width, (viewport.h - pad) / doc.height);
      if (onlyShrink) z = Math.min(z, 1);
      set({ view: { zoom: clamp(z, MIN_ZOOM, MAX_ZOOM), panX: 0, panY: 0 } });
    },

    setFileName(name) { set({ fileName: name }); },
    setBusy(msg) { set({ busy: msg }); },
  };
});

/* Selectores útiles */
export const selectActiveLayer = (s: EditorState): Layer | null =>
  s.doc?.layers.find((l) => l.id === s.doc?.activeLayerId) ?? null;
export const selectEffectiveTool = (s: EditorState): ToolId => (s.tempHand ? 'hand' : s.tool);
export const getActiveLayer = () => selectActiveLayer(useEditor.getState());
