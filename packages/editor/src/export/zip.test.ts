import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { MemoryFileSystem } from "../io/memoryFs";
import { projectFiles, saveProject } from "../io/projectIo";
import { sampleStore, BYTES } from "./testDoc";
import { crc32, projectZipEntries, zipCompressed, zipStore, type ZipEntry } from "./zip";

interface Parsed {
  name: string;
  flags: number;
  method: number;
  data: Uint8Array;
}

/** Tiny reader: EOCD -> central directory -> local headers -> contents. */
function readZip(zip: Uint8Array): Parsed[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  expect(view.getUint32(eocd, true)).toBe(0x06054b50);
  const count = view.getUint16(eocd + 10, true);
  let pos = view.getUint32(eocd + 16, true);
  expect(view.getUint32(eocd + 12, true) + pos).toBe(eocd);
  const out: Parsed[] = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(pos, true)).toBe(0x02014b50);
    const flags = view.getUint16(pos + 8, true);
    const method = view.getUint16(pos + 10, true);
    const crc = view.getUint32(pos + 16, true);
    const csize = view.getUint32(pos + 20, true);
    const usize = view.getUint32(pos + 24, true);
    const nameLen = view.getUint16(pos + 28, true);
    const local = view.getUint32(pos + 42, true);
    const name = new TextDecoder().decode(zip.subarray(pos + 46, pos + 46 + nameLen));
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    expect(view.getUint16(local + 6, true)).toBe(flags);
    const lnLen = view.getUint16(local + 26, true);
    const start = local + 30 + lnLen + view.getUint16(local + 28, true);
    const raw = zip.subarray(start, start + csize);
    const data = method === 8 ? new Uint8Array(inflateRawSync(raw)) : raw.slice();
    expect(data.length).toBe(usize);
    expect(crc32(data)).toBe(crc);
    out.push({ name, flags, method, data });
    pos += 46 + nameLen;
  }
  return out;
}

const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe("crc32", () => {
  it("matches known vectors", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(crc32(new TextEncoder().encode("a"))).toBe(0xe8b7be43);
  });
});

describe("zipStore", () => {
  const entries: ZipEntry[] = [
    { path: "tilesets/b.png", data: new Uint8Array([1, 2, 3, 255]) },
    { path: "levels/" },
    { path: "project.smap", data: '{"a":1}' },
    { path: "levels/main.json", data: "{}" },
  ];

  it("round-trips through a reader, sorted by path", () => {
    const parsed = readZip(zipStore(entries));
    expect(parsed.map((p) => p.name)).toEqual(["levels/", "levels/main.json", "project.smap", "tilesets/b.png"]);
    expect(parsed.every((p) => p.method === 0)).toBe(true);
    expect(text(parsed[2]!.data)).toBe('{"a":1}');
    expect([...parsed[3]!.data]).toEqual([1, 2, 3, 255]);
    expect(parsed[0]!.data.length).toBe(0);
  });

  it("is deterministic regardless of input order", () => {
    expect(zipStore(entries)).toEqual(zipStore([...entries].reverse()));
  });

  it("sets the UTF-8 flag and keeps Turkish names", () => {
    const names = ["tilesets/çalı.png", "levels/şehir ışığı.json"];
    const parsed = readZip(zipStore(names.map((path) => ({ path, data: "x" }))));
    expect(parsed.map((p) => p.name).sort()).toEqual([...names].sort());
    for (const p of parsed) expect(p.flags & 0x0800).toBe(0x0800);
  });
});

describe("zipCompressed", () => {
  it("deflates compressible entries and reads back", async () => {
    const big = "tile,".repeat(500);
    const zip = await zipCompressed([{ path: "a.json", data: big }, { path: "b.bin", data: new Uint8Array([1, 2, 3]) }]);
    const parsed = readZip(zip);
    expect(text(parsed[0]!.data)).toBe(big);
    if (typeof CompressionStream !== "undefined") {
      expect(parsed[0]!.method).toBe(8);
      expect(zip.length).toBeLessThan(big.length);
    }
    expect(parsed[1]!.method).toBe(0);
  });
});

describe("project zip", () => {
  it("holds the same files as a save, plus folders, and no backups", async () => {
    const { store } = sampleStore();
    const input = {
      name: "Proje",
      document: store.document,
      levelPath: "levels/main.json",
      tilesetBytes: (id: string) => BYTES[id],
    };
    const fs = new MemoryFileSystem();
    await saveProject(fs, input);
    const files = [...projectFiles(input), { path: "backups/old.json", data: "x" }];
    const parsed = readZip(zipStore(projectZipEntries(files)));
    const names = parsed.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(["levels/", "tilesets/", "stamps/", "levels/main.json", "project.smap"]));
    expect(names.some((n) => n.startsWith("backups"))).toBe(false);
    for (const [path, bytes] of fs.files) {
      expect(parsed.find((p) => p.name === path)?.data, path).toEqual(bytes);
    }
  });
});
