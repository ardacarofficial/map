/**
 * Multi-layer stamps (v0.6): a named, saved selection of every layer of an
 * area (ground, walls, roof, collision…) that is placed with one click.
 *
 * A stamp is a flat copy: placing it pastes its cells into the map and keeps
 * no link back to the stamp (CLAUDE.md → Yapılmayacaklar: no live or nested
 * prefabs). Stamps are saved one per file as `stamps/<id>.json`
 * (`serializeStamp` / `parseStamp`).
 *
 * Layer matching when placing (see {@link stampLayerMapping}):
 * 1. a layer of the same kind (tile / grid with the same role) with the same
 *    name; each map layer receives at most one stamp layer;
 * 2. otherwise, by kind: when exactly one unmatched map layer of that kind
 *    (tile layer, or grid layer with the same role) is left, that one;
 * 3. otherwise a new layer with the stamp layer's name is created in the
 *    same undo step (tile layer, or grid layer with the stamp layer's role),
 *    right above the map layer the previous stamp layer went to.
 * Entity layers never receive stamp cells.
 */
import { copyRegion, flipClip, pasteClip, type ClipLayer, type PasteOptions, type TileClip } from "./clip";
import type { MapDocument } from "./document";
import { isReservedFileName } from "./fileName";
import type { CellRect } from "./geometry";
import { isEntityLayer, isGridLayer, type GridRole, type TileLayer } from "./layer";
import type { LayerPatch } from "./ops";
import type { MapStore } from "./store";

/** A saved multi-layer clip. */
export interface Stamp extends TileClip {
  /** File-name-safe id (`stamps/<id>.json`); see {@link stampIdProblem}. */
  readonly id: string;
  /** Display name. */
  readonly name: string;
}

/** Folder of stamp files inside a project. */
export const STAMPS_DIR = "stamps";

const STAMP_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * Why `id` cannot be a stamp id (lowercase `a-z0-9_-`, starts with a letter
 * or digit, ≤ 64 chars, not a Windows device name such as `con` or `com1`:
 * `stamps/con.json` cannot be created on Windows), or `null`.
 */
export function stampIdProblem(id: unknown): string | null {
  if (typeof id !== "string" || !STAMP_ID_RE.test(id)) {
    return `stamp id must be 1–64 characters of a-z, 0-9, "_" or "-" starting with a letter or digit, got ${JSON.stringify(id)}`;
  }
  if (isReservedFileName(id)) return `stamp id ${JSON.stringify(id)} is a reserved file name on Windows`;
  return null;
}

/**
 * Project-relative path of a stamp file: `stamps/<id>.json`.
 * @throws Error when `id` is not a valid stamp id ({@link stampIdProblem}),
 * so no unsafe file name is ever built.
 */
export function stampPath(id: string): string {
  const problem = stampIdProblem(id);
  if (problem) throw new Error(`stampPath: ${problem}`);
  return `${STAMPS_DIR}/${id}.json`;
}

const TRANSLIT: Readonly<Record<string, string>> = { ç: "c", ğ: "g", ı: "i", İ: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };

/**
 * A stamp id derived from a display name ("Büyük Ev" → `"buyuk-ev"`),
 * made unique against `taken` with `-2`, `-3`…; `"stamp"` when nothing usable is left.
 * Windows device names are never returned (`"Con"` → `"con-2"`), so the id
 * always passes {@link stampIdProblem}.
 */
export function makeStampId(name: string, taken: Iterable<string> = []): string {
  const used = new Set(taken);
  const slug =
    [...name]
      .map((ch) => TRANSLIT[ch] ?? TRANSLIT[ch.toLowerCase()] ?? ch.toLowerCase())
      .join("")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 56)
      .replace(/-+$/, "") || "stamp";
  if (!used.has(slug) && !isReservedFileName(slug)) return slug;
  for (let n = 2; ; n++) {
    const id = `${slug}-${n}`;
    if (!used.has(id)) return id;
  }
}

/**
 * Saves `rect` of the given layers (tile and grid layers; entity layers are
 * skipped) as a stamp. Same rules as `copyRegion`.
 * @throws Error on an invalid id, an unknown layer or an invalid rectangle.
 */
