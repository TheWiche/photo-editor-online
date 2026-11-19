# Estudio Foto IA

Editor de fotos en línea con IA que corre **100% en tu navegador**. Tus imágenes nunca se suben a un servidor: la edición y los modelos de inteligencia artificial se ejecutan localmente con WebAssembly y WebGPU.

Es una PWA: se puede instalar en el escritorio o en el móvil y seguir usándose sin conexión una vez descargados los módulos de IA.

## Stack

- **React 19** + **TypeScript** para la interfaz.
- **Vite 8** como bundler, con **vite-plugin-pwa** para el service worker y el manifiesto.
- **Zustand** para el estado del editor.
- **@huggingface/transformers** y **onnxruntime-web** para la inferencia en el navegador (WebGPU con fallback a WASM), dentro de Web Workers.

## Cómo correrlo en local

Requisitos: Node.js LTS reciente (Vite 8 y TypeScript 7 lo exigen).

```bash
npm i            # instalar dependencias
npm run dev      # servidor de desarrollo con Vite
npm run build    # comprobación de tipos (tsc) y build de producción en dist/
npm run preview  # sirve el build de dist/ para probarlo
```

En desarrollo, el servidor de Vite envía las cabeceras COOP/COEP necesarias para usar `SharedArrayBuffer` y WebAssembly multihilo.

## Despliegue en Cloudflare Pages

Conecta el repositorio en Cloudflare Pages con esta configuración:

| Campo                   | Valor           |
|-------------------------|-----------------|
| Comando de compilación  | `npm run build` |
| Directorio de salida    | `dist`          |

Los archivos de `public/` se copian tal cual a `dist/` y configuran el resto del comportamiento de producción:

- `public/_headers`: cabeceras `Cross-Origin-Opener-Policy: same-origin` y `Cross-Origin-Embedder-Policy: credentialless` (necesarias para la inferencia multihilo), caché larga e inmutable para `/assets/*` y `no-cache` para `/index.html` y `/sw.js`.
- `public/_redirects`: `/* /index.html 200`, para que las rutas de la SPA funcionen al recargar.

## Caché de modelos sin conexión

Los modelos de IA **no** forman parte del precache del service worker: son demasiado grandes para instalarse con la app. En su lugar:

1. Desde el **Centro de módulos** se elige qué módulo instalar. La descarga muestra su progreso por archivo.
2. Los pesos se guardan de forma persistente en la **Cache API** del navegador, separados de la caché de la aplicación.
3. Al ejecutar una herramienta, el worker lee el modelo desde esa caché. Si ya está instalado, no vuelve a descargarse, ni siquiera sin conexión.
4. Desinstalar un módulo elimina sus archivos de la caché y libera espacio.

Si el navegador borra los datos del sitio, los módulos deben volver a instalarse. Los datos son por navegador y dispositivo; no se sincronizan entre equipos.

## Módulos de IA

| ID          | Función                                              |
|-------------|------------------------------------------------------|
| `remove-bg` | Eliminar el fondo de una imagen                      |
| `upscale`   | Aumentar la resolución de una imagen                 |
| `depth`     | Estimar el mapa de profundidad                       |
| `segment`   | Segmentar objetos o regiones                         |
| `inpaint`   | Rellenar o borrar zonas de la imagen                 |
| `ocr`       | Reconocer texto en la imagen                         |
| `caption`   | Generar una descripción textual de la imagen         |
| `nsfw`      | Detectar contenido sensible                          |

Cada módulo declara su tamaño y el modelo que usa en `src/core/contracts.ts`.
