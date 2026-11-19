import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  resolve: { dedupe: ['onnxruntime-web'] },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Estudio Foto IA', short_name: 'Estudio Foto', lang: 'es',
        description: 'Editor de fotos en línea con IA que corre 100% en tu navegador.',
        theme_color: '#14151a', background_color: '#14151a', display: 'standalone',
        start_url: '/', icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      },
      // Los modelos de IA NO van en el precache: se guardan aparte (Cache API) desde el Centro de módulos.
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'], maximumFileSizeToCacheInBytes: 5_000_000 }
    })
  ],
  worker: { format: 'es' },
  server: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' } }
});
