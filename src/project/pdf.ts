/** Escritor PDF mínimo (propio): una imagen JPEG por página, sin dependencias. PDF 1.4. */

export type PdfSize = 'a4' | 'letter' | 'fit';
export interface PdfPage { jpeg: Blob; width: number; height: number }
export interface PdfOptions { size: PdfSize; /** Margen en puntos (sólo A4/Carta). */ margin?: number; title?: string }

const PAGE: Record<'a4' | 'letter', [number, number]> = { a4: [595.28, 841.89], letter: [612, 792] };
const MAX_PT = 14400; // límite práctico de los lectores (200 pulgadas)

/** Lee componentes y dimensiones del JPEG (marcador SOF). */
export async function jpegInfo(jpeg: Blob): Promise<{ width: number; height: number; components: number }> {
  const b = new Uint8Array(await jpeg.slice(0, Math.min(jpeg.size, 1 << 20)).arrayBuffer());
  let p = 2;
  while (p + 9 < b.length) {
    if (b[p] !== 0xff) { p++; continue; }
    const m = b[p + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { height: (b[p + 5] << 8) | b[p + 6], width: (b[p + 7] << 8) | b[p + 8], components: b[p + 9] };
    }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; }
    p += 2 + ((b[p + 2] << 8) | b[p + 3]);
  }
  throw new Error('JPEG no válido');
}

const num = (n: number) => (Math.round(n * 100) / 100).toString();
function pdfText(s: string): string {
  let hex = 'FEFF';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c > 0xffff) { const v = c - 0x10000; hex += (0xd800 + (v >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0'); }
    else hex += c.toString(16).padStart(4, '0');
  }
  return `<${hex}>`;
}

export async function buildPdf(pages: PdfPage[], opts: PdfOptions): Promise<Blob> {
  if (!pages.length) throw new Error('Sin páginas');
  const enc = new TextEncoder();
  const parts: BlobPart[] = [];
  const offsets: number[] = [];
  let len = 0;
  const push = (x: string | Blob | Uint8Array) => {
    if (typeof x === 'string') { const u = enc.encode(x); parts.push(u as BlobPart); len += u.length; }
    else if (x instanceof Blob) { parts.push(x); len += x.size; }
    else { parts.push(x as BlobPart); len += x.length; }
  };
  const obj = (n: number, body: string) => { offsets[n] = len; push(`${n} 0 obj\n${body}\nendobj\n`); };

  push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  const count = pages.length;
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Count ${count} /Kids [${pages.map((_, i) => `${4 + i * 3} 0 R`).join(' ')}] >>`);
  const now = new Date();
  const d = `D:${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}${String(now.getUTCSeconds()).padStart(2, '0')}Z`;
  obj(3, `<< /Producer (Estudio Foto) /CreationDate (${d})${opts.title ? ` /Title ${pdfText(opts.title)}` : ''} >>`);

  for (let i = 0; i < count; i++) {
    const pg = pages[i];
    const info = await jpegInfo(pg.jpeg);
    let pw: number, ph: number, x = 0, y = 0, w: number, h: number;
    if (opts.size === 'fit') {
      const k = Math.min(0.75, MAX_PT / Math.max(pg.width, pg.height));
      pw = w = pg.width * k; ph = h = pg.height * k;
    } else {
      const [a, b] = PAGE[opts.size];
      const landscape = pg.width > pg.height;
      pw = landscape ? b : a; ph = landscape ? a : b;
      const m = opts.margin ?? 36;
      const k = Math.min((pw - 2 * m) / pg.width, (ph - 2 * m) / pg.height);
      w = pg.width * k; h = pg.height * k;
      x = (pw - w) / 2; y = (ph - h) / 2;
    }
    const pageN = 4 + i * 3, contN = pageN + 1, imgN = pageN + 2;
    obj(pageN, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(pw)} ${num(ph)}] /Resources << /XObject << /Im0 ${imgN} 0 R >> >> /Contents ${contN} 0 R >>`);
    const content = `q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(y)} cm /Im0 Do Q`;
    obj(contN, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const cs = info.components === 1 ? '/DeviceGray' : info.components === 4 ? '/DeviceCMYK /Decode [1 0 1 0 1 0 1 0]' : '/DeviceRGB';
    offsets[imgN] = len;
    push(`${imgN} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace ${cs} /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.jpeg.size} >>\nstream\n`);
    push(pg.jpeg);
    push('\nendstream\nendobj\n');
  }

  const total = 4 + count * 3;
  const xref = len;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let n = 1; n < total; n++) x += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(x);
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}
