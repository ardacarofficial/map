// Regenerates the Tiled import fixtures (node e2e/fixtures/tiled/generate.mjs).
// village.tmx / village.tmj: 8×6 orthogonal map, 16 px tiles; external dungeon
// tileset (tsx / tsj) + embedded props tileset (animated tile); Ground (CSV),
// Decor (zlib / gzip Base64, all flip bits incl. diagonal, one unknown gid),
// group "Upper" with Roof (plain Base64), object layer "Spawns".
import { Buffer } from "node:buffer";
import { copyFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, gzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const W = 8, H = 6, H_ = 0x80000000, V_ = 0x40000000, D_ = 0x20000000;

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(pixel(x, y), y * (w * 4 + 1) + 1 + x * 4);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
// props-16.png: 4×2 tiles, each a distinct colour with an asymmetric marker (flips are visible).
const colours = [[200, 60, 60], [60, 160, 60], [60, 90, 200], [200, 180, 40], [160, 60, 200], [40, 180, 180], [220, 120, 40], [120, 120, 120]];
writeFileSync(join(here, "props-16.png"), png(64, 32, (x, y) => {
  const t = Math.floor(y / 16) * 4 + Math.floor(x / 16), lx = x % 16, ly = y % 16;
  if (lx < 4 && ly < 8) return [255, 255, 255, 255];
  return lx === ly ? [0, 0, 0, 0] : [...colours[t], 255];
}));
copyFileSync(join(here, "../../../samples/tilesets/dungeon-16.png"), join(here, "tilesets/dungeon-16.png"));

const ground = Array.from({ length: W * H }, (_, i) => 1 + ((i % W + Math.floor(i / W)) % 6));
const decor = new Array(W * H).fill(0);
const at = (x, y) => y * W + x;
decor[at(1, 1)] = 25; decor[at(2, 1)] = (26 | H_) >>> 0; decor[at(3, 1)] = (27 | V_) >>> 0; decor[at(4, 1)] = (28 | D_) >>> 0;
decor[at(5, 1)] = (29 | H_ | V_ | D_) >>> 0; decor[at(6, 2)] = (3 | H_) >>> 0; decor[at(7, 4)] = 999;
const roof = new Array(W * H).fill(0);
roof[at(0, 0)] = 30; roof[at(7, 5)] = (32 | V_) >>> 0;
const bytes = (gids) => { const b = Buffer.alloc(gids.length * 4); gids.forEach((g, i) => b.writeUInt32LE(g, i * 4)); return b; };
const csv = (gids) => gids.reduce((s, g, i) => s + g + (i < gids.length - 1 ? "," : "") + ((i + 1) % W === 0 ? "\n" : ""), "\n");

writeFileSync(join(here, "tilesets/dungeon.tsx"), `<?xml version="1.0" encoding="UTF-8"?>
<tileset version="1.10" tiledversion="1.10.2" name="Dungeon" tilewidth="16" tileheight="16" tilecount="24" columns="6">
 <image source="dungeon-16.png" width="96" height="64"/>
</tileset>
`);
writeFileSync(join(here, "tilesets/dungeon.tsj"), JSON.stringify({ columns: 6, image: "dungeon-16.png", imageheight: 64, imagewidth: 96, margin: 0, name: "Dungeon", spacing: 0, tilecount: 24, tiledversion: "1.10.2", tileheight: 16, tilewidth: 16, type: "tileset", version: "1.10" }, null, 1) + "\n");

writeFileSync(join(here, "village.tmx"), `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.10" tiledversion="1.10.2" orientation="orthogonal" renderorder="right-down" width="${W}" height="${H}" tilewidth="16" tileheight="16" infinite="0" nextlayerid="6" nextobjectid="2">
 <tileset firstgid="1" source="tilesets/dungeon.tsx"/>
 <tileset firstgid="25" name="Props &amp; Things" tilewidth="16" tileheight="16" tilecount="8" columns="4">
  <image source="props-16.png" width="64" height="32"/>
  <tile id="0">
   <animation>
    <frame tileid="0" duration="200"/>
    <frame tileid="1" duration="200"/>
   </animation>
  </tile>
 </tileset>
 <layer id="1" name="Ground" width="${W}" height="${H}">
  <data encoding="csv">${csv(ground)}</data>
 </layer>
 <layer id="2" name="Decor" width="${W}" height="${H}" opacity="0.5">
  <data encoding="base64" compression="zlib">
   ${deflateSync(bytes(decor)).toString("base64")}
  </data>
 </layer>
 <group id="3" name="Upper">
  <layer id="4" name="Roof" width="${W}" height="${H}" visible="0">
   <data encoding="base64">
    ${bytes(roof).toString("base64")}
   </data>
  </layer>
 </group>
 <objectgroup id="5" name="Spawns">
  <object id="1" name="player" x="16" y="16"/>
 </objectgroup>
</map>
`);

const layer = (id, name, extra) => ({ height: H, id, name, opacity: 1, type: "tilelayer", visible: true, width: W, x: 0, y: 0, ...extra });
writeFileSync(join(here, "village.tmj"), JSON.stringify({
  compressionlevel: -1, height: H, infinite: false, nextlayerid: 6, nextobjectid: 2, orientation: "orthogonal", renderorder: "right-down", tiledversion: "1.10.2", tileheight: 16, tilewidth: 16, type: "map", version: "1.10", width: W,
  layers: [
    layer(1, "Ground", { data: ground }),
    layer(2, "Decor", { data: gzipSync(bytes(decor)).toString("base64"), encoding: "base64", compression: "gzip", opacity: 0.5 }),
    { id: 3, name: "Upper", type: "group", opacity: 1, visible: true, x: 0, y: 0, layers: [layer(4, "Roof", { data: bytes(roof).toString("base64"), encoding: "base64", visible: false })] },
    { draworder: "topdown", id: 5, name: "Spawns", objects: [{ id: 1, name: "player", x: 16, y: 16, width: 0, height: 0, rotation: 0, type: "", visible: true }], opacity: 1, type: "objectgroup", visible: true, x: 0, y: 0 },
  ],
  tilesets: [
    { firstgid: 1, source: "tilesets/dungeon.tsj" },
    { columns: 4, firstgid: 25, image: "props-16.png", imageheight: 32, imagewidth: 64, margin: 0, name: "Props & Things", spacing: 0, tilecount: 8, tileheight: 16, tilewidth: 16, tiles: [{ id: 0, animation: [{ tileid: 0, duration: 200 }, { tileid: 1, duration: 200 }] }] },
  ],
}, null, 1) + "\n");
