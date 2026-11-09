let crcTable: Uint32Array | null = null;

export function crc32(u8: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  readonly name: string;
  readonly data: Uint8Array;
}

/** The classic ZIP format counts bytes and entries on 32 and 16 bits (beyond that ZIP64 is needed, which isn't here). */
const MAX_BYTES = 0xffffffff, MAX_ENTRIES = 0xffff;

/** ZIP archive without compression (audio doesn't compress anyway), in pieces: a Blob
 *  puts them together without copying everything into a single buffer. */
export function zipParts(files: readonly ZipEntry[], date = new Date()): Uint8Array[] {
  if (files.length > MAX_ENTRIES) throw new Error(`too many files for a ZIP (${files.length})`);
  const enc = new TextEncoder();
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    if (offset + 30 + name.length + size > MAX_BYTES) throw new Error('the project exceeds 4 GB, the limit of a ZIP');
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, 0, true); lh.setUint16(10, time, true); lh.setUint16(12, day, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, time, true);
    ch.setUint16(14, day, true); ch.setUint32(16, crc, true); ch.setUint32(20, size, true);
    ch.setUint32(24, size, true); ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + size;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  if (offset + cdSize + 22 > MAX_BYTES) throw new Error('the project exceeds 4 GB, the limit of a ZIP');
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return [...parts, ...central, new Uint8Array(end.buffer)];
}

export function makeZip(files: readonly ZipEntry[], date = new Date()): Uint8Array {
  const all = zipParts(files, date);
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}

/** The files of a ZIP archive, without the folders. Reads the files stored as they are and those
 *  compressed with deflate (the ZIPs made by File Explorer, the Finder, 7-Zip). */
export async function readZip(zip: Uint8Array): Promise<ZipEntry[]> {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const bad = (why: string) => new Error(`invalid ZIP archive: ${why}`);
  // the end of the central directory: at the end, before any comment (at most 64 KB)
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw bad('not a ZIP');
  const count = v.getUint16(end + 10, true);
  let p = v.getUint32(end + 16, true);
  if (count === 0xffff || p === 0xffffffff) throw new Error('ZIP64 archive (over 4 GB): not supported');
  const utf8 = new TextDecoder();
  const out: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > zip.length || v.getUint32(p, true) !== 0x02014b50) throw bad('damaged central directory');
    const flags = v.getUint16(p + 8, true), method = v.getUint16(p + 10, true), crc = v.getUint32(p + 16, true);
    const packed = v.getUint32(p + 20, true), size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = utf8.decode(zip.subarray(p + 46, p + 46 + nameLen)).replace(/\\/g, '/');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (flags & 1) throw new Error(`"${name}" is encrypted: it can't be read`);
    if (local + 30 > zip.length || v.getUint32(local, true) !== 0x04034b50) throw bad(`"${name}" can't be found`);
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = zip.subarray(start, start + packed);
    if (raw.length !== packed) throw bad(`"${name}" is truncated`);
    const data = method === 0 ? raw.slice() : method === 8 ? await inflate(raw) : null;
    if (!data) throw new Error(`"${name}" uses an unsupported compression (${method})`);
    if (data.length !== size || crc32(data) !== crc) throw bad(`"${name}" is damaged`);
    out.push({ name, data });
  }
  return out;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
