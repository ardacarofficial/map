import {
  cellFlags,
  cellPaletteIndex,
  isValidTileId,
  rasterContentHash,
  type Stamp,
  type Tileset,
} from "@smap/core";
import {
  AGENT_LIMITS as L,
  AgentErrorCode as E,
  type TagTarget,
  type TagsAvailability,
  type TagsSidecar,
} from "./contracts";
import { canonicalJson } from "./toolSchemas";
import { check } from "./validation";

export function utf8(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of text) {
    let c = char.codePointAt(0)!;
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
    if (c < 128) bytes.push(c);
    else if (c < 2048) bytes.push(192 | (c >> 6), 128 | (c & 63));
    else if (c < 65536)
      bytes.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
    else
      bytes.push(
        240 | (c >> 18),
        128 | ((c >> 12) & 63),
        128 | ((c >> 6) & 63),
        128 | (c & 63),
      );
  }
  return new Uint8Array(bytes);
}
export const compareCodeUnits = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;
export function normalizeTags(tags: readonly string[]): string[] {
  const result = [...new Set(tags.map((t) => t.trim().normalize("NFC")))];
  check(
    result.length <= L.tagWords &&
      result.every((t) => t.length >= 1 && t.length <= L.tagWordLength),
    E.INVALID_ARGUMENT,
    "Invalid tag words",
  );
  return result.sort(compareCodeUnits);
}
/** Search folding is deliberately separate from persisted tag spelling. */
export function normalizeSemanticText(value: string): string {
  return value.normalize("NFKD").toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i").replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
// A small bilingual vocabulary, limited to common map objects/materials.
const semanticAliases: readonly (readonly string[])[] = [
  ["agac", "tree", "trees"], ["ev", "house", "houses"],
  ["yol", "road", "roads", "path"], ["su", "water"],
  ["cimen", "grass"], ["tas", "stone", "rock"],
  ["cali", "bush", "bushes"], ["kapi", "door", "doors"],
  ["merdiven", "stairs", "stair", "steps"], ["cati", "roof"],
];
export function semanticMatches(query: string | undefined, values: readonly string[]): boolean {
  if (!query?.trim()) return true;
  const text = normalizeSemanticText(values.join(" "));
  const words = new Set(text.split(" "));
  return normalizeSemanticText(query).split(" ").filter(Boolean).every(term => {
    const aliases = semanticAliases.find(group => group.includes(term));
    return aliases ? aliases.some(alias => words.has(alias)) : text.includes(term);
  });
}
export const emptyTags = (): TagsSidecar => ({
  format: "smap-ai-tags",
  tagFormatVersion: 1,
  tiles: [],
  stamps: [],
});
export function tagKey(target: TagTarget): string {
  return canonicalJson(target);
}
export function serializeTags(sidecar: TagsSidecar): string {
  const normalized: TagsSidecar = {
    format: "smap-ai-tags",
    tagFormatVersion: 1,
    tiles: [...sidecar.tiles]
      .sort(
        (a, b) =>
          compareCodeUnits(a.tilesetId, b.tilesetId) || a.tileId - b.tileId,
      )
      .map((e) => ({
        tilesetId: e.tilesetId,
        tileId: e.tileId,
        fingerprint: e.fingerprint,
        tags: normalizeTags(e.tags),
        note: e.note,
      })),
    stamps: [...sidecar.stamps]
      .sort((a, b) => compareCodeUnits(a.stampId, b.stampId))
      .map((e) => ({
        stampId: e.stampId,
        fingerprint: e.fingerprint,
        tags: normalizeTags(e.tags),
        note: e.note,
      })),
  };
  const text = JSON.stringify(normalized, null, 2) + "\n";
  check(
    utf8(text).length <= L.tagsFileBytes,
    E.LIMIT_EXCEEDED,
    "Tags sidecar exceeds size limit",
  );
  return text;
}
function exact(
  value: unknown,
  keys: string[],
): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((k) => Object.hasOwn(value, k))
  );
}
function id(v: unknown): v is string {
  return typeof v === "string" && v.length >= 1 && v.length <= 128;
}
export function parseTags(text: string | null): TagsAvailability {
  if (text === null) return { state: "ready", sidecar: emptyTags() };
  if (utf8(text).length > L.tagsFileBytes)
    return {
      state: "unavailable",
      reason: "oversized",
      detail: "Tags file exceeds size limit",
    };
  try {
    const value: unknown = JSON.parse(text);
    if (
      value &&
      typeof value === "object" &&
      "tagFormatVersion" in value &&
      typeof value.tagFormatVersion === "number" &&
      value.tagFormatVersion > 1
    )
      return {
        state: "unavailable",
        reason: "futureVersion",
        detail: "Unsupported tags version",
      };
    check(
      exact(value, ["format", "tagFormatVersion", "tiles", "stamps"]) &&
        value.format === "smap-ai-tags" &&
        value.tagFormatVersion === 1 &&
        Array.isArray(value.tiles) &&
        Array.isArray(value.stamps),
      E.INVALID_ARGUMENT,
      "Invalid tags root",
    );
    const tiles = value.tiles as unknown[],
      stamps = value.stamps as unknown[];
    check(
      tiles.length <= L.tileTagRecords && stamps.length <= L.stampTagRecords,
      E.LIMIT_EXCEEDED,
      "Too many tag records",
    );
    const seen = new Set<string>();
    for (const [kind, records] of [
      ["tile", tiles],
      ["stamp", stamps],
    ] as const)
      for (const e of records) {
        check(
          exact(
            e,
            kind === "tile"
              ? ["tilesetId", "tileId", "fingerprint", "tags", "note"]
              : ["stampId", "fingerprint", "tags", "note"],
          ),
          E.INVALID_ARGUMENT,
          "Invalid tag record",
        );
        check(
          kind === "tile"
            ? id(e.tilesetId) &&
                Number.isSafeInteger(e.tileId) &&
                (e.tileId as number) >= 0 &&
                (e.tileId as number) <= 0xffffffff
            : id(e.stampId),
          E.INVALID_ARGUMENT,
          "Invalid tag target",
        );
        check(
          typeof e.fingerprint === "string" &&
            /^[a-f0-9]{64}$/.test(e.fingerprint) &&
            Array.isArray(e.tags) &&
            e.tags.every((t) => typeof t === "string") &&
            e.tags.length <= L.tagWords &&
            typeof e.note === "string" &&
            e.note.length <= 256,
          E.INVALID_ARGUMENT,
          "Invalid tag content",
        );
        normalizeTags(e.tags as string[]);
        const key =
          kind === "tile"
            ? JSON.stringify([kind, e.tilesetId, e.tileId])
            : JSON.stringify([kind, e.stampId]);
        check(!seen.has(key), E.INVALID_ARGUMENT, "Duplicate tag target");
        seen.add(key);
      }
    const sidecar = value as unknown as TagsSidecar;
    return {
      state: "ready",
      sidecar: JSON.parse(serializeTags(sidecar)) as TagsSidecar,
    };
  } catch {
    return {
      state: "unavailable",
      reason: "malformed",
      detail: "Malformed tags sidecar",
    };
  }
}
export function tileFingerprint(
  tileset: Tileset,
  tileId: number,
  nativeRgba: Uint8Array,
): string {
  check(isValidTileId(tileset, tileId), E.UNKNOWN_ID, "Unknown tile");
  return hashCanonical([
    "tile-v1",
    tileset.tileWidth,
    tileset.tileHeight,
    tileset.columns,
    tileset.rows,
    tileset.margin,
    tileset.spacing,
    tileId,
    rasterContentHash(tileset.tileWidth, tileset.tileHeight, nativeRgba),
  ]);
}
export async function stampFingerprint(
  stamp: Stamp,
  fingerprint: (tilesetId: string, tileId: number) => Promise<string>,
): Promise<string> {
  const refs = new Map<string, Promise<string>>();
  const layers = [];
  for (const layer of stamp.layers) {
    const cells = [];
    for (const cell of layer.cells) {
      if (layer.grid || !cell) {
        cells.push(cell);
        continue;
      }
      const ref = stamp.palette[cellPaletteIndex(cell) - 1];
      check(ref, E.UNKNOWN_ID, "Stamp references missing palette entry");
      const key = JSON.stringify([ref.tilesetId, ref.tileId]);
      if (!refs.has(key)) refs.set(key, fingerprint(ref.tilesetId, ref.tileId));
      cells.push([
        ref.tilesetId,
        ref.tileId,
        cellFlags(cell),
        await refs.get(key)!,
      ]);
    }
    layers.push([
      layer.layerId,
      layer.grid ? "grid" : "tile",
      layer.role ?? null,
      cells,
    ]);
  }
  return hashCanonical(["stamp-v1", stamp.width, stamp.height, layers]);
}
export const hashCanonical = (value: unknown): string =>
  sha256(utf8(canonicalJson(value)));

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotr = (n: number, k: number): number => (n >>> k) | (n << (32 - k));
function sha256(bytes: Uint8Array): string {
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 128;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bytes.length * 8);
  view.setUint32(padded.length - 8, Math.floor(bytes.length / 0x20000000));
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  for (let start = 0; start < padded.length; start += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(start + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]!,
        y = w[i - 2]!;
      w[i] =
        w[i - 16]! +
        (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) +
        w[i - 7]! +
        (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10));
    }
    let [a, b, c, d, e, f, g, j] = [...h] as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    for (let i = 0; i < 64; i++) {
      const t1 =
        (j +
          (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) +
          ((e & f) ^ (~e & g)) +
          K[i]! +
          w[i]!) >>>
        0;
      const t2 =
        ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) +
          ((a & b) ^ (a & c) ^ (b & c))) >>>
        0;
      j = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    const state = [a, b, c, d, e, f, g, j];
    for (let i = 0; i < 8; i++) h[i] = h[i]! + state[i]!;
  }
  return [...h].map((n) => n.toString(16).padStart(8, "0")).join("");
}