export function createStamp(
  doc: MapDocument,
  layerIds: readonly string[],
  rect: CellRect,
  meta: { readonly id: string; readonly name: string },
): Stamp {
  const problem = stampIdProblem(meta.id);
  if (problem) throw new Error(`createStamp: ${problem}`);
  const clip = copyRegion(doc, layerIds, rect);
  return Object.freeze({ id: meta.id, name: meta.name, ...clip });
}

/** Where one stamp layer goes: an existing layer id, or `null` = a new layer is created. */
export interface StampLayerTarget {
  readonly clipLayerId: string;
  readonly name: string;
  readonly targetLayerId: string | null;
}

/** Layer matching for placing `stamp` into `doc` (see the module doc), in stamp layer order. */
export function stampLayerMapping(doc: MapDocument, stamp: TileClip): StampLayerTarget[] {
  const used = new Set<string>();
  const result: (string | null)[] = stamp.layers.map(() => null);
  const fits = (clip: ClipLayer, layer: TileLayer) => {
    if (isEntityLayer(layer)) return false;
    if (!clip.grid) return !isGridLayer(layer);
    return isGridLayer(layer) && (clip.role === undefined || layer.role === clip.role);
  };
  stamp.layers.forEach((clip, i) => {
    const match = doc.layers.find((l) => !used.has(l.id) && fits(clip, l) && l.name === clip.name);
    if (match) {
      used.add(match.id);
      result[i] = match.id;
    }
  });
  stamp.layers.forEach((clip, i) => {
    if (result[i] !== null) return;
    const left = doc.layers.filter((l) => !used.has(l.id) && fits(clip, l));
    if (left.length === 1) {
      used.add(left[0]!.id);
      result[i] = left[0]!.id;
    }
  });
  return stamp.layers.map((clip, i) => ({ clipLayerId: clip.layerId, name: clip.name, targetLayerId: result[i]! }));
}

export interface PlaceStampOptions extends PasteOptions {
  /** Mirror before placing (`x`: left/right, `y`: top/bottom). */
  readonly flip?: { readonly x?: boolean; readonly y?: boolean };
}

export interface PlaceStampResult {
  /** Cell patches of the layers that changed. */
  readonly patches: LayerPatch[];
  /** Ids of the layers created for unmatched stamp layers, in stamp order. */
  readonly createdLayerIds: string[];
  /** Stamp layer id → map layer id it was placed into. */
  readonly layerMapping: ReadonlyMap<string, string>;
}

/**
 * Places `stamp` with its top-left corner at cell (`x`, `y`) as one undo
 * step (layers created for it included; nested into an open transaction
 * if there is one). Palette indices are remapped and flip flags kept, as
 * with `pasteClip`; cells outside the map and on locked layers are skipped.
 * On an error outside a transaction nothing stays changed (except palette
 * entries, which are never undone); inside one, the caller decides
 * (`rollback()`).
 */
export function placeStamp(store: MapStore, stamp: TileClip, x: number, y: number, options: PlaceStampOptions = {}): PlaceStampResult {
  let clip: TileClip = stamp;
  if (options.flip?.x) clip = flipClip(clip, "x");
  if (options.flip?.y) clip = flipClip(clip, "y");
  const plan = stampLayerMapping(store.document, clip);
  const mapping = new Map<string, string>();
  const created: string[] = [];
  const nested = store.inTransaction;
  store.beginTransaction();
  try {
    let previous: string | null = null;
    plan.forEach((entry, i) => {
      let target = entry.targetLayerId;
      if (target === null) {
        const layer = clip.layers[i]!;
        const index = previous === null ? 0 : store.document.indexOfLayer(previous) + 1;
        const role: GridRole = layer.role ?? "terrain";
        target = store.dispatch({
          type: "addLayer",
          layer: layer.grid ? { name: layer.name, type: "grid", role } : { name: layer.name },
          index,
        });
        created.push(target);
      }
      mapping.set(entry.clipLayerId, target);
      previous = target;
    });
    const patches = pasteClip(store, clip, mapping, x, y, options);
    store.commit();
    return { patches, createdLayerIds: created, layerMapping: mapping };
  } catch (error) {
    if (nested) store.commit();
    else store.rollback();
    throw error;
  }
}
