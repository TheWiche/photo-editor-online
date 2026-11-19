/// <reference lib="webworker" />
/** Worker de efectos por profundidad (modo retrato). Ver portrait.ts → applyBokeh(). */
import { bokehPipeline, type BokehParams, type BokehPipelineOptions } from './portrait';

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (ev: MessageEvent) => {
  const m = ev.data as { id: number; type: 'bokeh'; image: ImageBitmap; depth: ImageBitmap; params: BokehParams; options: BokehPipelineOptions };
  if (m.type !== 'bokeh') return;
  try {
    let last = 0;
    const data = bokehPipeline(m.image, m.depth, m.params, {
      ...m.options,
      onProgress: (f) => {
        const now = Date.now();
        if (now - last > 80 || f >= 1) {
          last = now;
          scope.postMessage({ id: m.id, type: 'progress', fraction: f });
        }
      },
    });
    m.image.close();
    m.depth.close();
    const value = await createImageBitmap(data);
    scope.postMessage({ id: m.id, type: 'done', value }, [value]);
  } catch (err) {
    scope.postMessage({ id: m.id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
