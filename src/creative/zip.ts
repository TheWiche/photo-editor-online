/** Escritor ZIP mínimo (método «store», sin compresión). Genera un Blob. */

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d: Date) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

interface Entry { name: Uint8Array; crc: number; size: number; offset: number; time: number; date: number }

export class ZipWriter {
  private parts: BlobPart[] = [];
  private entries: Entry[] = [];
  private offset = 0;
  private names = new Set<string>();

  /** Nombre único dentro del zip. */
  uniqueName(name: string): string {
    if (!this.names.has(name)) return name;
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
    for (let i = 2; ; i++) { const n = `${base}-${i}${ext}`; if (!this.names.has(n)) return n; }
  }

  async add(name: string, data: Blob | Uint8Array, date = new Date()): Promise<string> {
    name = this.uniqueName(name);
    this.names.add(name);
    const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
    const nameBytes = new TextEncoder().encode(name);
    const { time, date: dd } = dosDateTime(date);
    const crc = crc32(bytes);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, time, true); h.setUint16(12, dd, true); h.setUint32(14, crc, true);
    h.setUint32(18, bytes.length, true); h.setUint32(22, bytes.length, true);
    h.setUint16(26, nameBytes.length, true); h.setUint16(28, 0, true);
    this.entries.push({ name: nameBytes, crc, size: bytes.length, offset: this.offset, time, date: dd });
    this.parts.push(h.buffer, nameBytes as BlobPart, bytes as BlobPart);
    this.offset += 30 + nameBytes.length + bytes.length;
    return name;
  }

  finish(): Blob {
    const start = this.offset;
    let cdSize = 0;
    for (const e of this.entries) {
      const h = new DataView(new ArrayBuffer(46));
      h.setUint32(0, 0x02014b50, true); h.setUint16(4, 20, true); h.setUint16(6, 20, true); h.setUint16(8, 0x0800, true);
      h.setUint16(10, 0, true); h.setUint16(12, e.time, true); h.setUint16(14, e.date, true); h.setUint32(16, e.crc, true);
      h.setUint32(20, e.size, true); h.setUint32(24, e.size, true); h.setUint16(28, e.name.length, true);
      h.setUint32(42, e.offset, true);
      this.parts.push(h.buffer, e.name as BlobPart);
      cdSize += 46 + e.name.length;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, this.entries.length, true); end.setUint16(10, this.entries.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, start, true);
    this.parts.push(end.buffer);
    return new Blob(this.parts, { type: 'application/zip' });
  }
}
