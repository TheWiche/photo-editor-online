/** Stickers: emojis integrados y SVG vectoriales propios (iconos, globos e insignias). */
import { createCanvas, ctx2d, escapeXml, EMOJI_FONT, type AnyCanvas } from './util';

export interface SvgSticker {
  id: string; name: string; cat: 'iconos' | 'globos' | 'insignias';
  /** Si tiene texto editable, valor por defecto. */
  text?: string;
  /** SVG 100x100. `c` = color principal, `t` = texto (ya escapado). */
  svg(c: string, t: string): string;
}

const W = '#ffffff';
const fit = (t: string, max: number, min = 10) => Math.max(min, Math.min(max, 150 / Math.max(2, t.length)));
const txt = (t: string, y: number, size: number, fill = W, extra = '') =>
  `<text x="50" y="${y}" text-anchor="middle" font-family="Arial Black,Arial,Helvetica,sans-serif" font-weight="900" font-size="${size}" fill="${fill}" ${extra}>${t}</text>`;
const star = (cx: number, cy: number, R: number, r: number, n = 5) =>
  Array.from({ length: n * 2 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / n; const q = i % 2 ? r : R; return `${(cx + Math.cos(a) * q).toFixed(1)},${(cy + Math.sin(a) * q).toFixed(1)}`; }).join(' ');
const burst = (n: number, R: number, r: number) => star(50, 50, R, r, n);

