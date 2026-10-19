import type { FileData } from "../io/fileData";
/**
 * Minimal ZIP writer. Pure TypeScript, no dependencies.
 *
 * Output is deterministic: entries are sorted by path, timestamps are fixed
 * at 1980-01-01 00:00, names are UTF-8 (general purpose bit 11). `zipStore`
 * writes uncompressed (STORE) entries; `zipCompressed` deflates entries with
 * the browser's `CompressionStream('deflate-raw')` when it exists and the
 * result is smaller, otherwise it falls back to STORE.
 */

export interface ZipEntry {
  /** `/`-separated path. A trailing `/` makes a folder entry (data ignored). */
  readonly path: string;
  readonly data?: string | Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3), as an unsigned 32-bit number. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** 1980-01-01 in DOS date format; time 00:00. */
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const DOS_TIME = 0;
const FLAG_UTF8 = 0x0800;
const VERSION = 20;

interface Prepared {
  name: Uint8Array;
  method: 0 | 8;
  crc: number;
  size: number;
  body: Uint8Array;
  offset: number;
  dir: boolean;
}

const encoder = new TextEncoder();

function normalize(entries: readonly ZipEntry[]): { path: string; bytes: Uint8Array; dir: boolean }[] {
  const byPath = new Map<string, { path: string; bytes: Uint8Array; dir: boolean }>();
  for (const entry of entries) {
    const path = entry.path.replace(/^\/+/, "");
    if (path === "") continue;
    const dir = path.endsWith("/");
    const raw = entry.data ?? new Uint8Array(0);
    const bytes = dir ? new Uint8Array(0) : typeof raw === "string" ? encoder.encode(raw) : raw;
    byPath.set(path, { path, bytes, dir });
  }
  // A folder entry sorts before the files inside it ("a/" < "a/b").
  return [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function assemble(items: Prepared[]): Uint8Array {
  let total = 22;
  for (const it of items) total += 30 + it.name.length + it.body.length + 46 + it.name.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let pos = 0;
  for (const it of items) {
    it.offset = pos;
    view.setUint32(pos, 0x04034b50, true);
    view.setUint16(pos + 4, VERSION, true);
    view.setUint16(pos + 6, FLAG_UTF8, true);
    view.setUint16(pos + 8, it.method, true);
    view.setUint16(pos + 10, DOS_TIME, true);
    view.setUint16(pos + 12, DOS_DATE, true);
    view.setUint32(pos + 14, it.crc, true);
    view.setUint32(pos + 18, it.body.length, true);
    view.setUint32(pos + 22, it.size, true);
    view.setUint16(pos + 26, it.name.length, true);
    view.setUint16(pos + 28, 0, true);
    out.set(it.name, pos + 30);
    out.set(it.body, pos + 30 + it.name.length);
    pos += 30 + it.name.length + it.body.length;
  }
  const cdStart = pos;
  for (const it of items) {
    view.setUint32(pos, 0x02014b50, true);
    view.setUint16(pos + 4, (3 << 8) | VERSION, true); // made by: Unix
    view.setUint16(pos + 6, VERSION, true);
    view.setUint16(pos + 8, FLAG_UTF8, true);
    view.setUint16(pos + 10, it.method, true);
    view.setUint16(pos + 12, DOS_TIME, true);
    view.setUint16(pos + 14, DOS_DATE, true);
    view.setUint32(pos + 16, it.crc, true);
    view.setUint32(pos + 20, it.body.length, true);
    view.setUint32(pos + 24, it.size, true);
    view.setUint16(pos + 28, it.name.length, true);
    view.setUint16(pos + 30, 0, true); // extra
    view.setUint16(pos + 32, 0, true); // comment
    view.setUint16(pos + 34, 0, true); // disk
    view.setUint16(pos + 36, 0, true); // internal attrs
    view.setUint32(pos + 38, (it.dir ? 0o40755 : 0o100644) * 0x10000 + (it.dir ? 0x10 : 0), true);
    view.setUint32(pos + 42, it.offset, true);
    out.set(it.name, pos + 46);
    pos += 46 + it.name.length;
  }
  view.setUint32(pos, 0x06054b50, true);
  view.setUint16(pos + 4, 0, true);
  view.setUint16(pos + 6, 0, true);
  view.setUint16(pos + 8, items.length, true);
  view.setUint16(pos + 10, items.length, true);
  view.setUint32(pos + 12, pos - cdStart, true);
  view.setUint32(pos + 16, cdStart, true);
  view.setUint16(pos + 20, 0, true);
  return out;
}

function prepareStore(entries: readonly ZipEntry[]): Prepared[] {
  return normalize(entries).map((e) => ({
    name: encoder.encode(e.path),
    method: 0,
    crc: e.dir ? 0 : crc32(e.bytes),
    size: e.bytes.length,
    body: e.bytes,
    offset: 0,
    dir: e.dir,
  }));
}

/** Zip with every entry stored uncompressed. Deterministic. */
export function zipStore(entries: readonly ZipEntry[]): Uint8Array {
  return assemble(prepareStore(entries));
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Zip with DEFLATE where `CompressionStream` is available and it helps (PNGs
 * usually do not shrink and stay stored). Falls back to `zipStore`.
 */
export async function zipCompressed(entries: readonly ZipEntry[]): Promise<Uint8Array> {
  const items = prepareStore(entries);
  if (typeof CompressionStream === "undefined") return assemble(items);
  try {
    for (const it of items) {
      if (it.dir || it.size < 64) continue;
      const packed = await deflateRaw(it.body);
      if (packed.length < it.size) {
        it.method = 8;
        it.body = packed;
      }
    }
  } catch {
    return zipStore(entries);
  }
  return assemble(items);
}

/** Folders a project zip always contains (backups/ is never exported). */
const PROJECT_ZIP_DIRS = ["levels/", "tilesets/", "stamps/"];

/**
 * Entries of a project zip: the project's files plus `levels/`, `tilesets/`,
 * `stamps/` and any other parent folder of a file. Files under `backups/`
 * are dropped.
 */
export function projectZipEntries(files: readonly { path: string; data: FileData }[]): ZipEntry[] {
  const kept = files.filter((f) => f.path !== "backups" && !f.path.startsWith("backups/"));
  const dirs = new Set(PROJECT_ZIP_DIRS);
  for (const file of kept) {
    const parts = file.path.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(`${parts.slice(0, i).join("/")}/`);
  }
  return [...[...dirs].map((path) => ({ path })), ...kept.map(file => {
    if (typeof file.data === "function") throw new Error("ZIP requires materialized file data");
    return { path: file.path, data: file.data };
  })];
}
