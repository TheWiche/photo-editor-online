import type { Adjustments, ColorBalanceSettings, CurvesSettings, HslSettings, Layer, LevelsSettings } from './contracts';

/** Herramientas integradas. Las del registro (src/core/toolRegistry.ts) usan cualquier id. */
export type BuiltinToolId = 'move' | 'crop' | 'rotate' | 'text' | 'brush' | 'eraser' | 'eyedropper' | 'hand';
/** Id de herramienta: integradas o registradas por otros módulos. */
export type ToolId = BuiltinToolId | (string & {});

export type CropRatio = 'free' | 'original' | '1:1' | '4:5' | '16:9';

export interface Rect { x: number; y: number; w: number; h: number }
export interface Point { x: number; y: number }

export interface ViewState {
  zoom: number;
  /** Desplazamiento (px de pantalla) del centro del documento respecto al centro del visor. */
  panX: number;
  panY: number;
}

export interface BrushSettings {
  size: number;        // px de documento
  hardness: number;    // 0..1
  opacity: number;     // 0..1
  /** 'color' pinta sobre la capa; 'mask' restaura zonas ocultas por el borrador. */
  mode: 'color' | 'mask';
}

export const DEFAULT_ADJUSTMENTS: Readonly<Adjustments> = Object.freeze({
  brightness: 0, contrast: 0, saturation: 0,
  exposure: 0, temperature: 0, tint: 0,
  blur: 0, sharpen: 0, vignette: 0,
  grayscale: false, sepia: 0, hue: 0,
});

export function defaultAdjustments(): Adjustments {
  return { ...DEFAULT_ADJUSTMENTS };
}

/* ---------- color avanzado: valores neutros y comprobaciones ---------- */

export const HSL_RANGES = ['Rojos', 'Naranjas', 'Amarillos', 'Verdes', 'Aguamarinas', 'Azules', 'Púrpuras', 'Magentas'] as const;
/** Tono central (grados) de cada rango HSL. */
export const HSL_CENTERS = [0, 30, 60, 120, 180, 225, 270, 315];
export const HSL_SWATCHES = ['#ff4040', '#ff9a30', '#ffe040', '#40d050', '#40e0d0', '#4070ff', '#9a50ff', '#ff40c0'];

export const neutralCurves = (): CurvesSettings => ({ rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] });
export const neutralLevels = (): LevelsSettings => ({ inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 });
export const neutralHsl = (): HslSettings => ({ hue: Array(8).fill(0), sat: Array(8).fill(0), lum: Array(8).fill(0) });
export const neutralColorBalance = (): ColorBalanceSettings => ({ shadows: [0, 0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0], preserveLuminosity: true });

const identityCurve = (c: [number, number][] | undefined) =>
  !c || c.length === 0 || c.every(([x, y]) => x === y);
export const isNeutralCurves = (c?: CurvesSettings) => !c || (identityCurve(c.rgb) && identityCurve(c.r) && identityCurve(c.g) && identityCurve(c.b));
export const isNeutralLevels = (l?: LevelsSettings) => !l || (l.inBlack === 0 && l.inWhite === 255 && l.gamma === 1 && l.outBlack === 0 && l.outWhite === 255);
export const isNeutralHsl = (h?: HslSettings) => !h || [...h.hue, ...h.sat, ...h.lum].every((v) => !v);
export const isNeutralColorBalance = (b?: ColorBalanceSettings) => !b || [...b.shadows, ...b.midtones, ...b.highlights].every((v) => !v);
export const hasAdvancedColor = (a: Adjustments) =>
  !isNeutralCurves(a.curves) || !isNeutralLevels(a.levels) || !isNeutralHsl(a.hsl) || !isNeutralColorBalance(a.colorBalance);

/** Ajustes numéricos/booleanos básicos (los del deslizador). */
export type BasicAdjustmentKey = 'brightness' | 'contrast' | 'saturation' | 'exposure' | 'temperature' | 'tint'
  | 'blur' | 'sharpen' | 'vignette' | 'grayscale' | 'sepia' | 'hue';

export function isDefaultAdjustments(a: Adjustments): boolean {
  return (Object.keys(DEFAULT_ADJUSTMENTS) as BasicAdjustmentKey[]).every((k) => a[k] === DEFAULT_ADJUSTMENTS[k]) && !hasAdvancedColor(a);
}

let counter = 0;
export function uid(prefix = 'l'): string {
  counter += 1;
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rnd}`;
}

export const DEFAULT_FONT = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export function createLayer(partial: Partial<Layer> = {}): Layer {
  return {
    id: uid(),
    name: 'Capa',
    kind: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blend: 'source-over',
    x: 0, y: 0,
    rotation: 0,
    scaleX: 1, scaleY: 1,
    ...partial,
    adjustments: { ...DEFAULT_ADJUSTMENTS, ...(partial.adjustments ?? {}) },
  };
}

export const BLEND_MODES: { value: GlobalCompositeOperation; label: string }[] = [
  { value: 'source-over', label: 'Normal' },
  { value: 'multiply', label: 'Multiplicar' },
  { value: 'screen', label: 'Trama' },
  { value: 'overlay', label: 'Superponer' },
  { value: 'darken', label: 'Oscurecer' },
  { value: 'lighten', label: 'Aclarar' },
  { value: 'color-dodge', label: 'Sobreexponer color' },
  { value: 'color-burn', label: 'Subexponer color' },
  { value: 'hard-light', label: 'Luz fuerte' },
  { value: 'soft-light', label: 'Luz suave' },
  { value: 'difference', label: 'Diferencia' },
  { value: 'exclusion', label: 'Exclusión' },
  { value: 'hue', label: 'Tono' },
  { value: 'saturation', label: 'Saturación' },
  { value: 'color', label: 'Color' },
  { value: 'luminosity', label: 'Luminosidad' },
];

export const FONT_FAMILIES: { value: string; label: string }[] = [
  { value: DEFAULT_FONT, label: 'Sans (sistema)' },
  { value: 'Georgia, "Times New Roman", serif', label: 'Serif' },
  { value: 'Impact, "Arial Black", sans-serif', label: 'Impacto' },
  { value: '"Courier New", ui-monospace, monospace', label: 'Monoespaciada' },
  { value: '"Brush Script MT", "Segoe Script", cursive', label: 'Manuscrita' },
  { value: '"Trebuchet MS", Verdana, sans-serif', label: 'Humanista' },
];

export function ratioValue(r: CropRatio, docW: number, docH: number): number | null {
  switch (r) {
    case '1:1': return 1;
    case '4:5': return 4 / 5;
    case '16:9': return 16 / 9;
    case 'original': return docW / docH;
    default: return null;
  }
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
