/**
 * Registro de los 8 módulos de IA descargables desde el «Centro de módulos».
 *
 * VERIFICACIÓN DE REPOSITORIOS (consultados en la API de Hugging Face / npm / jsDelivr el 2026-11-19,
 * comprobando que existen los archivos .onnx y sus tamaños):
 *   [OK] briaai/RMBG-1.4                              onnx/model{,_fp16,_quantized}.onnx
 *   [OK] Xenova/swin2SR-classical-sr-x2-64            onnx/model{,_fp16,_quantized}.onnx
 *   [OK] Xenova/swin2SR-realworld-sr-x4-64-bsrgan-psnr onnx/model{,_fp16,_quantized}.onnx
 *   [OK] onnx-community/depth-anything-v2-small       onnx/model{,_fp16,_quantized}.onnx
 *   [OK] Xenova/slimsam-77-uniform                    onnx/vision_encoder*, prompt_encoder_mask_decoder*
 *   [OK] Carve/LaMa-ONNX                              lama_fp32.onnx (entrada fija 512×512: image[1,3,512,512] 0..1, mask[1,1,512,512])
 *   [OK] tesseract.js@7.0.0 / tesseract.js-core@7.0.0 / @tesseract.js-data/{spa,eng}/4.0.0_best_int (jsDelivr)
 *   [OK] onnx-community/Florence-2-base-ft            embed_tokens / vision_encoder / encoder_model / decoder_model_merged
 *   [OK] AdamCodd/vit-base-nsfw-detector              onnx/model_quantized.onnx (etiquetas sfw/nsfw)
 * No se encontró un Real-ESRGAN ONNX fiable en HF compatible con transformers.js: se usa Swin2SR.
 * Ningún repo quedó sin verificar (había red). Lo que NO se pudo probar aquí es la ejecución real
 * en navegador (WebGPU/WASM); por eso LaMa y Florence-2 van marcados como «experimental».
 */
import type { ModuleId, ModuleInfo } from '../core/contracts';
import type { VariantKey } from './types';

export type Availability = 'estable' | 'experimental' | 'proximamente';

type DType = 'fp32' | 'fp16' | 'q8' | 'q4' | 'int8' | 'uint8' | 'bnb4' | 'q4f16';
export type DTypeSpec = DType | Record<string, DType>;

/** Un modelo cargado con Transformers.js. */
export interface TransformersModelSpec {
  key: string;               // identificador interno (p. ej. 'x2')
  repo: string;
  /** dtype por variante descargada. */
  dtype: Record<VariantKey, DTypeSpec>;
  /** Fuerza siempre WASM (modelos que van mejor/más seguros en CPU). */
  forceWasm?: boolean;
}

/** Un archivo propio guardado en la Cache API 'modelos-ia-v1'. */
export interface OwnFileSpec {
  url: string;
  label: string;
  sizeMB: number;
}

export interface ModuleSpec extends ModuleInfo {
  availability: Availability;
  /** Explicación ampliada para la tarjeta (cómo usarlo, consejos). */
  detailsEs: string;
  licenseEs: string;
  /** Tamaño aproximado de descarga (MB) según la variante que se elegirá en este equipo. */
  sizeByVariantMB: Record<VariantKey, number>;
  /** Necesita el motor ONNX Runtime (WASM ~29 MB, compartido entre módulos). */
  needsRuntime: boolean;
  transformers?: TransformersModelSpec[];
  files?: OwnFileSpec[];
  /** Se incrementa si cambian los archivos: fuerza reinstalación. */
  version: number;
}

const HF = 'https://huggingface.co';

export const ORT_RUNTIME_MB = 29;

