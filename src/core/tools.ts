import type { Adjustments } from './contracts';
import type { BasicAdjustmentKey, ToolId } from './defaults';

export interface ToolInfo {
  id: ToolId;
  label: string;
  shortcut: string;
  /** Una frase para el tooltip. */
  short: string;
  /** Explicación para el panel «¿Qué hace?». */
  what: string;
  steps: string[];
  tip: string;
}

export const TOOLS: ToolInfo[] = [
  {
    id: 'move', label: 'Mover', shortcut: 'V',
    short: 'Selecciona y desplaza capas.',
    what: 'Mueve la capa activa por el lienzo y cambia su tamaño desde las esquinas. Al hacer clic sobre otra capa, la selecciona.',
    steps: ['Haz clic sobre una capa para seleccionarla.', 'Arrastra para moverla.', 'Arrastra un tirador de esquina para escalarla.'],
    tip: 'Usa las flechas del teclado para mover 1 px (Mayús + flecha: 10 px).',
  },
  {
    id: 'crop', label: 'Recortar', shortcut: 'C',
    short: 'Encuadra la imagen con proporciones fijas o libres.',
    what: 'Define el área que quieres conservar. Todo lo que quede fuera del marco se descarta del documento (las capas no se destruyen).',
    steps: ['Elige una proporción: libre, 1:1, 4:5 o 16:9.', 'Arrastra el marco o sus esquinas.', 'Pulsa «Aplicar» o Intro.'],
    tip: 'La regla de los tercios: coloca el sujeto sobre una de las líneas guía.',
  },
  {
    id: 'rotate', label: 'Rotar y voltear', shortcut: 'R',
    short: 'Gira 90°, endereza o voltea.',
    what: 'Gira todo el documento 90° o voltéalo como un espejo. Arrastrando sobre el lienzo inclinas sólo la capa activa.',
    steps: ['Usa los botones de la barra de opciones para girar o voltear.', 'Arrastra sobre el lienzo para rotar la capa libremente.', 'Mantén Mayús para saltos de 15°.'],
    tip: 'Para enderezar un horizonte, rota la capa y luego recorta los bordes.',
  },
  {
    id: 'text', label: 'Texto', shortcut: 'T',
    short: 'Añade títulos y rótulos editables.',
    what: 'Crea capas de texto que puedes editar en cualquier momento: contenido, tipografía, tamaño, color y alineación.',
    steps: ['Haz clic en el lienzo donde quieras el texto.', 'Escribe en el cuadro de la barra de opciones.', 'Usa Mover (V) para recolocarlo.'],
    tip: 'Un texto claro sobre fondo oscuro (o al revés) siempre se lee mejor.',
  },
  {
    id: 'brush', label: 'Pincel', shortcut: 'B',
    short: 'Pinta color o restaura zonas borradas.',
    what: 'En modo «Color» pinta con el color activo sobre la capa. En modo «Restaurar» devuelve las zonas ocultas por el borrador (máscara).',
    steps: ['Elige modo, tamaño, dureza y opacidad.', 'Pinta arrastrando sobre la capa activa.', 'Teclas [ y ] cambian el tamaño.'],
    tip: 'Dureza baja = bordes suaves, ideales para retoques que no se noten.',
  },
  {
    id: 'eraser', label: 'Borrador de máscara', shortcut: 'E',
    short: 'Oculta partes de la capa sin destruirlas.',
    what: 'Pinta una máscara que oculta píxeles. No se pierde nada: con el pincel en modo «Restaurar» vuelves a mostrarlos.',
    steps: ['Selecciona la capa en el panel Capas.', 'Arrastra para ocultar zonas.', 'Cambia a Pincel › Restaurar para corregir.'],
    tip: 'Combínalo con dos capas para fusionar fotos de forma suave.',
  },
  {
    id: 'eyedropper', label: 'Cuentagotas', shortcut: 'I',
    short: 'Toma un color de la imagen.',
    what: 'Lee el color del píxel donde haces clic y lo convierte en el color activo para el pincel y el texto. Además copia su código hexadecimal.',
    steps: ['Haz clic sobre la imagen.', 'El color activo cambia y su código se copia.'],
    tip: 'Úsalo para que el texto combine con los tonos de tu foto.',
  },
  {
    id: 'hand', label: 'Mano', shortcut: 'H',
    short: 'Desplaza la vista sin modificar la imagen.',
    what: 'Arrastra para moverte por el lienzo cuando tienes mucho zoom. No cambia la imagen, sólo lo que ves.',
    steps: ['Arrastra sobre el lienzo.', 'Mantén Espacio con cualquier herramienta para usarla al momento.', 'Rueda o pellizco para hacer zoom.'],
    tip: 'Ctrl+0 ajusta la imagen a la pantalla; Ctrl+1 la muestra al 100 %.',
  },
];

