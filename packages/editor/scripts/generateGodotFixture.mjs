/** Regenerate the pinned engine fixture from the production exporter; no listening server. */
import { Buffer } from "node:buffer";
import { argv } from "node:process";
import { log } from "node:console";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { createServer } from "vite";

const fixture = fileURLToPath(new URL("../../core/test/fixtures/godot/", import.meta.url));
const target = resolve(argv[2] ?? `${fixture}/project`);
function crc32(data) {
  let crc = 0xffffffff;
  for (const n of data) {
    crc ^= n;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const text = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([text, data])));
  return Buffer.concat([size, text, data, crc]);
}
function encodePng(width, height, pixel) {
  const rows = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rows.set(pixel(x, y), y * (1 + width * 4) + 1 + x * 4);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return new Uint8Array(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]));
}
const colors = [[255,0,0,255],[0,255,0,255],[0,0,255,255],[255,255,0,255]];
function png() {
  return encodePng(36, 36, (x,y) => x >= 19 && x < 35 && y >= 19 && y < 35
    ? colors[(x >= 27 ? 1 : 0) + (y >= 27 ? 2 : 0)] : [255,0,255,255]);
}
// Golden image uses explicit corner permutations, independent of production flags/encoding.
const corners = [[0,1,2,3],[1,0,3,2],[2,3,0,1],[3,2,1,0],[0,2,1,3],[2,0,3,1],[1,3,0,2],[3,1,2,0]];
const golden = encodePng(256, 64, (x,y) => y < 16 && x % 32 < 16
  ? colors[corners[Math.floor(x / 32)][(x % 32 >= 8 ? 1 : 0) + (y >= 8 ? 2 : 0)]] : [0,0,0,0]);

const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: "custom" });
try {
  const { godotFixture } = await server.ssrLoadModule(`${fixture}/input.ts`);
  const { exportGodot } = await server.ssrLoadModule(fileURLToPath(new URL("../../core/src/export/godot/index.ts", import.meta.url)));
  const { store } = godotFixture();
  const plan = exportGodot([{ doc: store.document, name: "fixture" }], () => png());
  for (const file of plan.files) {
    const path = resolve(target, file.path);
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(path, file.text ?? file.bytes);
  }
  await writeFile(resolve(target, "golden.png"), golden);
  await writeFile(resolve(target, "project.godot"), '[application]\nconfig/name="SMAP Godot export fixture"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\ntextures/default_filters/use_nearest_mipmap_filter=false\n');
  log(`Generated ${plan.files.length} exporter files in ${target}`);
} finally { await server.close(); }
