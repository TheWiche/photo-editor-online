// ARCHIVO TEMPORAL DE PRUEBA (se borra al terminar)
import * as ai from '../client';
import type { ModuleId } from '../../core/contracts';
const out: string[] = [];
const log = (...a: unknown[]) => { const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); out.push(s); console.log('[T]', s); };
(window as any).__log = out;

function testImage(w = 320, h = 240): Promise<ImageBitmap> {
  const c = new OffscreenCanvas(w, h); const g = c.getContext('2d')!;
  g.fillStyle = '#88aadd'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#cc3322'; g.beginPath(); g.arc(w / 2, h / 2, Math.min(w, h) / 4, 0, Math.PI * 2); g.fill();
  return createImageBitmap(c);
}
function textImage(): Promise<ImageBitmap> {
  const c = new OffscreenCanvas(640, 160); const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, 640, 160); g.fillStyle = '#000'; g.font = 'bold 56px sans-serif';
  g.fillText('Hola Mundo 2026', 30, 100); return createImageBitmap(c);
}
async function stat(b: ImageBitmap) {
  const c = new OffscreenCanvas(b.width, b.height); const g = c.getContext('2d')!; g.drawImage(b, 0, 0);
  const d = g.getImageData(0, 0, b.width, b.height).data; let a0 = 0, sum = 0;
  for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 128) a0++; sum += d[i]; }
  return { w: b.width, h: b.height, transparentPx: a0, meanR: Math.round(sum / (d.length / 4)) };
}
async function main() {
  const params = new URLSearchParams(location.search);
  const mods = (params.get('mods') ?? 'segment,depth,ocr').split(',') as ModuleId[];
  const phase = params.get('phase') ?? 'install';
  if (params.get('wasm') === '1') localStorage.setItem(ai.FORCE_WASM_KEY, '1'); else localStorage.removeItem(ai.FORCE_WASM_KEY);
  log('backend', await ai.detectBackend());
  log('crossOriginIsolated', crossOriginIsolated);
  await ai.refreshInstalled();
  log('installed-before', (await ai.listInstalled()).map((r) => r.id));
  for (const id of mods) {
    if (phase === 'install') {
      const t0 = performance.now(); let n = 0;
      try { await ai.install(id, () => { n++; }); log('install-ok', id, n, 'events', Math.round(performance.now() - t0), 'ms'); }
      catch (e) { log('install-fail', id, String((e as Error).message)); continue; }
    }
    const img = await testImage();
    const t0 = performance.now();
    try {
      switch (id) {
        case 'remove-bg': log('remove-bg', await stat(await ai.removeBackground(img))); break;
        case 'depth': log('depth', await stat(await ai.estimateDepth(img))); break;
        case 'segment': { const r = await ai.segmentPoint(img, { x: 160, y: 120 }); log('segment', r.score, r.bbox); const r2 = await ai.segmentPoint(img, { x: 10, y: 10 }); log('segment2', r2.score, r2.bbox); break; }
        case 'upscale': log('upscale', await stat(await ai.upscale(await testImage(150, 90), 2))); break;
        case 'ocr': { const r = await ai.ocr(await textImage()); log('ocr', r.text, r.words.length, r.words[0]); break; }
        case 'nsfw': log('nsfw', await ai.detectNsfw(img)); break;
        case 'caption': log('caption', await ai.caption(img, { detail: 'breve' })); break;
        case 'inpaint': {
          const m = new OffscreenCanvas(320, 240); const g = m.getContext('2d')!; g.fillStyle = '#fff'; g.beginPath(); g.arc(160, 120, 64, 0, Math.PI * 2); g.fill();
          const res = await ai.inpaint(img, await createImageBitmap(m)); log('inpaint', await stat(res)); break;
        }
      }
      log('run-ok', id, Math.round(performance.now() - t0), 'ms');
    } catch (e) { log('run-fail', id, String((e as Error).message), (e as Error).stack?.slice(0, 400)); }
  }
  log('installed-after', (await ai.listInstalled()).map((r) => `${r.id}:${r.variant}:${Math.round(r.bytes / 1e6)}MB`));
  log('estimate', await ai.estimate());
  log('DONE');
}
main().catch((e) => log('FATAL', String(e)));
