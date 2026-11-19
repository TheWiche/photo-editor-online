import { useEffect, useRef, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from 'react';
import type { Layer } from '../core/contracts';
import { clamp, ratioValue, type Point, type Rect } from '../core/defaults';
import {
  bumpLiveEdit, createCanvas, ctx2d, docToLocal, hitTest, layerCenter, layerCorners, layerSize,
  setLiveEdit, toDoc, toScreen, ViewportRenderer, type AnyCanvas, type Ctx2D, type ViewTransform,
} from '../core/render';
import { selectActiveLayer, selectEffectiveTool, useEditor } from '../core/store';
import { useUI } from './uiStore';

const ACCENT = '#4f8cff';
const HANDLE = 9;

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

type Gesture =
  | { kind: 'pan'; sx: number; sy: number; panX: number; panY: number }
  | { kind: 'move'; id: string; start: Point; lx: number; ly: number; key: string }
  | { kind: 'scale'; id: string; center: Point; dist0: number; sx: number; sy: number; key: string }
  | { kind: 'rotate'; id: string; center: Point; a0: number; rot: number; key: string }
  | { kind: 'crop'; mode: 'move' | 'new' | Handle; start: Point; rect: Rect }
  | { kind: 'stroke'; layerId: string; canvas: AnyCanvas; ctx: Ctx2D; last: Point; radius: number; erase: boolean; color: string; hardness: number; alpha: number; mask: boolean }
  | { kind: 'pinch'; dist: number; mid: Point };

const st = () => useEditor.getState();

function cropHandles(r: Rect): [Handle, Point][] {
  return [
    ['nw', { x: r.x, y: r.y }], ['n', { x: r.x + r.w / 2, y: r.y }], ['ne', { x: r.x + r.w, y: r.y }],
    ['e', { x: r.x + r.w, y: r.y + r.h / 2 }], ['se', { x: r.x + r.w, y: r.y + r.h }],
    ['s', { x: r.x + r.w / 2, y: r.y + r.h }], ['sw', { x: r.x, y: r.y + r.h }], ['w', { x: r.x, y: r.y + r.h / 2 }],
  ];
}

const CURSORS: Record<Handle, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };

/** Calcula el nuevo rectángulo de recorte para un gesto. */
function cropResize(g: Extract<Gesture, { kind: 'crop' }>, p: Point, W: number, H: number, ratio: number | null): Rect {
  const r0 = g.rect;
  if (g.mode === 'move') {
    return { ...r0, x: clamp(r0.x + p.x - g.start.x, 0, W - r0.w), y: clamp(r0.y + p.y - g.start.y, 0, H - r0.h) };
  }
  const q = { x: clamp(p.x, 0, W), y: clamp(p.y, 0, H) };
  let ax: number, ay: number;
  if (g.mode === 'new') { ax = g.start.x; ay = g.start.y; }
  else {
    const m = g.mode;
    if (!ratio && (m === 'n' || m === 's' || m === 'e' || m === 'w')) {
      if (m === 'n') { const y = Math.min(q.y, r0.y + r0.h - 4); return { ...r0, y, h: r0.y + r0.h - y }; }
      if (m === 's') { return { ...r0, h: Math.max(4, q.y - r0.y) }; }
      if (m === 'w') { const x = Math.min(q.x, r0.x + r0.w - 4); return { ...r0, x, w: r0.x + r0.w - x }; }
      return { ...r0, w: Math.max(4, q.x - r0.x) };
    }
    ax = m.includes('w') ? r0.x + r0.w : r0.x;
    ay = m.includes('n') ? r0.y + r0.h : r0.y;
  }
  const dirX = q.x >= ax ? 1 : -1, dirY = q.y >= ay ? 1 : -1;
  let w = Math.abs(q.x - ax), h = Math.abs(q.y - ay);
  const maxW = dirX > 0 ? W - ax : ax, maxH = dirY > 0 ? H - ay : ay;
  if (ratio) {
    if (w / Math.max(h, 1e-6) > ratio) w = h * ratio; else h = w / ratio;
    if (w > maxW) { w = maxW; h = w / ratio; }
    if (h > maxH) { h = maxH; w = h * ratio; }
  }
  w = Math.max(4, Math.min(w, maxW)); h = Math.max(4, Math.min(h, maxH));
  return { x: dirX > 0 ? ax : ax - w, y: dirY > 0 ? ay : ay - h, w, h };
}

