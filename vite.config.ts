import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const COOP_COEP = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' };

export default defineConfig({
  resolve: { dedupe: ['onnxruntime-web'] },
  plugins: [
    react(),
    VitePWA({
      // Service worker propio (src/sw.ts): precache de la app, sin modelos de IA, con «Compartir» y actualización bajo demanda.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false, // el registro lo hace src/project/pwa.ts (virtual:pwa-register)
      manifest: {
        id: '/',
        name: 'Estudio Foto IA', short_name: 'Estudio Foto', lang: 'es',
        description: 'Editor de fotos en línea con IA que corre 100% en tu navegador.',
        theme_color: '#14151a', background_color: '#14151a',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        start_url: '/', scope: '/',
        categories: ['photo', 'graphics', 'productivity'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
        // Abrir imágenes y proyectos .estudio desde el explorador de archivos del sistema.
        file_handlers: [{
          action: '/',
          accept: {
            'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/webp': ['.webp'], 'image/avif': ['.avif'],
            'image/gif': ['.gif'], 'image/bmp': ['.bmp'], 'application/x-estudio': ['.estudio'],
          },
        }],
        // «Compartir con…» desde el móvil: el service worker recibe el POST en /compartir.
        share_target: {
          action: '/compartir', method: 'POST', enctype: 'multipart/form-data',
          params: { files: [{ name: 'imagenes', accept: ['image/*', '.estudio'] }] },
        },
        launch_handler: { client_mode: ['navigate-existing', 'auto'] },
        shortcuts: [
          { name: 'Nuevo lienzo', short_name: 'Nuevo', url: '/?accion=nuevo', description: 'Crear un lienzo en blanco' },
          { name: 'Mis proyectos', short_name: 'Proyectos', url: '/?accion=proyectos', description: 'Abrir un proyecto guardado' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        // Los modelos de IA y el motor WASM NO se precachean: viven en la Cache API ('modelos-ia-v1' / 'transformers-cache').
        globIgnores: ['**/models/**', '**/*.onnx', '**/*.wasm', '**/*.ort', '**/*.safetensors', '**/*.bin'],
        maximumFileSizeToCacheInBytes: 5_000_000,
      },
      devOptions: { enabled: false },
    }),
  ],
  worker: { format: 'es' },
  server: { headers: COOP_COEP },
  preview: { headers: COOP_COEP },
});
