/** Deterministic Round 2 negative PNGs. Run from the worktree root. */
import { Buffer } from "node:buffer";
import { createServer } from "../../packages/editor/node_modules/vite/dist/node/index.js";
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath, URL } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const server = await createServer({ root, configFile: false, logLevel: "silent", optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true } });
const crc = bytes => { let n = -1; for (const byte of bytes) { n ^= byte; for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0); } return (n ^ -1) >>> 0; };
const chunk = (type, body) => { const data = Buffer.concat([Buffer.from(type), body]), length = Buffer.alloc(4), end = Buffer.alloc(4); length.writeUInt32BE(body.length); end.writeUInt32BE(crc(data)); return Buffer.concat([length, data, end]); };
try {
  const { boundaryArt } = await server.ssrLoadModule(root + "/packages/core/test/smartStampBoundaryArt.ts");
  for (const size of [16, 32]) for (const [material, seed] of [["stone", 1], ["plank", 3], ["grass", 7]]) {
    const { width, height, data } = boundaryArt(seed, 6, 6, size, material, 0, 0, { col: 2, row: 1, columns: 12, rows: 8 }).pixels;
    const head = Buffer.alloc(13); head.writeUInt32BE(width); head.writeUInt32BE(height, 4); head[8] = 8; head[9] = 6;
    const rows = []; for (let y = 0; y < height; y++) rows.push(Buffer.from([0]), Buffer.from(data.subarray(y * width * 4, (y + 1) * width * 4)));
    writeFileSync(`${root}/e2e/fixtures/smart-road-${size}-material-${material}.png`, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]));
  }
} finally { await server.close(); }