export const toolInfo = (id: ToolId) => TOOLS.find((t) => t.id === id)!;

export interface AdjustmentInfo {
  key: Exclude<BasicAdjustmentKey, 'grayscale'>;
  label: string;
  min: number;
  max: number;
  help: string;
}

export const ADJUSTMENT_GROUPS: { title: string; items: AdjustmentInfo[] }[] = [
  {
    title: 'Luz',
    items: [
      { key: 'exposure', label: 'Exposición', min: -100, max: 100, help: 'Simula abrir o cerrar el diafragma: aclara u oscurece toda la foto.' },
      { key: 'brightness', label: 'Brillo', min: -100, max: 100, help: 'Sube o baja la luminosidad general de forma lineal.' },
      { key: 'contrast', label: 'Contraste', min: -100, max: 100, help: 'Separa más (o menos) las luces de las sombras.' },
    ],
  },
  {
    title: 'Color',
    items: [
      { key: 'temperature', label: 'Temperatura', min: -100, max: 100, help: 'Negativo = tonos fríos (azules); positivo = cálidos (naranjas).' },
      { key: 'tint', label: 'Tinte', min: -100, max: 100, help: 'Corrige dominantes: negativo = verde, positivo = magenta.' },
      { key: 'saturation', label: 'Saturación', min: -100, max: 100, help: 'Intensidad de los colores. -100 deja la imagen en grises.' },
      { key: 'hue', label: 'Tono', min: -180, max: 180, help: 'Gira todos los colores por la rueda cromática.' },
      { key: 'sepia', label: 'Sepia', min: 0, max: 100, help: 'Aporta el tono marrón de las fotos antiguas.' },
    ],
  },
  {
    title: 'Efectos',
    items: [
      { key: 'sharpen', label: 'Nitidez', min: 0, max: 100, help: 'Realza los bordes y detalles finos. Úsala con moderación.' },
      { key: 'blur', label: 'Desenfoque', min: 0, max: 100, help: 'Suaviza la imagen; útil para fondos o efectos de ensueño.' },
      { key: 'vignette', label: 'Viñeta', min: 0, max: 100, help: 'Oscurece las esquinas para dirigir la mirada al centro.' },
    ],
  },
];

export interface FilterPreset { id: string; name: string; description: string; adjustments: Partial<Adjustments> }

export const FILTER_PRESETS: FilterPreset[] = [
  { id: 'none', name: 'Original', description: 'Sin filtro.', adjustments: {} },
  { id: 'vivid', name: 'Vívido', description: 'Colores intensos y contraste alto.', adjustments: { saturation: 45, contrast: 18, exposure: 4, sharpen: 15 } },
  { id: 'bw', name: 'B/N', description: 'Blanco y negro con contraste clásico.', adjustments: { grayscale: true, contrast: 22, brightness: 3 } },
  { id: 'warm', name: 'Cálido', description: 'Luz dorada de atardecer.', adjustments: { temperature: 45, saturation: 12, exposure: 4 } },
  { id: 'cool', name: 'Frío', description: 'Tonos azulados y limpios.', adjustments: { temperature: -45, saturation: -5, contrast: 6 } },
  { id: 'cinema', name: 'Cinematográfico', description: 'Contraste suave, color contenido y viñeta.', adjustments: { contrast: 20, saturation: -18, temperature: -12, tint: 6, vignette: 45, exposure: -6 } },
  { id: 'vintage', name: 'Vintage', description: 'Tonos sepia y contraste lavado.', adjustments: { sepia: 45, contrast: -14, saturation: -20, vignette: 35, brightness: 6, temperature: 15 } },
  { id: 'drama', name: 'Dramático', description: 'Sombras profundas y mucha textura.', adjustments: { contrast: 45, saturation: -25, sharpen: 35, vignette: 55, exposure: -8 } },
];

/** Escala un preset por intensidad (0..1). */
export function scalePreset(p: FilterPreset, k: number): Partial<Adjustments> {
  const out: Partial<Adjustments> = {};
  for (const [key, v] of Object.entries(p.adjustments) as [keyof Adjustments, number | boolean][]) {
    (out as Record<string, number | boolean>)[key] = typeof v === 'number' ? Math.round(v * k) : (k > 0.5 ? v : false);
  }
  return out;
}