export const MODULES: readonly ModuleSpec[] = [
  {
    id: 'remove-bg',
    nameEs: 'Quitar fondo',
    descriptionEs:
      'Detecta automáticamente a la persona u objeto principal y vuelve transparente todo lo demás. Ideal para retratos, productos y montajes.',
    detailsEs:
      'Usa una red de segmentación (RMBG-1.4) que analiza la imagen a 1024 px y genera una máscara suave, respetando pelo y bordes finos.',
    licenseEs: 'Modelo BRIA RMBG-1.4: licencia de uso no comercial (para uso comercial se requiere acuerdo con BRIA).',
    sizeMB: 44,
    sizeByVariantMB: { wasm: 44, 'webgpu-f16': 88, webgpu: 176 },
    engine: 'transformers.js',
    modelRepo: 'briaai/RMBG-1.4',
    tool: 'quitar-fondo',
    availability: 'estable',
    needsRuntime: true,
    version: 1,
    transformers: [{ key: 'main', repo: 'briaai/RMBG-1.4', dtype: { wasm: 'q8', 'webgpu-f16': 'fp16', webgpu: 'fp32' } }],
  },
  {
    id: 'upscale',
    nameEs: 'Ampliar resolución (×2 / ×4)',
    descriptionEs:
      'Aumenta el tamaño de la foto reconstruyendo detalle con una red neuronal (superresolución), en lugar de solo estirar los píxeles.',
    detailsEs:
      'Incluye dos modelos Swin2SR: ×2 «clásico» (nítido, para fotos limpias) y ×4 «mundo real» (tolera ruido y compresión JPEG). La imagen se procesa por bloques: con WebGPU es razonablemente rápido, pero en modo WASM (CPU) una foto de 1 megapíxel puede tardar varios minutos.',
    licenseEs: 'Swin2SR: licencia Apache-2.0.',
    sizeMB: 43,
    sizeByVariantMB: { wasm: 43, 'webgpu-f16': 65, webgpu: 107 },
    engine: 'transformers.js',
    modelRepo: 'Xenova/swin2SR-classical-sr-x2-64',
    tool: 'ampliar',
    availability: 'estable',
    needsRuntime: true,
    version: 1,
    transformers: [
      { key: 'x2', repo: 'Xenova/swin2SR-classical-sr-x2-64', dtype: { wasm: 'q8', 'webgpu-f16': 'fp16', webgpu: 'fp32' } },
      { key: 'x4', repo: 'Xenova/swin2SR-realworld-sr-x4-64-bsrgan-psnr', dtype: { wasm: 'q8', 'webgpu-f16': 'fp16', webgpu: 'fp32' } },
    ],
  },
  {
    id: 'depth',
    nameEs: 'Mapa de profundidad',
    descriptionEs:
      'Calcula qué tan lejos está cada parte de la escena y genera una imagen en grises (claro = cerca, oscuro = lejos).',
    detailsEs:
      'Con el mapa puedes simular el desenfoque de fondo tipo «modo retrato», añadir niebla o crear efectos 3D. Modelo Depth Anything V2 (versión pequeña).',
    licenseEs: 'Depth Anything V2 Small: licencia Apache-2.0.',
    sizeMB: 27,
    sizeByVariantMB: { wasm: 27, 'webgpu-f16': 50, webgpu: 99 },
    engine: 'transformers.js',
    modelRepo: 'onnx-community/depth-anything-v2-small',
    tool: 'profundidad',
    availability: 'estable',
    needsRuntime: true,
    version: 1,
    transformers: [
      { key: 'main', repo: 'onnx-community/depth-anything-v2-small', dtype: { wasm: 'q8', 'webgpu-f16': 'fp16', webgpu: 'fp32' } },
    ],
  },
  {
    id: 'segment',
    nameEs: 'Selección inteligente',
    descriptionEs:
      'Haz clic sobre un objeto y la IA dibuja su contorno exacto. Sirve para recortar, aplicar ajustes solo a una zona o crear máscaras.',
    detailsEs:
      'Basado en Segment Anything (SlimSAM). El primer clic analiza la imagen (unos segundos); los siguientes clics sobre la misma imagen son casi instantáneos. Puedes añadir puntos que «sí» y que «no» pertenecen al objeto.',
    licenseEs: 'SlimSAM / Segment Anything: licencia Apache-2.0.',
    sizeMB: 14,
    sizeByVariantMB: { wasm: 14, 'webgpu-f16': 21, webgpu: 40 },
    engine: 'transformers.js',
    modelRepo: 'Xenova/slimsam-77-uniform',
    tool: 'seleccion-inteligente',
    availability: 'estable',
    needsRuntime: true,
    version: 1,
    transformers: [
      { key: 'main', repo: 'Xenova/slimsam-77-uniform', dtype: { wasm: 'q8', 'webgpu-f16': 'fp16', webgpu: 'fp32' } },
    ],
  },
  {
    id: 'inpaint',
    nameEs: 'Borrador mágico',
    descriptionEs:
      'Pinta encima de lo que quieras eliminar (una persona, un cable, una mancha) y la IA rellena el hueco imitando el entorno.',
    detailsEs:
      'Usa LaMa, una red especializada en «rellenar huecos». Trabaja sobre un recorte de 512×512 alrededor de la zona pintada y lo funde con la foto original. Función experimental: puede tardar varios segundos y consume bastante memoria.',
    licenseEs: 'LaMa (exportación ONNX de Carve): licencia Apache-2.0.',
    sizeMB: 208,
    sizeByVariantMB: { wasm: 208, 'webgpu-f16': 208, webgpu: 208 },
    engine: 'onnxruntime-web',
    modelRepo: 'Carve/LaMa-ONNX',
    tool: 'borrador-magico',
    availability: 'experimental',
    needsRuntime: true,
    version: 1,
    files: [{ url: `${HF}/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx`, label: 'lama_fp32.onnx', sizeMB: 208 }],
  },
  {
    id: 'ocr',
    nameEs: 'Extraer texto (OCR)',
    descriptionEs:
      'Reconoce las letras que aparecen en la imagen (carteles, documentos, capturas) y las convierte en texto que puedes copiar. Incluye español e inglés.',
    detailsEs:
      'Usa Tesseract, el motor de OCR libre más conocido. Funciona mejor con texto nítido, horizontal y con buen contraste. Devuelve también la posición de cada palabra.',
    licenseEs: 'Tesseract / tesseract.js: licencia Apache-2.0.',
    sizeMB: 9,
    sizeByVariantMB: { wasm: 9, 'webgpu-f16': 9, webgpu: 9 },
    engine: 'tesseract',
    modelRepo: 'tesseract.js@7.0.0 + tessdata_best_int (spa, eng)',
    tool: 'extraer-texto',
    availability: 'estable',
    needsRuntime: false,
    version: 1,
  },
  {
    id: 'caption',
    nameEs: 'Describir imagen',
    descriptionEs:
      'Genera automáticamente una descripción de lo que aparece en la foto. Útil como texto alternativo (accesibilidad) o para organizar tus imágenes.',
    detailsEs:
      'Modelo de visión y lenguaje Florence-2 (Microsoft). La descripción se genera en inglés. Es el módulo más pesado: sin WebGPU puede tardar bastante.',
    licenseEs: 'Florence-2: licencia MIT.',
    sizeMB: 275,
    sizeByVariantMB: { wasm: 275, 'webgpu-f16': 357, webgpu: 275 },
    engine: 'transformers.js',
    modelRepo: 'onnx-community/Florence-2-base-ft',
    tool: 'describir',
    availability: 'experimental',
    needsRuntime: true,
    version: 1,
    transformers: [
      {
        key: 'main',
        repo: 'onnx-community/Florence-2-base-ft',
        dtype: {
          wasm: { embed_tokens: 'q8', vision_encoder: 'q8', encoder_model: 'q8', decoder_model_merged: 'q8' },
          webgpu: { embed_tokens: 'q8', vision_encoder: 'q8', encoder_model: 'q8', decoder_model_merged: 'q8' },
          'webgpu-f16': { embed_tokens: 'fp16', vision_encoder: 'fp16', encoder_model: 'q4', decoder_model_merged: 'q4' },
        },
      },
    ],
  },
  {
    id: 'nsfw',
    nameEs: 'Detector de contenido sensible',
    descriptionEs:
      'Analiza la imagen y avisa si podría contener desnudos o contenido para adultos, para que puedas difuminarlo o no compartirlo por error.',
    detailsEs:
      'Clasificador ViT entrenado para distinguir contenido apto (SFW) de no apto (NSFW). Es orientativo: puede equivocarse en casos dudosos.',
    licenseEs: 'vit-base-nsfw-detector: licencia Apache-2.0.',
    sizeMB: 89,
    sizeByVariantMB: { wasm: 89, 'webgpu-f16': 89, webgpu: 89 },
    engine: 'transformers.js',
    modelRepo: 'AdamCodd/vit-base-nsfw-detector',
    tool: 'filtro-contenido',
    availability: 'estable',
    needsRuntime: true,
    version: 1,
    transformers: [
      {
        key: 'main',
        repo: 'AdamCodd/vit-base-nsfw-detector',
        dtype: { wasm: 'q8', 'webgpu-f16': 'q8', webgpu: 'q8' },
        forceWasm: true,
      },
    ],
  },
];

const BY_ID = new Map<ModuleId, ModuleSpec>(MODULES.map((m) => [m.id, m]));

export const MODULE_IDS: readonly ModuleId[] = MODULES.map((m) => m.id);

export function getModuleSpec(id: ModuleId): ModuleSpec {
  const spec = BY_ID.get(id);
  if (!spec) throw new Error(`Módulo desconocido: ${id}`);
  return spec;
}

/** Solo los campos del contrato (ModuleInfo). */
export function getModuleInfo(id: ModuleId): ModuleInfo {
  const { nameEs, descriptionEs, sizeMB, engine, modelRepo, tool } = getModuleSpec(id);
  return { id, nameEs, descriptionEs, sizeMB, engine, modelRepo, tool };
}

/** Lista de repos/URLs que identifican los archivos de un módulo en la caché. */
export function repoPrefixes(spec: ModuleSpec): string[] {
  return (spec.transformers ?? []).map((t) => `/${t.repo}/`);
}
