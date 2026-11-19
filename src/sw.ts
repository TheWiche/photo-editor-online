/**
 * Service worker (estrategia injectManifest de vite-plugin-pwa).
 *
 *  - Precache de la app (shell, JS, CSS, iconos). Lo hace a mano con la Cache API para no depender de Workbox en runtime.
 *  - NO precachea modelos de IA ni el motor ONNX: esos se guardan aparte desde el Centro de módulos
 *    en las cachés 'modelos-ia-v1' y 'transformers-cache', que este worker nunca toca ni borra.
 *  - Navegaciones: «app shell» (index.html) servido desde caché, con red como alternativa.
 *  - Web Share Target: POST multipart a /compartir -> guarda los archivos en la caché 'estudio-compartido-v1'
 *    y redirige a /?compartido=N; la app los recoge al iniciar (ver src/project/incoming.ts).
 *  - Actualización: la nueva versión queda «en espera» hasta que la app envía {type:'SKIP_WAITING'} (aviso «Nueva versión disponible»).
 */
export {};

declare global {
  interface Window { __WB_MANIFEST: { url: string; revision: string | null }[] }
}

const sw = self as unknown as ServiceWorkerGlobalScope;
const manifest = self.__WB_MANIFEST;

const APP_PREFIX = 'estudio-app-';
const SHARE_CACHE = 'estudio-compartido-v1';

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const CACHE = APP_PREFIX + hash(manifest.map((m) => `${m.url}@${m.revision ?? ''}`).join('|'));
const abs = (u: string) => new URL(u, sw.registration.scope).href;
const precached = new Set(manifest.map((m) => abs(m.url)));
const SHELL = abs('index.html');

sw.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 'reload' evita que la caché HTTP del navegador nos entregue versiones antiguas.
    await Promise.all([...precached].map(async (u) => {
      if (await cache.match(u)) return;
      const res = await fetch(new Request(u, { cache: 'reload' }));
      if (!res.ok) throw new Error(`Precache: ${u} -> ${res.status}`);
      await cache.put(u, res);
    }));
  })());
});

sw.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      // Sólo se borran las cachés de la app de versiones anteriores. Modelos de IA y archivos compartidos se respetan.
      if (name.startsWith(APP_PREFIX) && name !== CACHE) await caches.delete(name);
    }
    await sw.clients.claim();
  })());
});

sw.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') void sw.skipWaiting();
});

async function handleShare(req: Request): Promise<Response> {
  const home = new URL('./', sw.registration.scope);
  try {
    const form = await req.formData();
    const files = form.getAll('imagenes').filter((f): f is File => typeof f !== 'string');
    const cache = await caches.open(SHARE_CACHE);
    for (const k of await cache.keys()) await cache.delete(k);
    await Promise.all(files.map((f, i) => cache.put(
      new Request(new URL(`__compartido/${i}`, home).href),
      new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name) } }),
    )));
    home.searchParams.set('compartido', String(files.length));
  } catch {
    /* si algo falla se abre la app vacía */
  }
  return Response.redirect(home.href, 303);
}

sw.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== sw.location.origin) return;

  if (req.method === 'POST' && url.pathname.endsWith('/compartir')) {
    event.respondWith(handleShare(req));
    return;
  }
  if (req.method !== 'GET') return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cached = await caches.match(SHELL, { cacheName: CACHE });
      if (cached) return cached;
      try { return await fetch(req); } catch { return (await caches.match(SHELL)) ?? Response.error(); }
    })());
    return;
  }

  const clean = url.origin + url.pathname;
  if (precached.has(clean)) {
    event.respondWith((async () => (await caches.match(clean, { cacheName: CACHE })) ?? fetch(req))());
  }
  // Todo lo demás (modelos, wasm, imágenes externas…) pasa directo a la red / a su propia caché.
});
