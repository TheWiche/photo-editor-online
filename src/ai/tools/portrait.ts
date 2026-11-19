/**
 * MODO RETRATO (bokeh) y EFECTO 3D (parallax) a partir de un mapa de profundidad
 * (Depth Anything: claro = cerca). Funciones puras sobre ImageData + un pipeline que funciona
 * igual en el hilo principal y en un Web Worker (OffscreenCanvas). Ver fx.worker.ts y
 * `applyBokeh()` (la que usa la UI).
 */
import { createCanvas, ctx2d } from '../imageUtils';
import { CancelledError } from '../types';

export type BokehShape = 'circulo' | 'hexagono' | 'estrella' | 'corazon';

export interface BokehParams {
  /** Punto de enfoque normalizado (0..1) sobre la imagen. */
  focusX: number;
  focusY: number;
  /** 0..100: tamaño máximo del desenfoque. */
  intensity: number;
  /** 0..100: profundidad de campo (cuánta zona queda nítida alrededor del foco). */
  dof: number;
  shape: BokehShape;
  /** 0..100: realce de los puntos de luz (círculos de bokeh). */
  highlights: number;
  /** Desenfocar también lo que está MÁS CERCA que el foco. */
  foreground: boolean;
}

export const DEFAULT_BOKEH: BokehParams = {
  focusX: 0.5,
  focusY: 0.45,
  intensity: 55,
  dof: 18,
  shape: 'circulo',
  highlights: 35,
  foreground: true,
};

/** Radio máximo como fracción del lado largo de la imagen (intensidad 100). */
const MAX_RADIUS_FRAC = 0.045;

// ------------------------------------------------------------------ formas

function insideShape(shape: BokehShape, x: number, y: number): boolean {
  switch (shape) {
    case 'circulo':
      return x * x + y * y <= 1;
    case 'hexagono': {
      const ax = Math.abs(x), ay = Math.abs(y);
      return ay <= 0.866 && 0.866 * ax + 0.5 * ay <= 0.866;
    }
    case 'estrella': {
      const r = Math.hypot(x, y);
      if (r === 0) return true;
      const a = Math.atan2(y, x) + Math.PI / 2;
      const k = 5;
      const t = (((a * k) / (2 * Math.PI)) % 1 + 1) % 1; // 0..1 dentro de cada punta
      const tri = Math.abs(t - 0.5) * 2; // 1 en la punta, 0 en el valle
      return r <= 0.45 + 0.55 * tri;
    }
    case 'corazon': {
      const X = x * 1.15, Y = -y * 1.15 + 0.15;
      const v = X * X + Y * Y - 1;
      return v * v * v - X * X * Y * Y * Y <= 0;
    }
  }
}

interface Kernel {
  dx: Float32Array;
  dy: Float32Array;
  /** Escala mínima de la forma que contiene la muestra (0..1): para la prueba «scatter-as-gather». */
  gauge: Float32Array;
  n: number;
}

const kernelCache = new Map<string, Kernel>();

/** Muestras distribuidas dentro de la forma (rejilla girada + calibre por muestra). */
export function buildKernel(shape: BokehShape, target: number): Kernel {
  const key = `${shape}:${target}`;
  const hit = kernelCache.get(key);
  if (hit) return hit;
  const pts: [number, number, number][] = [];
  let grid = Math.ceil(Math.sqrt(target * 1.4));
  for (let attempt = 0; attempt < 6; attempt++) {
    pts.length = 0;
    const rot = 0.37;
    const c = Math.cos(rot), s = Math.sin(rot);
    for (let j = 0; j < grid; j++) {
      for (let i = 0; i < grid; i++) {
        const u = ((i + 0.5) / grid) * 2 - 1, v = ((j + 0.5) / grid) * 2 - 1;
        const x = u * c - v * s, y = u * s + v * c;
        if (!insideShape(shape, x, y)) continue;
        // Calibre: escala mínima s tal que (x/s, y/s) sigue dentro (formas estrelladas respecto al centro).
        let lo = 0, hi = 1;
        for (let it = 0; it < 14; it++) {
          const m = (lo + hi) / 2;
          if (m > 0 && insideShape(shape, x / m, y / m)) hi = m;
          else lo = m;
        }
        pts.push([x, y, hi]);
      }
    }
    if (pts.length >= target * 0.85) break;
    grid++;
  }
  const n = pts.length;
  const k: Kernel = { dx: new Float32Array(n), dy: new Float32Array(n), gauge: new Float32Array(n), n };
  pts.forEach(([x, y, g], i) => {
    k.dx[i] = x;
    k.dy[i] = y;
    k.gauge[i] = g;
  });
  kernelCache.set(key, k);
  return k;
}

