/**
 * Color avanzado sobre píxeles: Curvas, Niveles, HSL por color y Balance de color.
 * Todo se reduce a tablas (LUT) precalculadas para que el bucle por píxel sea barato.
 * Orden: Niveles → Curvas (RGB y luego canal) → Balance de color → HSL.
 */
import type { Adjustments, ColorBalanceSettings, CurvePoint, HslSettings, LevelsSettings } from './contracts';
import { clamp, HSL_CENTERS, isNeutralColorBalance, isNeutralCurves, isNeutralHsl, isNeutralLevels } from './defaults';

/* ------------------------------------------------------------- curvas */

/** Spline cúbica monótona (Fritsch–Carlson): no oscila ni invierte tonos. */
export function curveLut(points: CurvePoint[] | undefined): Uint8Array {
  const lut = new Uint8Array(256);
  const pts = sanitizeCurve(points);
  const n = pts.length;
  if (n < 2) { for (let i = 0; i < 256; i++) lut[i] = i; return lut; }
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const d: number[] = [], m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  let k = 0;
  for (let x = 0; x < 256; x++) {
    let y: number;
    if (x <= xs[0]) y = ys[0];
    else if (x >= xs[n - 1]) y = ys[n - 1];
    else {
      while (k < n - 2 && x > xs[k + 1]) k++;
      const h = xs[k + 1] - xs[k], t = (x - xs[k]) / h;
      const t2 = t * t, t3 = t2 * t;
      y = (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * m[k + 1];
    }
    lut[x] = clamp(Math.round(y), 0, 255);
  }
  return lut;
}

/** Ordena, recorta a 0..255 y elimina puntos con la misma entrada. */
export function sanitizeCurve(points: CurvePoint[] | undefined): CurvePoint[] {
  if (!points || points.length < 2) return [[0, 0], [255, 255]];
  const sorted = points.map(([x, y]) => [clamp(Math.round(x), 0, 255), clamp(Math.round(y), 0, 255)] as CurvePoint).sort((a, b) => a[0] - b[0]);
  const out: CurvePoint[] = [];
  for (const p of sorted) if (!out.length || out[out.length - 1][0] !== p[0]) out.push(p);
  return out.length >= 2 ? out : [[0, 0], [255, 255]];
}

/* ------------------------------------------------------------- niveles */

export function levelsLut(l: LevelsSettings | undefined): Uint8Array {
  const lut = new Uint8Array(256);
  const L = l ?? { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 };
  const span = Math.max(1, L.inWhite - L.inBlack);
  const g = 1 / clamp(L.gamma || 1, 0.05, 10);
  for (let v = 0; v < 256; v++) {
    const t = clamp((v - L.inBlack) / span, 0, 1);
    lut[v] = clamp(Math.round(L.outBlack + (L.outWhite - L.outBlack) * Math.pow(t, g)), 0, 255);
  }
  return lut;
}

/* ------------------------------------------------- balance de color */

/** Desplazamientos por luminosidad (0..255) y canal, al estilo GIMP. */
function balanceTables(b: ColorBalanceSettings): [Float32Array, Float32Array, Float32Array] {
  const out: [Float32Array, Float32Array, Float32Array] = [new Float32Array(256), new Float32Array(256), new Float32Array(256)];
  const A = 0.25, B = 0.333, S = 0.7;
  for (let i = 0; i < 256; i++) {
    const l = i / 255;
    const ws = clamp((l - B) / -A + 0.5, 0, 1) * S;
    const wm = clamp((l - B) / A + 0.5, 0, 1) * clamp((l + B - 1) / -A + 0.5, 0, 1) * S;
    const wh = clamp((l + B - 1) / A + 0.5, 0, 1) * S;
    for (let c = 0; c < 3; c++) out[c][i] = 255 * (ws * b.shadows[c] + wm * b.midtones[c] + wh * b.highlights[c]) / 100;
  }
  return out;
}

/* ------------------------------------------------------------- HSL */

/** Interpola los 8 rangos por tono (0..359) → [Δtono°, factor sat, Δlum]. */
function hslTables(h: HslSettings): [Float32Array, Float32Array, Float32Array] {
  const dh = new Float32Array(360), ds = new Float32Array(360), dl = new Float32Array(360);
  const n = HSL_CENTERS.length;
  for (let deg = 0; deg < 360; deg++) {
    let i = n - 1;
    for (let k = 0; k < n; k++) if (HSL_CENTERS[k] <= deg) i = k;
    const j = (i + 1) % n;
    const c0 = HSL_CENTERS[i];
    let c1 = HSL_CENTERS[j]; if (c1 <= c0) c1 += 360;
    let d = deg; if (d < c0) d += 360;
    const t = (d - c0) / (c1 - c0);
    const s = t * t * (3 - 2 * t); // transición suave entre rangos vecinos
    const mix = (arr: number[]) => ((arr[i] ?? 0) * (1 - s) + (arr[j] ?? 0) * s) / 100;
    dh[deg] = mix(h.hue) * 30;
    ds[deg] = mix(h.sat);
    dl[deg] = mix(h.lum);
  }
  return [dh, ds, dl];
}

export interface ColorProgram {
  lr: Uint8Array; lg: Uint8Array; lb: Uint8Array;
  balance: [Float32Array, Float32Array, Float32Array] | null;
  preserveLum: boolean;
  hsl: [Float32Array, Float32Array, Float32Array] | null;
  identityLut: boolean;
}

/** Prepara las tablas para unos ajustes, o null si el color avanzado es neutro. */
export function compileColor(a: Adjustments): ColorProgram | null {
  const nl = isNeutralLevels(a.levels), nc = isNeutralCurves(a.curves), nb = isNeutralColorBalance(a.colorBalance), nh = isNeutralHsl(a.hsl);
  if (nl && nc && nb && nh) return null;
  const lev = levelsLut(a.levels);
  const rgb = curveLut(a.curves?.rgb);
  const chans = [curveLut(a.curves?.r), curveLut(a.curves?.g), curveLut(a.curves?.b)];
  const luts = chans.map((c) => { const o = new Uint8Array(256); for (let v = 0; v < 256; v++) o[v] = c[rgb[lev[v]]]; return o; });
  let identityLut = true;
  for (let v = 0; v < 256 && identityLut; v++) if (luts[0][v] !== v || luts[1][v] !== v || luts[2][v] !== v) identityLut = false;
  return {
    lr: luts[0], lg: luts[1], lb: luts[2], identityLut,
    balance: nb ? null : balanceTables(a.colorBalance!),
    preserveLum: !!a.colorBalance?.preserveLuminosity,
    hsl: nh ? null : hslTables(a.hsl!),
  };
}

function hue2rgb(p: number, q: number, t: number) {
  if (t < 0) t += 1; if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

/** Aplica el programa in situ sobre RGBA. */
export function runColor(d: Uint8ClampedArray, prog: ColorProgram) {
  const { lr, lg, lb, balance, hsl, preserveLum, identityLut } = prog;
  const n = d.length;
  if (!balance && !hsl) {
    if (identityLut) return;
    for (let i = 0; i < n; i += 4) { d[i] = lr[d[i]]; d[i + 1] = lg[d[i + 1]]; d[i + 2] = lb[d[i + 2]]; }
    return;
  }
  const [br, bg, bb] = balance ?? [null, null, null];
  const [th, ts, tl] = hsl ?? [null, null, null];
  for (let i = 0; i < n; i += 4) {
    if (d[i + 3] === 0) continue;
    let r = lr[d[i]], g = lg[d[i + 1]], b = lb[d[i + 2]];
    if (br) {
      const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
      const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      const li = (mx + mn) >> 1;
      let nr = r + br[li], ng = g + bg![li], nb = b + bb![li];
      nr = nr < 0 ? 0 : nr > 255 ? 255 : nr; ng = ng < 0 ? 0 : ng > 255 ? 255 : ng; nb = nb < 0 ? 0 : nb > 255 ? 255 : nb;
      if (preserveLum) {
        const mx2 = Math.max(nr, ng, nb), mn2 = Math.min(nr, ng, nb);
        const shift = (mx + mn) / 2 - (mx2 + mn2) / 2;
        nr += shift; ng += shift; nb += shift;
        // si se sale de rango, comprime hacia el gris para no perder el tono
        const hi = Math.max(nr, ng, nb), lo = Math.min(nr, ng, nb), L = (mx + mn) / 2;
        let k = 1;
        if (hi > 255) k = Math.min(k, (255 - L) / Math.max(1e-6, hi - L));
        if (lo < 0) k = Math.min(k, L / Math.max(1e-6, L - lo));
        if (k < 1) { nr = L + (nr - L) * k; ng = L + (ng - L) * k; nb = L + (nb - L) * k; }
      }
      r = nr; g = ng; b = nb;
    }
    if (th) {
      const R = r / 255, G = g / 255, B = b / 255;
      const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
      const delta = mx - mn;
      if (delta > 1e-4) {
        let l = (mx + mn) / 2;
        let s = l > 0.5 ? delta / (2 - mx - mn) : delta / (mx + mn);
        let h: number;
        if (mx === R) h = (G - B) / delta + (G < B ? 6 : 0);
        else if (mx === G) h = (B - R) / delta + 2;
        else h = (R - G) / delta + 4;
        h *= 60;
        const hi = (h | 0) % 360;
        const wSat = s < 0.5 ? s * 2 : 1; // los grises casi no cambian
        h += th[hi] * wSat;
        const sv = ts![hi];
        s = clamp(sv >= 0 ? s + (1 - s) * sv * s : s * (1 + sv), 0, 1);
        l = clamp(l + tl![hi] * 0.5 * wSat * (1 - Math.abs(2 * l - 1) * 0.6), 0, 1);
        h = ((h % 360) + 360) % 360 / 360;
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3) * 255; g = hue2rgb(p, q, h) * 255; b = hue2rgb(p, q, h - 1 / 3) * 255;
      }
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
}

/* ------------------------------------------------------------- histograma */

export interface Histogram { r: Uint32Array; g: Uint32Array; b: Uint32Array; l: Uint32Array; max: number }

export function computeHistogram(d: Uint8ClampedArray): Histogram {
  const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), l = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue;
    r[d[i]]++; g[d[i + 1]]++; b[d[i + 2]]++;
    l[(d[i] * 54 + d[i + 1] * 183 + d[i + 2] * 19) >> 8]++;
  }
  let max = 1;
  // ignora los extremos para que un fondo blanco/negro no aplaste la gráfica
  for (let i = 1; i < 255; i++) max = Math.max(max, r[i], g[i], b[i], l[i]);
  return { r, g, b, l, max };
}
