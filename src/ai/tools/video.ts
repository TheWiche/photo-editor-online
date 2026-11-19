/** Grabación de un vídeo corto (WebM/MP4) a partir de fotogramas generados, con MediaRecorder. */
import { CancelledError } from '../types';

export function pickVideoMime(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement === 'undefined') return null;
  const opts = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1', 'video/mp4'];
  for (const m of opts) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* sigue */
    }
  }
  return null;
}

export interface RecordOptions {
  width: number;
  height: number;
  fps: number;
  frames: number;
  /** Repeticiones del bucle (el vídeo dura frames/fps × loops). */
  loops?: number;
  /** Dibuja el fotograma i en el contexto. */
  draw: (ctx: CanvasRenderingContext2D, i: number) => void;
  signal?: AbortSignal;
  onProgress?: (f: number) => void;
}

/** Graba en tiempo real (dura lo mismo que el vídeo). Devuelve el archivo. */
export async function recordVideo(o: RecordOptions): Promise<Blob> {
  const mime = pickVideoMime();
  if (!mime) throw new Error('Tu navegador no puede grabar vídeo desde un lienzo.');
  const canvas = document.createElement('canvas');
  canvas.width = o.width;
  canvas.height = o.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo crear el lienzo');
  o.draw(ctx, 0);
  const stream = canvas.captureStream(o.fps);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: Math.round(o.width * o.height * o.fps * 0.25) });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
  rec.start(250);
  const total = o.frames * (o.loops ?? 2);
  const t0 = performance.now();
  try {
    for (let i = 0; i < total; i++) {
      if (o.signal?.aborted) throw new CancelledError();
      o.draw(ctx, i % o.frames);
      o.onProgress?.((i + 1) / total);
      const wait = t0 + ((i + 1) * 1000) / o.fps - performance.now();
      await new Promise((r) => setTimeout(r, Math.max(0, wait)));
    }
  } finally {
    rec.stop();
    stream.getTracks().forEach((t) => t.stop());
  }
  await stopped;
  return new Blob(chunks, { type: mime.split(';')[0] });
}