// ------------------------------------------------------------------ profundidad

/** Canal de luminancia de un mapa de profundidad RGBA → Uint8 (0 lejos … 255 cerca). */
export function depthChannel(d: ImageData): Uint8ClampedArray {
  const out = new Uint8ClampedArray(d.width * d.height);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = d.data[j];
  return out;
}

/** Profundidad (0..1) en un punto normalizado: mediana de una ventana pequeña (robusta a bordes). */
export function depthAt(depth: Uint8ClampedArray, W: number, H: number, fx: number, fy: number): number {
  const cx = Math.round(Math.min(1, Math.max(0, fx)) * (W - 1));
  const cy = Math.round(Math.min(1, Math.max(0, fy)) * (H - 1));
  const r = Math.max(2, Math.round(Math.min(W, H) * 0.01));
  const vals: number[] = [];
  for (let y = Math.max(0, cy - r); y <= Math.min(H - 1, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(W - 1, cx + r); x++) vals.push(depth[y * W + x]);
  }
  vals.sort((a, b) => a - b);
  return (vals[vals.length >> 1] ?? 128) / 255;
}

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Fracción (0..1) del desenfoque máximo para una profundidad dada. */
export function cocFraction(d: number, focus: number, p: Pick<BokehParams, 'dof' | 'foreground'>): number {
  const diff = focus - d; // > 0: más lejos que el foco
  if (diff < 0 && !p.foreground) return 0;
  const tol = (p.dof / 100) * 0.3;
  const a = (Math.abs(diff) - tol) / Math.max(0.05, 0.55 - tol);
  return smooth(a);
}

// ------------------------------------------------------------------ bokeh (núcleo)

