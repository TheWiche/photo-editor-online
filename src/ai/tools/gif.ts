/**
 * Codificador GIF89a animado mínimo (sin dependencias): paleta global por corte de mediana
 * (256 colores), tramado ordenado suave y compresión LZW. Pensado para animaciones cortas
 * (efecto 3D) de hasta ~600 px.
 */

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v / 16 - 0.47) * 10);

interface Box {
  bins: number[];
  rMin: number; rMax: number; gMin: number; gMax: number; bMin: number; bMax: number;
  count: number;
}

const binR = (b: number) => b >> 10;
const binG = (b: number) => (b >> 5) & 31;
const binB = (b: number) => b & 31;

function makeBox(bins: number[], hist: Uint32Array): Box {
  let rMin = 31, rMax = 0, gMin = 31, gMax = 0, bMin = 31, bMax = 0, count = 0;
  for (const b of bins) {
    const r = binR(b), g = binG(b), bl = binB(b);
    if (r < rMin) rMin = r;
    if (r > rMax) rMax = r;
    if (g < gMin) gMin = g;
    if (g > gMax) gMax = g;
    if (bl < bMin) bMin = bl;
    if (bl > bMax) bMax = bl;
    count += hist[b];
  }
  return { bins, rMin, rMax, gMin, gMax, bMin, bMax, count };
}

/** Paleta de hasta 256 colores (RGB plano) a partir de varios fotogramas. */
export function buildPalette(frames: ImageData[], maxColors = 256): Uint8Array {
  const hist = new Uint32Array(32768);
  for (const f of frames) {
    const d = f.data;
    const step = Math.max(1, Math.floor(d.length / 4 / 60000)) * 4;
    for (let i = 0; i < d.length; i += step) hist[((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3)]++;
  }
  const used: number[] = [];
  for (let i = 0; i < hist.length; i++) if (hist[i]) used.push(i);
  let boxes: Box[] = [makeBox(used, hist)];
  while (boxes.length < maxColors) {
    // Caja con mayor (rango × población) que se pueda partir.
    let bi = -1, best = 0;
    boxes.forEach((b, i) => {
      if (b.bins.length < 2) return;
      const range = Math.max(b.rMax - b.rMin, b.gMax - b.gMin, b.bMax - b.bMin);
      const score = range * Math.sqrt(b.count);
      if (score > best) { best = score; bi = i; }
    });
    if (bi < 0) break;
    const b = boxes[bi];
    const rr = b.rMax - b.rMin, gr = b.gMax - b.gMin, br = b.bMax - b.bMin;
    const axis = gr >= rr && gr >= br ? binG : rr >= br ? binR : binB;
    const sorted = b.bins.slice().sort((x, y) => axis(x) - axis(y));
    let acc = 0, cut = 1;
    for (let i = 0; i < sorted.length; i++) {
      acc += hist[sorted[i]];
      if (acc >= b.count / 2) { cut = Math.min(sorted.length - 1, Math.max(1, i + 1)); break; }
    }
    boxes = [...boxes.slice(0, bi), makeBox(sorted.slice(0, cut), hist), makeBox(sorted.slice(cut), hist), ...boxes.slice(bi + 1)];
  }
  const pal = new Uint8Array(maxColors * 3);
  boxes.forEach((b, i) => {
    let r = 0, g = 0, bl = 0, n = 0;
    for (const bin of b.bins) {
      const c = hist[bin];
      r += (binR(bin) * 8 + 4) * c; g += (binG(bin) * 8 + 4) * c; bl += (binB(bin) * 8 + 4) * c; n += c;
    }
    n = n || 1;
    pal[i * 3] = Math.round(r / n); pal[i * 3 + 1] = Math.round(g / n); pal[i * 3 + 2] = Math.round(bl / n);
  });
  return pal;
}

function indexer(pal: Uint8Array) {
  const n = pal.length / 3;
  const lut = new Int16Array(32768).fill(-1);
  return (r: number, g: number, b: number) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let v = lut[key];
    if (v < 0) {
      let best = 0, bd = Infinity;
      for (let i = 0; i < n; i++) {
        const dr = pal[i * 3] - r, dg = pal[i * 3 + 1] - g, db = pal[i * 3 + 2] - b;
        const d = dr * dr * 2 + dg * dg * 4 + db * db * 3;
        if (d < bd) { bd = d; best = i; }
      }
      v = lut[key] = best;
    }
    return v;
  };
}