export const SVG_STICKERS: SvgSticker[] = [
  // ---- iconos
  { id: 'star', name: 'Estrella', cat: 'iconos', svg: (c) => `<polygon points="${star(50, 53, 46, 19)}" fill="${c}" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>` },
  { id: 'heart', name: 'Corazón', cat: 'iconos', svg: (c) => `<path d="M50 88C10 60 6 35 22 22c12-9 24-3 28 8 4-11 16-17 28-8 16 13 12 38-28 66z" fill="${c}" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>` },
  { id: 'check', name: 'Check', cat: 'iconos', svg: (c) => `<circle cx="50" cy="50" r="44" fill="${c}"/><path d="M28 52l16 16 29-32" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>` },
  { id: 'cross', name: 'Cruz', cat: 'iconos', svg: (c) => `<circle cx="50" cy="50" r="44" fill="${c}"/><path d="M32 32l36 36M68 32L32 68" stroke="#fff" stroke-width="10" stroke-linecap="round"/>` },
  { id: 'arrow', name: 'Flecha curva', cat: 'iconos', svg: (c) => `<path d="M14 78C14 44 38 28 66 30" fill="none" stroke="${c}" stroke-width="9" stroke-linecap="round"/><polygon points="62,10 92,32 60,52" fill="${c}"/>` },
  { id: 'pin', name: 'Ubicación', cat: 'iconos', svg: (c) => `<path d="M50 94C28 66 18 52 18 38a32 32 0 0 1 64 0c0 14-10 28-32 56z" fill="${c}" stroke="#fff" stroke-width="3"/><circle cx="50" cy="38" r="12" fill="#fff"/>` },
  { id: 'bolt', name: 'Rayo', cat: 'iconos', svg: (c) => `<polygon points="58,6 20,56 44,56 36,94 80,40 54,40" fill="${c}" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>` },
  { id: 'sun', name: 'Sol', cat: 'iconos', svg: (c) => `<g stroke="${c}" stroke-width="7" stroke-linecap="round">${Array.from({ length: 8 }, (_, i) => { const a = (i * Math.PI) / 4; return `<line x1="${50 + Math.cos(a) * 33}" y1="${50 + Math.sin(a) * 33}" x2="${50 + Math.cos(a) * 46}" y2="${50 + Math.sin(a) * 46}"/>`; }).join('')}</g><circle cx="50" cy="50" r="22" fill="${c}"/>` },
  { id: 'moon', name: 'Luna', cat: 'iconos', svg: (c) => `<path d="M62 8A42 42 0 1 0 92 64 34 34 0 0 1 62 8z" fill="${c}"/>` },
  { id: 'cloud', name: 'Nube', cat: 'iconos', svg: (c) => `<path d="M26 76a18 18 0 0 1-2-36 24 24 0 0 1 46-6 20 20 0 0 1 6 42z" fill="${c}" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>` },
  { id: 'flame', name: 'Fuego', cat: 'iconos', svg: (c) => `<path d="M50 92C26 92 16 74 24 54c4-10 12-14 14-28 12 8 14 18 12 26 6-4 8-12 8-18 14 12 24 26 22 40-2 14-12 18-30 18z" fill="${c}" stroke="#fff" stroke-width="3" stroke-linejoin="round"/><path d="M50 90c-10 0-16-8-12-18 3-7 9-9 12-16 10 8 16 14 14 22-1 8-6 12-14 12z" fill="#fff" opacity=".55"/>` },
  { id: 'crown', name: 'Corona', cat: 'iconos', svg: (c) => `<path d="M10 76L16 28l24 24 10-32 10 32 24-24 6 48z" fill="${c}" stroke="#fff" stroke-width="3" stroke-linejoin="round"/><rect x="10" y="78" width="80" height="10" rx="3" fill="${c}" stroke="#fff" stroke-width="3"/>` },
  { id: 'gift', name: 'Regalo', cat: 'iconos', svg: (c) => `<rect x="14" y="40" width="72" height="50" rx="4" fill="${c}"/><rect x="10" y="28" width="80" height="16" rx="4" fill="${c}" stroke="#fff" stroke-width="3"/><rect x="44" y="28" width="12" height="62" fill="#fff"/><path d="M50 28C30 28 28 8 40 10s10 18 10 18zM50 28c20 0 22-20 10-18s-10 18-10 18z" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round"/>` },
  { id: 'bell', name: 'Campana', cat: 'iconos', svg: (c) => `<path d="M50 10a6 6 0 0 1 6 6c16 4 22 18 22 34 0 14 4 18 10 24H12c6-6 10-10 10-24 0-16 6-30 22-34a6 6 0 0 1 6-6z" fill="${c}" stroke="#fff" stroke-width="3" stroke-linejoin="round"/><path d="M42 80a8 8 0 0 0 16 0z" fill="#fff"/>` },
  { id: 'camera', name: 'Cámara', cat: 'iconos', svg: (c) => `<path d="M12 28h20l6-10h24l6 10h20v56H12z" fill="${c}" stroke="#fff" stroke-width="3" stroke-linejoin="round"/><circle cx="50" cy="56" r="20" fill="#fff"/><circle cx="50" cy="56" r="12" fill="${c}"/>` },
  { id: 'phone', name: 'Teléfono', cat: 'iconos', svg: (c) => `<path d="M26 12l14 4-4 16-10 4c6 14 16 26 32 34l6-10 16 4 2 14C60 92 8 40 10 14z" fill="${c}" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>` },
  { id: 'cart', name: 'Carrito', cat: 'iconos', svg: (c) => `<path d="M6 16h14l12 48h46l10-32H26" fill="none" stroke="${c}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="38" cy="82" r="8" fill="${c}"/><circle cx="72" cy="82" r="8" fill="${c}"/>` },
  { id: 'tag', name: 'Etiqueta', cat: 'iconos', svg: (c) => `<path d="M8 14h40l44 44-34 34L14 48z" fill="${c}" stroke="#fff" stroke-width="3" stroke-linejoin="round"/><circle cx="30" cy="32" r="7" fill="#fff"/>` },
  { id: 'truck', name: 'Envío', cat: 'iconos', svg: (c) => `<path d="M6 26h54v44H6zM60 40h20l14 18v12H60z" fill="${c}" stroke="#fff" stroke-width="3" stroke-linejoin="round"/><circle cx="26" cy="74" r="9" fill="#fff" stroke="${c}" stroke-width="4"/><circle cx="76" cy="74" r="9" fill="#fff" stroke="${c}" stroke-width="4"/>` },
  // ---- globos
  { id: 'bubble', name: 'Globo redondo', cat: 'globos', text: '¡Hola!', svg: (c, t) => `<path d="M50 10C25 10 8 25 8 44s17 34 42 34c4 0 8 0 12-1l20 14-4-22c10-6 16-14 16-25C94 25 75 10 50 10z" fill="${c}" stroke="#fff" stroke-width="3"/>${txt(t, 50, fit(t, 24), '#fff')}` },
  { id: 'bubble-rect', name: 'Globo cuadrado', cat: 'globos', text: 'Texto', svg: (c, t) => `<path d="M10 14h80a4 4 0 0 1 4 4v50a4 4 0 0 1-4 4H58l-14 20-2-20H10a4 4 0 0 1-4-4V18a4 4 0 0 1 4-4z" fill="${c}" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>${txt(t, 49, fit(t, 24), '#fff')}` },
  { id: 'bubble-think', name: 'Globo de pensamiento', cat: 'globos', text: 'Mmm…', svg: (c, t) => `<g fill="${c}" stroke="#fff" stroke-width="3"><ellipse cx="50" cy="38" rx="42" ry="28"/><circle cx="30" cy="76" r="8"/><circle cx="18" cy="90" r="4.5"/></g>${txt(t, 46, fit(t, 22), '#fff')}` },
  { id: 'bubble-shout', name: 'Globo de grito', cat: 'globos', text: '¡WOW!', svg: (c, t) => `<polygon points="${burst(14, 48, 32)}" fill="${c}" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>${txt(t, 57, fit(t, 24), '#fff')}` },
  { id: 'bubble-oval', name: 'Globo ovalado', cat: 'globos', text: '¿Qué?', svg: (c, t) => `<path d="M50 12C26 12 8 26 8 42s18 30 42 30c6 0 11-1 16-2l16 16-4-20c8-6 14-14 14-24 0-16-18-30-42-30z" fill="#fff" stroke="${c}" stroke-width="5" stroke-linejoin="round"/>${txt(t, 49, fit(t, 24), c)}` },
  // ---- insignias
  { id: 'badge-off', name: 'Oferta -20%', cat: 'insignias', text: '-20%', svg: (c, t) => `<polygon points="${burst(16, 48, 41)}" fill="${c}" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/>${txt(t, 49, fit(t, 30, 12))}${txt('OFF', 68, 14)}` },
  { id: 'badge-sale', name: 'Sello OFERTA', cat: 'insignias', text: 'OFERTA', svg: (c, t) => `<circle cx="50" cy="50" r="46" fill="${c}"/><circle cx="50" cy="50" r="39" fill="none" stroke="#fff" stroke-width="2.5" stroke-dasharray="4 3"/>${txt(t, 57, fit(t, 22, 10))}` },
  { id: 'badge-new', name: 'Nuevo', cat: 'insignias', text: 'NUEVO', svg: (c, t) => `<rect x="6" y="28" width="88" height="44" rx="10" fill="${c}" stroke="#fff" stroke-width="3"/>${txt(t, 58, fit(t, 24, 10))}` },
  { id: 'badge-ribbon', name: 'Cinta', cat: 'insignias', text: 'TOP VENTAS', svg: (c, t) => `<path d="M2 30h96l-12 20 12 20H2l12-20z" fill="${c}" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/>${txt(t, 56, fit(t, 18, 8))}` },
  { id: 'badge-free', name: 'Envío gratis', cat: 'insignias', text: 'ENVÍO GRATIS', svg: (c, t) => `<path d="M8 20h84v44H62l-12 14-12-14H8z" fill="${c}" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>${txt(t, 47, fit(t, 14, 8))}` },
  { id: 'badge-2x1', name: 'Promo 2x1', cat: 'insignias', text: '2x1', svg: (c, t) => `<circle cx="50" cy="50" r="46" fill="${c}"/><circle cx="50" cy="50" r="40" fill="none" stroke="#fff" stroke-width="2"/>${txt(t, 62, fit(t, 40, 14))}` },
  { id: 'badge-quality', name: 'Sello calidad', cat: 'insignias', text: 'CALIDAD', svg: (c, t) => `<polygon points="${burst(24, 48, 42)}" fill="${c}"/><circle cx="50" cy="50" r="33" fill="none" stroke="#fff" stroke-width="2.5"/><polygon points="${star(50, 36, 10, 4)}" fill="#fff"/>${txt(t, 66, fit(t, 15, 7))}` },
];