export interface BokehCoreOptions {
  focusDepth: number;
  /** Radio máximo en píxeles de ESTA imagen. */
  maxRadius: number;
  samples?: number;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/**
 * Desenfoque variable por profundidad con forma de diafragma («gather» con prueba de dispersión:
 * una muestra solo aporta si su propio círculo de confusión llega hasta el píxel, así el sujeto
 * nítido no «sangra» sobre el fondo). Trabaja en luz aproximadamente lineal (gamma 2).
 */
export function renderBokehCore(img: ImageData, depth: Uint8ClampedArray, params: BokehParams, o: BokehCoreOptions): ImageData {
  const { width: W, height: H } = img;
  const src = img.data;
  const out = new ImageData(W, H);
  const dst = out.data;
  const N = W * H;
  const kernel = buildKernel(params.shape, o.samples ?? 64);
  const coc = new Float32Array(N);
  const lin = new Float32Array(N * 3);
  const boost = (params.highlights / 100) * 6;
  const wgt = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    coc[i] = cocFraction(depth[i] / 255, o.focusDepth, params) * o.maxRadius;
    const r = src[i * 4] / 255, g = src[i * 4 + 1] / 255, b = src[i * 4 + 2] / 255;
    lin[i * 3] = r * r;
    lin[i * 3 + 1] = g * g;
    lin[i * 3 + 2] = b * b;
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    const hl = l > 0.72 ? (l - 0.72) / 0.28 : 0;
    wgt[i] = 1 + boost * hl * hl * hl * (coc[i] > 1 ? 1 : 0);
  }
  const { dx, dy, gauge, n } = kernel;
  const rowsPerTick = Math.max(1, Math.floor(40000 / W));
  for (let y = 0; y < H; y++) {
    if (y % rowsPerTick === 0) {
      if (o.signal?.aborted) throw new CancelledError();
      o.onProgress?.(y / H);
    }
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      const R = coc[p];
      const k4 = p * 4;
      if (R < 0.5) {
        dst[k4] = src[k4]; dst[k4 + 1] = src[k4 + 1]; dst[k4 + 2] = src[k4 + 2]; dst[k4 + 3] = src[k4 + 3];
        continue;
      }
      // Giro pseudoaleatorio por píxel: cambia el patrón regular de la rejilla por grano fino.
      const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      const ang = (h % 6283) / 1000;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const dp = depth[p];
      let ar = 0, ag = 0, ab = 0, aw = 0, aa = 0;
      // Centro siempre presente
      {
        const w = wgt[p];
        ar += lin[p * 3] * w; ag += lin[p * 3 + 1] * w; ab += lin[p * 3 + 2] * w; aw += w; aa += src[k4 + 3] * w;
      }
      for (let s = 0; s < n; s++) {
        let ox = dx[s], oy = dy[s];
        if (params.shape === 'circulo') {
          const t = ox * ca - oy * sa;
          oy = ox * sa + oy * ca;
          ox = t;
        }
        const qx = Math.round(x + ox * R), qy = Math.round(y + oy * R);
        if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
        const q = qy * W + qx;
        const need = gauge[s] * R - 0.5;
        // Aporta si su desenfoque alcanza este píxel, o si está DETRÁS (más lejos) del píxel.
        if (coc[q] < need && depth[q] > dp) continue;
        const w = wgt[q];
        ar += lin[q * 3] * w; ag += lin[q * 3 + 1] * w; ab += lin[q * 3 + 2] * w; aw += w; aa += src[q * 4 + 3] * w;
      }
      dst[k4] = Math.sqrt(ar / aw) * 255;
      dst[k4 + 1] = Math.sqrt(ag / aw) * 255;
      dst[k4 + 2] = Math.sqrt(ab / aw) * 255;
      dst[k4 + 3] = aa / aw;
    }
  }
  o.onProgress?.(1);
  return out;
}

// ------------------------------------------------------------------ pipeline completo