class Bytes {
  buf = new Uint8Array(1 << 16);
  len = 0;
  push(b: number) {
    if (this.len === this.buf.length) {
      const nb = new Uint8Array(this.buf.length * 2);
      nb.set(this.buf);
      this.buf = nb;
    }
    this.buf[this.len++] = b;
  }
  pushAll(a: ArrayLike<number>) { for (let i = 0; i < a.length; i++) this.push(a[i]); }
  u16(v: number) { this.push(v & 255); this.push((v >> 8) & 255); }
  str(s: string) { for (let i = 0; i < s.length; i++) this.push(s.charCodeAt(i)); }
  bytes() { return this.buf.slice(0, this.len); }
}

/** LZW de GIF (código mínimo 8) → bytes empaquetados (sin sub‑bloques). */
function lzw(indices: Uint8Array, minCodeSize = 8): Uint8Array {
  const out = new Bytes();
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  const table = new Int16Array(1 << 20).fill(-1);
  const usedKeys = new Int32Array(4096);
  let nUsed = 0;
  let cur = 0, shift = 0;
  const emit = (code: number) => {
    cur |= code << shift;
    shift += codeSize;
    while (shift >= 8) { out.push(cur & 255); cur >>>= 8; shift -= 8; }
  };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const c = table[key];
    if (c >= 0) { prefix = c; continue; }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      for (let j = 0; j < nUsed; j++) table[usedKeys[j]] = -1;
      nUsed = 0;
      next = eoi + 1;
      codeSize = minCodeSize + 1;
    } else {
      if (next >= 1 << codeSize) codeSize++;
      table[key] = next++;
      usedKeys[nUsed++] = key;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (shift > 0) out.push(cur & 255);
  return out.bytes();
}

export interface GifOptions {
  /** Retardo por fotograma en milisegundos. */
  delayMs: number;
  /** 0 = repetir siempre. */
  loop?: number;
  onProgress?: (fraction: number) => void;
}

/** Codifica fotogramas RGBA (todos del mismo tamaño) como GIF animado. */
export function encodeGif(frames: ImageData[], o: GifOptions): Blob {
  if (!frames.length) throw new Error('No hay fotogramas');
  const { width: W, height: H } = frames[0];
  const pal = buildPalette([frames[0], frames[frames.length >> 1], frames[frames.length - 1]]);
  const idx = indexer(pal);
  const g = new Bytes();
  g.str('GIF89a');
  g.u16(W); g.u16(H);
  g.push(0xf7); g.push(0); g.push(0);
  g.pushAll(pal);
  // NETSCAPE2.0: repetición
  g.push(0x21); g.push(0xff); g.push(11); g.str('NETSCAPE2.0'); g.push(3); g.push(1); g.u16(o.loop ?? 0); g.push(0);
  const delay = Math.max(2, Math.round(o.delayMs / 10));
  const indices = new Uint8Array(W * H);
  frames.forEach((f, fi) => {
    const d = f.data;
    for (let y = 0, p = 0; y < H; y++) {
      for (let x = 0; x < W; x++, p++) {
        const t = BAYER4[(x & 3) + ((y & 3) << 2)];
        const k = p * 4;
        const r = Math.min(255, Math.max(0, d[k] + t)), gg = Math.min(255, Math.max(0, d[k + 1] + t)), b = Math.min(255, Math.max(0, d[k + 2] + t));
        indices[p] = idx(r, gg, b);
      }
    }
    // Extensión de control gráfico
    g.push(0x21); g.push(0xf9); g.push(4); g.push(0x04); g.u16(delay); g.push(0); g.push(0);
    // Descriptor de imagen
    g.push(0x2c); g.u16(0); g.u16(0); g.u16(W); g.u16(H); g.push(0);
    g.push(8);
    const data = lzw(indices, 8);
    for (let i = 0; i < data.length; i += 255) {
      const n = Math.min(255, data.length - i);
      g.push(n);
      g.pushAll(data.subarray(i, i + n));
    }
    g.push(0);
    o.onProgress?.((fi + 1) / frames.length);
  });
  g.push(0x3b);
  return new Blob([g.bytes()], { type: 'image/gif' });
}