export const EMOJI_SETS: { label: string; items: string[] }[] = [
  { label: 'Caras', items: ['😀', '😂', '🥰', '😎', '🤩', '😍', '😭', '😡', '🤔', '😴', '🥳', '😱'] },
  { label: 'Gestos', items: ['👍', '👏', '🙌', '🙏', '💪', '👌', '✌️', '🤝', '👀', '👉', '👇', '🔥'] },
  { label: 'Símbolos', items: ['❤️', '💯', '✨', '⭐', '💥', '💫', '✅', '❌', '⚠️', '❓', '❗', '💲'] },
  { label: 'Cosas', items: ['🎉', '🎁', '🛒', '📦', '🚚', '📷', '🎵', '💡', '🏆', '👑', '📍', '☀️'] },
  { label: 'Naturaleza', items: ['🌸', '🌈', '🌴', '🌊', '🍀', '🐶', '🐱', '🦋', '🍕', '🍔', '☕', '🍓'] },
];

export function renderSvgSticker(s: SvgSticker, color: string, text: string, size = 512): Promise<AnyCanvas> {
  const t = escapeXml(text || s.text || '');
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">${s.svg(color, t)}</svg>`;
  return svgToCanvas(markup, size, size);
}

export function svgToCanvas(markup: string, w: number, h: number): Promise<AnyCanvas> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => {
      const c = createCanvas(w, h);
      ctx2d(c).drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(c);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo dibujar el sticker')); };
    img.src = url;
  });
}

export function renderEmoji(e: string, size = 512): AnyCanvas {
  const c = createCanvas(size, size);
  const ctx = ctx2d(c);
  ctx.font = `${size * 0.8}px ${EMOJI_FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(e, size / 2, size * 0.54);
  return c;
}