export interface BokehPipelineOptions {
  /** Lado largo de trabajo del desenfoque (la nitidez del sujeto se conserva a resolución original). */
  workLong?: number;
  /** Limita también el resultado (vista previa). */
  outLong?: number;
  samples?: number;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

function drawTo(src: CanvasImageSource, w: number, h: number): ImageData {
  const c = createCanvas(w, h);
  const ctx = ctx2d(c);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/**
 * Bokeh completo: desenfoque a resolución de trabajo + recomposición a resolución de salida,
 * mezclando con el original según el círculo de confusión de cada píxel.
 */
export function bokehPipeline(image: ImageBitmap, depthMap: ImageBitmap, params: BokehParams, o: BokehPipelineOptions = {}): ImageData {
  const W0 = image.width, H0 = image.height;
  const long0 = Math.max(W0, H0);
  const outScale = Math.min(1, (o.outLong ?? long0) / long0);
  const OW = Math.max(1, Math.round(W0 * outScale)), OH = Math.max(1, Math.round(H0 * outScale));
  const outLong = Math.max(OW, OH);
  const workScale = Math.min(1, (o.workLong ?? 1280) / outLong);
  const WW = Math.max(1, Math.round(OW * workScale)), WH = Math.max(1, Math.round(OH * workScale));

  const workImg = drawTo(image, WW, WH);
  const workDepth = depthChannel(drawTo(depthMap, WW, WH));
  const focusDepth = depthAt(workDepth, WW, WH, params.focusX, params.focusY);
  const maxRadiusWork = (params.intensity / 100) * MAX_RADIUS_FRAC * Math.max(WW, WH);
  const blurred = renderBokehCore(workImg, workDepth, params, {
    focusDepth,
    maxRadius: maxRadiusWork,
    samples: o.samples,
    onProgress: (f) => o.onProgress?.(f * 0.9),
    signal: o.signal,
  });
  if (WW === OW && WH === OH) {
    o.onProgress?.(1);
    return blurred;
  }
  // Recomposición a resolución de salida.
  const bc = createCanvas(WW, WH);
  ctx2d(bc).putImageData(blurred, 0, 0);
  const up = drawTo(bc as CanvasImageSource, OW, OH);
  const orig = drawTo(image, OW, OH);
  const dFull = depthChannel(drawTo(depthMap, OW, OH));
  const maxRadiusOut = (params.intensity / 100) * MAX_RADIUS_FRAC * outLong;
  const od = orig.data, ud = up.data;
  for (let i = 0, k = 0; i < dFull.length; i++, k += 4) {
    const R = cocFraction(dFull[i] / 255, focusDepth, params) * maxRadiusOut;
    const a = Math.min(1, Math.max(0, (R - 0.6) / 1.6));
    if (a <= 0) continue;
    od[k] += (ud[k] - od[k]) * a;
    od[k + 1] += (ud[k + 1] - od[k + 1]) * a;
    od[k + 2] += (ud[k + 2] - od[k + 2]) * a;
    od[k + 3] += (ud[k + 3] - od[k + 3]) * a;
  }
  if (o.signal?.aborted) throw new CancelledError();
  o.onProgress?.(1);
  return orig;
}

// ------------------------------------------------------------------ parallax 3D

export type ParallaxMotion = 'circulo' | 'horizontal' | 'vertical' | 'zoom';

export interface ParallaxParams {
  /** 0..100 */
  amount: number;
  motion: ParallaxMotion;
  /** Profundidad (0..1) que queda quieta. */
  pivot: number;
}

export const DEFAULT_PARALLAX: ParallaxParams = { amount: 45, motion: 'circulo', pivot: 0.5 };

/** Desplazamiento (en px de la imagen) para la fase t (0..1). */
export function parallaxOffset(p: ParallaxParams, t: number, long: number): { dx: number; dy: number; zoom: number } {
  const A = (p.amount / 100) * 0.035 * long;
  const a = t * Math.PI * 2;
  switch (p.motion) {
    case 'horizontal':
      return { dx: A * Math.sin(a), dy: 0, zoom: 0 };
    case 'vertical':
      return { dx: 0, dy: A * Math.sin(a), zoom: 0 };
    case 'zoom':
      return { dx: 0, dy: 0, zoom: ((p.amount / 100) * 0.08 * (1 - Math.cos(a))) / 2 };
    default:
      return { dx: A * Math.cos(a), dy: A * Math.sin(a) * 0.6, zoom: 0 };
  }
}

/**
 * Un fotograma del efecto 3D: cada píxel se desplaza según su profundidad (cerca se mueve más).
 * Mapeo inverso con dos iteraciones para reducir desgarros en los bordes.
 */
export function parallaxFrame(
  src: ImageData,
  depth: Uint8ClampedArray,
  out: ImageData,
  off: { dx: number; dy: number; zoom: number },
  pivot: number,
): void {
  const { width: W, height: H } = src;
  const s = src.data, o = out.data;
  const cx = W / 2, cy = H / 2;
  // Ligero zoom global para que no se vean bordes vacíos.
  const margin = 1 + (Math.max(Math.abs(off.dx) / W, Math.abs(off.dy) / H) * 2.2 + off.zoom);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const bx = cx + (x - cx) / margin, by = cy + (y - cy) / margin;
      let sx = bx, sy = by;
      for (let it = 0; it < 2; it++) {
        const ix = Math.min(W - 1, Math.max(0, Math.round(sx))), iy = Math.min(H - 1, Math.max(0, Math.round(sy)));
        const d = depth[iy * W + ix] / 255 - pivot;
        const z = 1 + off.zoom * d * 2;
        sx = cx + (bx - cx) / z - off.dx * d;
        sy = cy + (by - cy) / z - off.dy * d;
      }
      // Bilineal
      const x0 = Math.min(W - 2, Math.max(0, Math.floor(sx))), y0 = Math.min(H - 2, Math.max(0, Math.floor(sy)));
      const fx = Math.min(1, Math.max(0, sx - x0)), fy = Math.min(1, Math.max(0, sy - y0));
      const i00 = (y0 * W + x0) * 4, i10 = i00 + 4, i01 = i00 + W * 4, i11 = i01 + 4;
      const k = (y * W + x) * 4;
      for (let c = 0; c < 4; c++) {
        const top = s[i00 + c] + (s[i10 + c] - s[i00 + c]) * fx;
        const bot = s[i01 + c] + (s[i11 + c] - s[i01 + c]) * fx;
        o[k + c] = top + (bot - top) * fy;
      }
    }
  }
}