function stamp(g: Extract<Gesture, { kind: 'stroke' }>, p: Point) {
  const { ctx, radius: r } = g;
  const grad = ctx.createRadialGradient(p.x, p.y, r * Math.min(0.98, g.hardness), p.x, p.y, r);
  grad.addColorStop(0, g.color);
  grad.addColorStop(1, g.color.replace(/,\s*[\d.]+\)$/, ',0)'));
  ctx.globalCompositeOperation = g.erase ? 'destination-out' : 'source-over';
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
}

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16) || 0;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function CanvasView() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<ViewportRenderer | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const hover = useRef<Point | null>(null);
  const gestureSeq = useRef(0);
  const toast = useUI((s) => s.toast);

  /* ---------- montaje: renderer, tamaño y suscripción al store ---------- */
  useEffect(() => {
    const canvas = canvasRef.current!;
    const r = new ViewportRenderer(canvas);
    renderer.current = r;
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim();
    if (bg) r.background = bg;
    r.overlay = drawOverlay;
    const sync = () => {
      const s = st();
      r.setScene({ doc: s.doc, masks: s.masks, compare: s.compare, view: s.view });
    };
    sync();
    const unsub = useEditor.subscribe(sync);
    let first = true;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      r.setSize(width, height);
      st().setViewport(width, height);
      if (first && st().doc) { st().fitToScreen(true); }
      first = false;
    });
    ro.observe(wrap.current!);
    const onWheel = (e: WheelEvent) => {
      if (!st().doc) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const a = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const dx = e.deltaX * unit, dy = e.deltaY * unit;
      if (e.ctrlKey || e.metaKey) {
        st().zoomBy(Math.exp(-dy * 0.01), a); // pellizco en trackpad o Ctrl+rueda
      } else if (e.shiftKey || Math.abs(dx) > 0.5) {
        const v = st().view;
        st().setView({ panX: v.panX - (e.shiftKey && !dx ? dy : dx), panY: v.panY - (e.shiftKey ? 0 : dy) });
      } else {
        st().zoomBy(Math.exp(-dy * 0.0022), a);
      }
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => { unsub(); ro.disconnect(); canvas.removeEventListener('wheel', onWheel); r.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------ overlay ------------------------------ */
  function drawOverlay(ctx: CanvasRenderingContext2D, t: ViewTransform) {
    const s = st();
    const tool = selectEffectiveTool(s);
    const doc = s.doc!;
    const active = selectActiveLayer(s);
    ctx.save();
    if (active && active.visible && (tool === 'move' || tool === 'rotate' || tool === 'text')) {
      const pts = layerCorners(active).map((p) => toScreen(t, p));
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(active.locked ? [4, 4] : []);
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      if (tool === 'move' && !active.locked) {
        for (const p of pts) {
          ctx.fillStyle = '#fff';
          ctx.fillRect(p.x - HANDLE / 2, p.y - HANDLE / 2, HANDLE, HANDLE);
          ctx.strokeRect(p.x - HANDLE / 2, p.y - HANDLE / 2, HANDLE, HANDLE);
        }
      }
      if (tool === 'rotate') {
        const c = toScreen(t, layerCenter(active));
        ctx.beginPath(); ctx.arc(c.x, c.y, 5, 0, Math.PI * 2); ctx.stroke();
      }
    }
    if (tool === 'crop' && s.cropRect) {
      const r = s.cropRect;
      const a = toScreen(t, { x: r.x, y: r.y });
      const w = r.w * t.zoom, h = r.h * t.zoom;
      const d0 = toScreen(t, { x: 0, y: 0 });
      ctx.fillStyle = 'rgba(8,9,12,0.62)';
      ctx.beginPath();
      ctx.rect(d0.x, d0.y, doc.width * t.zoom, doc.height * t.zoom);
      ctx.rect(a.x, a.y, w, h);
      ctx.fill('evenodd');
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < 3; i++) {
        ctx.moveTo(a.x + (w * i) / 3, a.y); ctx.lineTo(a.x + (w * i) / 3, a.y + h);
        ctx.moveTo(a.x, a.y + (h * i) / 3); ctx.lineTo(a.x + w, a.y + (h * i) / 3);
      }
      ctx.stroke();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(a.x, a.y, w, h);
      const free = !ratioValue(s.cropRatio, doc.width, doc.height);
      for (const [name, p] of cropHandles(r)) {
        if (!free && name.length === 1) continue;
        const q = toScreen(t, p);
        ctx.fillStyle = '#fff';
        ctx.fillRect(q.x - 5, q.y - 5, 10, 10);
      }
      const label = `${Math.round(r.w)} × ${Math.round(r.h)} px`;
      ctx.font = '600 12px Inter, system-ui, sans-serif';
      const tw = ctx.measureText(label).width + 14;
      const ly = a.y + h + 8 + 22 > ctx.canvas.height ? a.y + h - 30 : a.y + h + 8;
      ctx.fillStyle = 'rgba(20,21,26,0.9)';
      ctx.beginPath(); ctx.roundRect(a.x + w / 2 - tw / 2, ly, tw, 22, 6); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, a.x + w / 2, ly + 11);
    }
    if ((tool === 'brush' || tool === 'eraser') && hover.current) {
      const rr = (s.brush.size / 2) * t.zoom;
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.beginPath(); ctx.arc(hover.current.x, hover.current.y, rr + 1, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#fff';
      ctx.setLineDash(tool === 'eraser' ? [4, 3] : []);
      ctx.beginPath(); ctx.arc(hover.current.x, hover.current.y, rr, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  /* ------------------------------ helpers ------------------------------ */
  const local = (e: { clientX: number; clientY: number }): Point => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const tf = () => renderer.current?.transform() ?? null;

  function setCursor(c: string) {
    if (canvasRef.current && canvasRef.current.style.cursor !== c) canvasRef.current.style.cursor = c;
  }

  function hoverCursor(sp: Point) {
    const s = st();
    const tool = selectEffectiveTool(s);
    const t = tf();
    if (!t || !s.doc) { setCursor('default'); return; }
    const p = toDoc(t, sp);
    switch (tool) {
      case 'hand': setCursor(gesture.current?.kind === 'pan' ? 'grabbing' : 'grab'); return;
      case 'brush': case 'eraser': setCursor('none'); return;
      case 'text': setCursor('text'); return;
      case 'eyedropper': setCursor('crosshair'); return;
      case 'rotate': setCursor('grab'); return;
      case 'crop': {
        const r = s.cropRect;
        if (!r) { setCursor('crosshair'); return; }
        const free = !ratioValue(s.cropRatio, s.doc.width, s.doc.height);
        for (const [name, hp] of cropHandles(r)) {
          if (!free && name.length === 1) continue;
          const q = toScreen(t, hp);
          if (Math.hypot(q.x - sp.x, q.y - sp.y) < 12) { setCursor(CURSORS[name]); return; }
        }
        setCursor(p.x > r.x && p.y > r.y && p.x < r.x + r.w && p.y < r.y + r.h ? 'move' : 'crosshair');
        return;
      }
      default: {
        const a = selectActiveLayer(s);
        if (a && !a.locked && layerCorners(a).some((c) => { const q = toScreen(t, c); return Math.hypot(q.x - sp.x, q.y - sp.y) < 10; })) { setCursor('nwse-resize'); return; }
        setCursor(hitTest(s.doc, p) ? 'move' : 'default');
      }
    }
  }

  function beginStroke(p: Point) {
    const s = st();
    const layer = selectActiveLayer(s);
    if (!layer) { toast('Selecciona una capa en el panel Capas'); return; }
    if (layer.kind !== 'image' || !layer.bitmap) { toast('El pincel y el borrador funcionan sobre capas de imagen'); return; }
    if (layer.locked) { toast('La capa está bloqueada: desbloquéala en el panel Capas'); return; }
    if (!layer.visible) { toast('La capa está oculta'); return; }
    const { w, h } = layerSize(layer);
    const canvas = createCanvas(w, h);
    const ctx = ctx2d(canvas);
    const eraser = s.tool === 'eraser';
    const mask = eraser || s.brush.mode === 'mask';
    if (mask) {
      const m = s.masks[layer.id];
      if (m) ctx.drawImage(m, 0, 0, w, h);
      else { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
    }
    const scale = (Math.abs(layer.scaleX) + Math.abs(layer.scaleY)) / 2 || 1;
    const lp = docToLocal(layer, p);
    const g: Extract<Gesture, { kind: 'stroke' }> = {
      kind: 'stroke', layerId: layer.id, canvas, ctx, last: lp,
      radius: Math.max(0.5, s.brush.size / 2 / scale), erase: eraser, mask,
      color: mask ? `rgba(255,255,255,${s.brush.opacity})` : hexToRgba(s.color, 1),
      hardness: s.brush.hardness, alpha: mask ? 1 : s.brush.opacity,
    };
    gesture.current = g;
    setLiveEdit({ layerId: layer.id, kind: mask ? 'mask' : 'paint', canvas, opacity: g.alpha, version: 0 });
    stamp(g, lp);
    bumpLiveEdit();
  }

  function continueStroke(g: Extract<Gesture, { kind: 'stroke' }>, p: Point) {
    const layer = st().doc?.layers.find((l) => l.id === g.layerId);
    if (!layer) return;
    const lp = docToLocal(layer, p);
    const dist = Math.hypot(lp.x - g.last.x, lp.y - g.last.y);
    const step = Math.max(0.5, g.radius * 0.22);
    if (dist < step) return;
    const n = Math.ceil(dist / step);
    for (let i = 1; i <= n; i++) {
      stamp(g, { x: g.last.x + ((lp.x - g.last.x) * i) / n, y: g.last.y + ((lp.y - g.last.y) * i) / n });
    }
    g.last = lp;
    bumpLiveEdit();
  }

  async function endStroke(g: Extract<Gesture, { kind: 'stroke' }>) {
    const s = st();
    const layer = s.doc?.layers.find((l) => l.id === g.layerId);
    if (!layer?.bitmap) { setLiveEdit(null); return; }
    try {
      if (g.mask) {
        const bmp = await createImageBitmap(g.canvas);
        st().setLayerMask(g.layerId, bmp, g.erase ? 'Borrador' : 'Restaurar máscara');
      } else {
        const merged = createCanvas(layer.bitmap.width, layer.bitmap.height);
        const m = ctx2d(merged);
        m.drawImage(layer.bitmap, 0, 0);
        m.globalAlpha = g.alpha;
        m.drawImage(g.canvas, 0, 0);
        const bmp = await createImageBitmap(merged);
        st().replaceLayerBitmap(g.layerId, bmp, undefined, 'Pincel');
      }
    } finally {
      setLiveEdit(null);
    }
  }

  function pickColor(p: Point) {
    const comp = renderer.current?.composite();
    const doc = st().doc;
    if (!comp || !doc) return;
    const x = Math.floor(p.x), y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return;
    const d = ctx2d(comp).getImageData(x, y, 1, 1).data;
    const hex = `#${[d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    st().setColor(hex);
    navigator.clipboard?.writeText(hex).catch(() => {});
    toast(`Color ${hex.toUpperCase()} seleccionado y copiado`, 'success');
  }

  /* --------------------------- eventos puntero --------------------------- */
  function onPointerDown(e: RPointerEvent<HTMLCanvasElement>) {
    const s = st();
    const t = tf();
    if (!s.doc || !t) return;
    if (selectEffectiveTool(s) !== 'text') canvasRef.current!.focus({ preventScroll: true });
    const sp = local(e);
    pointers.current.set(e.pointerId, sp);
    canvasRef.current!.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      const cur = gesture.current;
      if (cur?.kind === 'stroke') setLiveEdit(null);
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      return;
    }
    if (pointers.current.size > 2) return;
    const p = toDoc(t, sp);
    const tool = e.button === 1 ? 'hand' : selectEffectiveTool(s);
    if (e.button === 2) return;
    const key = `g${++gestureSeq.current}`;
    const active = selectActiveLayer(s);
    switch (tool) {
      case 'hand':
        gesture.current = { kind: 'pan', sx: sp.x, sy: sp.y, panX: s.view.panX, panY: s.view.panY };
        setCursor('grabbing');
        break;
      case 'move': {
        if (active && !active.locked && active.visible) {
          const corner = layerCorners(active).find((c) => { const q = toScreen(t, c); return Math.hypot(q.x - sp.x, q.y - sp.y) < 10; });
          if (corner) {
            const c = layerCenter(active);
            gesture.current = { kind: 'scale', id: active.id, center: c, dist0: Math.max(1, Math.hypot(p.x - c.x, p.y - c.y)), sx: active.scaleX, sy: active.scaleY, key };
            break;
          }
        }
        const hit = hitTest(s.doc, p);
        if (hit) {
          s.setActive(hit.id);
          gesture.current = { kind: 'move', id: hit.id, start: p, lx: hit.x, ly: hit.y, key };
        }
        break;
      }
      case 'rotate': {
        if (!active) { toast('Selecciona una capa para rotarla'); break; }
        if (active.locked) { toast('La capa está bloqueada'); break; }
        const c = layerCenter(active);
        gesture.current = { kind: 'rotate', id: active.id, center: c, a0: Math.atan2(p.y - c.y, p.x - c.x), rot: active.rotation, key };
        break;
      }
      case 'text': {
        // Evita que el lienzo robe el foco al campo de texto de la barra de opciones.
        e.preventDefault();
        const hit = hitTest(s.doc, p);
        if (hit?.kind === 'text') { s.setActive(hit.id); }
        else { s.addTextLayer(p); }
        setTimeout(() => useUI.getState().focusText(), 0);
        break;
      }
      case 'brush': case 'eraser':
        beginStroke(p);
        break;
      case 'eyedropper':
        pickColor(p);
        break;
      case 'crop': {
        const r = s.cropRect;
        if (!r) break;
        const free = !ratioValue(s.cropRatio, s.doc.width, s.doc.height);
        let mode: Extract<Gesture, { kind: 'crop' }>['mode'] = 'new';
        for (const [name, hp] of cropHandles(r)) {
          if (!free && name.length === 1) continue;
          const q = toScreen(t, hp);
          if (Math.hypot(q.x - sp.x, q.y - sp.y) < 12) { mode = name; break; }
        }
        if (mode === 'new' && p.x > r.x && p.y > r.y && p.x < r.x + r.w && p.y < r.y + r.h) mode = 'move';
        gesture.current = { kind: 'crop', mode, start: p, rect: r };
        break;
      }
    }
  }

  function onPointerMove(e: RPointerEvent<HTMLCanvasElement>) {
    const sp = local(e);
    const s = st();
    const t = tf();
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, sp);
    hover.current = e.pointerType === 'touch' ? null : sp;
    const g = gesture.current;
    if (!g || !t || !s.doc) {
      hoverCursor(sp);
      renderer.current?.request();
      return;
    }
    const p = toDoc(t, sp);
    switch (g.kind) {
      case 'pinch': {
        const pts = [...pointers.current.values()];
        if (pts.length < 2) break;
        const [a, b] = pts;
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        s.zoomBy(dist / Math.max(1, g.dist), mid);
        const v = st().view;
        s.setView({ panX: v.panX + mid.x - g.mid.x, panY: v.panY + mid.y - g.mid.y });
        g.dist = dist; g.mid = mid;
        break;
      }
      case 'pan':
        s.setView({ panX: g.panX + sp.x - g.sx, panY: g.panY + sp.y - g.sy });
        break;
      case 'move':
        s.updateLayer(g.id, { x: Math.round(g.lx + p.x - g.start.x), y: Math.round(g.ly + p.y - g.start.y) }, { label: 'Mover capa', coalesce: g.key });
        break;
      case 'scale': {
        const f = Math.max(0.01, Math.hypot(p.x - g.center.x, p.y - g.center.y) / g.dist0);
        s.updateLayer(g.id, { scaleX: g.sx * f, scaleY: g.sy * f }, { label: 'Escalar capa', coalesce: g.key });
        break;
      }
      case 'rotate': {
        let deg = g.rot + ((Math.atan2(p.y - g.center.y, p.x - g.center.x) - g.a0) * 180) / Math.PI;
        if (e.shiftKey) deg = Math.round(deg / 15) * 15;
        deg = ((deg + 180) % 360 + 360) % 360 - 180;
        s.updateLayer(g.id, { rotation: Math.round(deg * 10) / 10 }, { label: 'Rotar capa', coalesce: g.key });
        break;
      }
      case 'crop':
        s.setCropRect(cropResize(g, p, s.doc.width, s.doc.height, ratioValue(s.cropRatio, s.doc.width, s.doc.height)));
        break;
      case 'stroke':
        continueStroke(g, p);
        break;
    }
    renderer.current?.request();
  }

  function onPointerUp(e: RPointerEvent<HTMLCanvasElement>) {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g?.kind === 'pinch') {
      if (pointers.current.size === 0) gesture.current = null;
      return;
    }
    gesture.current = null;
    if (g?.kind === 'stroke') {
      if (e.type === 'pointercancel') setLiveEdit(null); else void endStroke(g);
    }
    if (g?.kind === 'crop') {
      const r = st().cropRect;
      if (r && (r.w < 4 || r.h < 4)) st().setCropRect(g.rect);
    }
    hoverCursor(local(e));
  }

  function onDoubleClick(e: RMouseEvent<HTMLCanvasElement>) {
    const s = st();
    const t = tf();
    if (!s.doc || !t) return;
    const tool = selectEffectiveTool(s);
    if (tool === 'hand') { s.fitToScreen(); return; }
    if (tool === 'crop') { s.applyCrop(); return; }
    if (tool === 'move') {
      const hit: Layer | null = hitTest(s.doc, toDoc(t, local(e)));
      if (hit?.kind === 'text') { s.setTool('text'); useUI.getState().focusText(); }
    }
  }

  return (
    <div ref={wrap} className="canvas-wrap" data-tour="canvas">
      <canvas
        ref={canvasRef}
        className="viewport"
        tabIndex={0}
        role="application"
        aria-roledescription="lienzo"
        aria-label="Lienzo de edición. Usa las herramientas de la izquierda; rueda para zoom, Espacio + arrastrar para desplazarte."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => { hover.current = null; renderer.current?.request(); }}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}
