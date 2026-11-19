/** Plantillas de lienzo para redes sociales y catálogos, con guías de zona segura. */
import { createCanvas, ctx2d, type AnyCanvas } from './util';

export interface SafeZone { x: number; y: number; w: number; h: number }
export interface CanvasPreset {
  id: string; name: string; w: number; h: number; group: 'Redes' | 'Tiendas' | 'Impresión';
  note: string;
  /** Márgenes seguros en px (arriba, derecha, abajo, izquierda). */
  safe: [number, number, number, number];
}

export const PRESETS: CanvasPreset[] = [
  { id: 'ig-post', name: 'Instagram post', w: 1080, h: 1080, group: 'Redes', note: 'Publicación cuadrada del feed.', safe: [60, 60, 60, 60] },
  { id: 'ig-portrait', name: 'Instagram vertical 4:5', w: 1080, h: 1350, group: 'Redes', note: 'Ocupa más pantalla en el feed.', safe: [60, 60, 60, 60] },
  { id: 'ig-story', name: 'Instagram story / Reel', w: 1080, h: 1920, group: 'Redes', note: 'Deja libres arriba y abajo: ahí van el perfil y los botones.', safe: [250, 60, 340, 60] },
  { id: 'fb-post', name: 'Facebook publicación', w: 1200, h: 630, group: 'Redes', note: 'Imagen para enlaces y publicaciones.', safe: [40, 60, 40, 60] },
  { id: 'fb-cover', name: 'Facebook portada', w: 1640, h: 624, group: 'Redes', note: 'En móvil se recorta por los lados.', safe: [60, 230, 60, 230] },
  { id: 'yt-thumb', name: 'YouTube miniatura', w: 1280, h: 720, group: 'Redes', note: 'La duración tapa la esquina inferior derecha.', safe: [40, 160, 80, 40] },
  { id: 'wa-status', name: 'WhatsApp estado', w: 1080, h: 1920, group: 'Redes', note: 'Evita los bordes superior e inferior (nombre y respuesta).', safe: [200, 60, 260, 60] },
  { id: 'x-post', name: 'X / Twitter 16:9', w: 1600, h: 900, group: 'Redes', note: 'Imagen en la línea de tiempo.', safe: [50, 50, 50, 50] },
  { id: 'pin', name: 'Pinterest pin', w: 1000, h: 1500, group: 'Redes', note: 'Formato vertical 2:3.', safe: [80, 60, 80, 60] },
  { id: 'meli', name: 'Mercado Libre producto', w: 1200, h: 1200, group: 'Tiendas', note: 'Fondo blanco y producto centrado ocupando ~90 %.', safe: [60, 60, 60, 60] },
  { id: 'shop', name: 'Catálogo cuadrado', w: 1000, h: 1000, group: 'Tiendas', note: 'Para catálogos de tienda online.', safe: [50, 50, 50, 50] },
  { id: 'a4', name: 'A4 vertical (300 ppp)', w: 2480, h: 3508, group: 'Impresión', note: 'Margen de impresión de ~1 cm.', safe: [118, 118, 118, 118] },
  { id: 'a4-h', name: 'A4 horizontal (300 ppp)', w: 3508, h: 2480, group: 'Impresión', note: 'Margen de impresión de ~1 cm.', safe: [118, 118, 118, 118] },
];

/** Dibuja una guía: zonas no seguras sombreadas y borde de la zona segura. */
export function renderSafeGuide(w: number, h: number, safe: [number, number, number, number], k = 1): AnyCanvas {
  const c = createCanvas(w, h);
  const ctx = ctx2d(c);
  const [t, r, b, l] = safe.map((v) => v * k);
  ctx.fillStyle = 'rgba(255, 60, 90, 0.22)';
  ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.rect(l, t, w - l - r, h - t - b); ctx.fill('evenodd');
  ctx.strokeStyle = 'rgba(255, 60, 90, 0.95)';
  ctx.lineWidth = Math.max(2, Math.min(w, h) / 360);
  ctx.setLineDash([ctx.lineWidth * 5, ctx.lineWidth * 3]);
  ctx.strokeRect(l, t, w - l - r, h - t - b);
  ctx.setLineDash([]);
  ctx.font = `600 ${Math.max(10, Math.min(w, h) / 40)}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(255, 255, 255, .95)'; ctx.textAlign = 'center';
  ctx.fillText('ZONA SEGURA — oculta esta capa antes de exportar', w / 2, t + Math.min(w, h) / 30);
  return c;
}