/** Prepara imagen y profundidad a un tamaño dado para generar fotogramas. */
export function prepareParallax(image: CanvasImageSource & { width: number; height: number }, depthMap: CanvasImageSource, long: number) {
  const s = Math.min(1, long / Math.max(image.width, image.height));
  const W = Math.max(2, Math.round(image.width * s)), H = Math.max(2, Math.round(image.height * s));
  const img = drawTo(image, W, H);
  const dImg = drawTo(depthMap, W, H);
  return { img, depth: depthChannel(dImg), W, H };
}

// ------------------------------------------------------------------ ejecución fuera del hilo principal

let fxWorker: Worker | null = null;
let fxSeq = 0;

function getFxWorker(): Worker | null {
  if (fxWorker) return fxWorker;
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null;
  try {
    fxWorker = new Worker(new URL('./fx.worker.ts', import.meta.url), { type: 'module', name: 'efectos-ia' });
    return fxWorker;
  } catch {
    return null;
  }
}

/**
 * Aplica el modo retrato y devuelve un ImageBitmap (en un Web Worker si es posible).
 * Las imágenes de entrada NO se invalidan.
 */
export async function applyBokeh(
  image: ImageBitmap,
  depthMap: ImageBitmap,
  params: BokehParams,
  o: Omit<BokehPipelineOptions, 'signal' | 'onProgress'> & { signal?: AbortSignal; onProgress?: (f: number) => void } = {},
): Promise<ImageBitmap> {
  if (o.signal?.aborted) throw new CancelledError();
  const w = getFxWorker();
  if (!w) {
    await new Promise((r) => setTimeout(r, 0));
    return createImageBitmap(bokehPipeline(image, depthMap, params, o));
  }
  const [img, dep] = await Promise.all([createImageBitmap(image), createImageBitmap(depthMap)]);
  const id = ++fxSeq;
  return new Promise<ImageBitmap>((resolve, reject) => {
    const onMsg = (ev: MessageEvent) => {
      const m = ev.data as { id: number; type: string; value?: ImageBitmap; fraction?: number; message?: string };
      if (m.id !== id) return;
      if (m.type === 'progress') o.onProgress?.(m.fraction ?? 0);
      else {
        cleanup();
        if (m.type === 'done' && m.value) resolve(m.value);
        else reject(new Error(m.message ?? 'Error en el efecto'));
      }
    };
    const onAbort = () => {
      cleanup();
      // Un cálculo en curso no se puede interrumpir: se reinicia el worker.
      fxWorker?.terminate();
      fxWorker = null;
      reject(new CancelledError());
    };
    const cleanup = () => {
      w.removeEventListener('message', onMsg);
      o.signal?.removeEventListener('abort', onAbort);
    };
    w.addEventListener('message', onMsg);
    o.signal?.addEventListener('abort', onAbort, { once: true });
    const { signal: _s, onProgress: _p, ...rest } = o;
    void _s; void _p;
    w.postMessage({ id, type: 'bokeh', image: img, depth: dep, params, options: rest }, [img, dep]);
  });
}
