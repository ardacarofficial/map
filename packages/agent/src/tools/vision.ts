/** Agent side of the reference tools: validation, layer/legend/stamp resolution, host dispatch. */
import { cellFlags, cellPaletteIndex, isGridLayer, isEntityLayer, isValidTileId } from "@smap/core";
import { AgentErrorCode as E, type AgentCallContext, type Id, type Tile, type ToolArguments } from "../contracts";
import type { AgentReferencePort, LegendRandom, ReferenceQuantizeRequest, ResolvedLegendEntry, ResolvedStampProbe, VisionToolName } from "../vision";
import { REFERENCE_LIMITS } from "../vision";
import { type Transactions, waitFor } from "../transactions";
import { check, rect } from "../validation";
import { semanticMatches } from "../tags";
import { compactFlags, layer } from "./mutations";
import { storeFor, type ReadOutput } from "./read";
import { parseHexColor, type ProposalCell } from "./quantize";

export const REFERENCE_VIEW_DEFAULTS = { fit: "stretch", maxSide: 1536 } as const;

function port(tx: Transactions): AgentReferencePort {
  const references = tx.host.references;
  check(references, E.EDITOR_UNAVAILABLE, "Reference images are unavailable in this host", { nextAction: "Use render_preview and get_tile_catalog instead; this editor build has no reference intake." });
  return references;
}
function known(tx: Transactions, referenceId: Id): void {
  const list = port(tx).list();
  check(list.some(r => r.referenceId === referenceId), E.UNKNOWN_ID, "Unknown referenceId", {
    validIds: list.map(r => r.referenceId),
    nextAction: list.length ? "Use a referenceId from get_session.references." : "Ask the user to drop the picture onto the AI activity panel (Referans ekle), or call reference_add with a local image path.",
  });
}
function tile(tx: Transactions, value: Tile, where: string): Required<Tile> {
  const ts = tx.host.world.tilesets().find(t => t.id === value.tilesetId);
  check(ts && isValidTileId(ts, value.tileId), E.UNKNOWN_ID, `Unknown tile in ${where}`, { tilesetId: value.tilesetId, tileId: value.tileId });
  return { tilesetId: value.tilesetId, tileId: value.tileId, flags: value.flags ?? 0 };
}
const cell = (t: Required<Tile>): ProposalCell => t.flags ? { tilesetId: t.tilesetId, tileId: t.tileId, flags: t.flags } : { tilesetId: t.tilesetId, tileId: t.tileId };
const randomKey = (t: Tile) => `${t.tilesetId}\u0000${t.tileId}\u0000${t.flags ?? 0}`;
const isTile = (v: unknown): v is Tile => typeof v === "object" && v !== null && "tilesetId" in v && "tileId" in v;

/** A tag word resolves to the tile carrying it most specifically (fewest tags), then lowest id. */
function tagTile(tx: Transactions, word: string): Required<Tile> | undefined {
  const tags = tx.host.tags.availability();
  if (tags.state !== "ready") return undefined;
  const hits = tags.sidecar.tiles.filter(r => semanticMatches(word, r.tags) && tx.host.world.tilesets().some(t => t.id === r.tilesetId && isValidTileId(t, r.tileId)));
  hits.sort((a, b) => a.tags.length - b.tags.length || (a.tilesetId < b.tilesetId ? -1 : a.tilesetId > b.tilesetId ? 1 : a.tileId - b.tileId));
  return hits[0] ? { tilesetId: hits[0].tilesetId, tileId: hits[0].tileId, flags: 0 } : undefined;
}
/** Legend value after {random} stand-ins were substituted. */
type PlainLegendValue = Tile | null | "keep" | string | { stampId: Id; ground?: Tile | null } | { overlay: Tile; ground?: Tile | null };
function legendEntry(tx: Transactions, hex: string, value: PlainLegendValue): ResolvedLegendEntry {
  const rgb = parseHexColor(hex);
  check(rgb, E.INVALID_ARGUMENT, "colorLegend keys must be #rgb or #rrggbb colours", { key: hex });
  const label = typeof value === "string" ? value : value === null ? "erase" : isTile(value) ? `${value.tilesetId}:${value.tileId}` : "stampId" in value ? value.stampId : `overlay ${value.overlay.tilesetId}:${value.overlay.tileId}`;
  if (value === null) return { hex, label, cell: null };
  if (value === "keep") return { hex, label, cell: "keep" };
  if (typeof value === "string") {
    const found = tagTile(tx, value);
    check(found, E.INVALID_ARGUMENT, `No tile is tagged "${value}"`, { key: hex, nextAction: "Map this colour to an explicit {tilesetId,tileId} from get_tile_catalog, or tag a tile with set_tags first." });
    return { hex, label, cell: cell(found) };
  }
  if (isTile(value)) return { hex, label, cell: cell(tile(tx, value, `colorLegend ${hex}`)) };
  if ("stampId" in value) {
    check(tx.host.world.stamps().some(s => s.id === value.stampId), E.UNKNOWN_ID, "Unknown stamp in colorLegend", { key: hex, validIds: tx.host.world.stamps().map(s => s.id).slice(0, 64) });
    return { hex, label, stampId: value.stampId, ...(value.ground !== undefined ? { cell: value.ground === null ? null : cell(tile(tx, value.ground, `colorLegend ${hex}`)) } : {}) };
  }
  return { hex, label, overlay: cell(tile(tx, value.overlay, `colorLegend ${hex}`)), ...(value.ground !== undefined ? { cell: value.ground === null ? null : cell(tile(tx, value.ground, `colorLegend ${hex}`)) } : {}) };
}
/** Topmost non-empty tile of every stamp cell (tile layers only). */
function probe(tx: Transactions, stampId: Id): ResolvedStampProbe | undefined {
  const s = tx.host.world.stamps().find(stamp => stamp.id === stampId);
  if (!s) return undefined;
  const cells = new Map<number, Required<Tile>>();
  for (const l of s.layers) {
    if (l.grid) continue;
    for (let i = 0; i < l.cells.length; i++) {
      const value = l.cells[i]!, index = cellPaletteIndex(value), entry = s.palette[index - 1];
      if (index && entry) cells.set(i, { tilesetId: entry.tilesetId, tileId: entry.tileId, flags: compactFlags(cellFlags(value)) as Required<Tile>["flags"] });
    }
  }
  return { stampId: s.id, name: s.name, width: s.width, height: s.height, cells: [...cells].map(([i, t]) => ({ x: i % s.width, y: Math.floor(i / s.width), tile: t })) };
}

export async function vision(tx: Transactions, name: VisionToolName, args: ToolArguments[VisionToolName], call: AgentCallContext): Promise<ReadOutput> {
  const references = port(tx);
  switch (name) {
    case "reference_add": {
      const a = args as ToolArguments["reference_add"];
      const sources = [a.path, a.imageBase64, a.selectedReferenceToken].filter(v => v !== undefined).length;
      check(sources === 1, E.INVALID_ARGUMENT, "Give exactly one of path, imageBase64 or selectedReferenceToken", { nextAction: "Prefer path: an absolute local .png/.jpg/.jpeg/.webp file the user mentioned." });
      if (a.path !== undefined) {
        const lower = a.path.toLowerCase();
        check(REFERENCE_LIMITS.extensions.some(ext => lower.endsWith(ext)), E.INVALID_ARGUMENT, "Only .png, .jpg, .jpeg and .webp images can be added", { cause: "unsupportedType" });
      }
      return { data: await waitFor(references.add(a, call), call.signal) };
    }
    case "reference_view": {
      const a = args as ToolArguments["reference_view"];
      known(tx, a.referenceId);
      const store = await storeFor(tx, a.mapId, call);
      if (a.region) rect(store, a.region);
      const out = await waitFor(references.view(a, call), call.signal);
      return { data: out.data, ...(out.image ? { image: out.image } : {}) };
    }
    case "reference_quantize": {
      const a = args as ToolArguments["reference_quantize"];
      known(tx, a.referenceId);
      const store = await storeFor(tx, a.mapId, call), doc = store.document;
      const region = a.region ?? { x: 0, y: 0, width: doc.map.width, height: doc.map.height };
      rect(store, region);
      check(region.width * region.height <= REFERENCE_LIMITS.quantizeCells, E.LIMIT_EXCEEDED, "Quantize at most 65536 cells per call", { nextAction: "Split the map into regions and call reference_quantize per region." });
      const tileLayers = doc.layers.filter(l => !isGridLayer(l) && !isEntityLayer(l));
      const visible = tileLayers.filter(l => l.visible);
      let ground = a.layers?.ground ? layer(store, a.layers.ground) : visible[0];
      check(ground, E.INVALID_ARGUMENT, "The map has no visible tile layer for the ground proposal", { nextAction: "Create a tile layer with edit_layer, or pass layers.ground." });
      check(!isGridLayer(ground) && !isEntityLayer(ground), E.INVALID_ARGUMENT, "layers.ground must be a tile layer");
      const overlay = a.layers?.overlay === null ? undefined : a.layers?.overlay ? layer(store, a.layers.overlay) : visible[visible.indexOf(ground) + 1];
      if (overlay) check(!isGridLayer(overlay) && !isEntityLayer(overlay) && overlay.id !== ground.id, E.INVALID_ARGUMENT, "layers.overlay must be another tile layer");
      ground = ground!;
      const tilesets = tx.host.world.tilesets();
      if (a.candidates?.tilesetIds) for (const id of a.candidates.tilesetIds) check(tilesets.some(t => t.id === id), E.UNKNOWN_ID, "Unknown tileset in candidates", { tilesetId: id, validIds: tilesets.map(t => t.id) });
      if (a.candidates?.tiles) for (const t of a.candidates.tiles) tile(tx, t, "candidates.tiles");
      // {random} legend values: the host matches with the heaviest tile; the proposal legend gets the random entry back.
      const randoms = new Map<string, LegendRandom>();
      const stand = (r: LegendRandom, hex: string): Tile => {
        check(r.random.length > 0 && r.random.every(isTile), E.INVALID_ARGUMENT, `colorLegend ${hex}: random needs tiles`);
        for (const t of r.random) tile(tx, t, `colorLegend ${hex}`);
        const main = r.random.reduce((best, t) => (t.weight ?? 1) > (best.weight ?? 1) ? t : best);
        const placeholder = { tilesetId: main.tilesetId, tileId: main.tileId, flags: main.flags ?? 0 };
        randoms.set(randomKey(placeholder), r);
        return placeholder;
      };
      const isRandom = (v: unknown): v is LegendRandom => typeof v === "object" && v !== null && "random" in v && Array.isArray((v as LegendRandom).random);
      const legend = Object.entries(a.colorLegend ?? {}).map(([hex, value]) => legendEntry(tx, hex,
        (isRandom(value) ? stand(value, hex)
          : value && typeof value === "object" && "ground" in value && isRandom(value.ground) ? { ...value, ground: stand(value.ground, hex) }
            : value) as PlainLegendValue));
      check(legend.length <= REFERENCE_LIMITS.legendColors, E.LIMIT_EXCEEDED, "At most 32 colorLegend entries");
      if (a.candidates?.stamps) for (const id of a.candidates.stamps) check(tx.host.world.stamps().some(s => s.id === id), E.UNKNOWN_ID, "Unknown stamp in candidates", { stampId: id });
      const stampIds = new Set([...(a.candidates?.stamps ?? tx.host.world.stamps().map(s => s.id)), ...legend.flatMap(l => l.stampId ? [l.stampId] : [])]);
      const probes = [...stampIds].flatMap(id => { const p = probe(tx, id); return p ? [p] : []; });
      const request: ReferenceQuantizeRequest = { ...a, region, legend, probes, groundLayer: { id: ground.id, name: ground.name }, overlayLayer: overlay ? { id: overlay.id, name: overlay.name } : null };
      const out = await waitFor(references.quantize(request, call), call.signal);
      if (randoms.size) for (const l of out.data.grid.layers) for (const [symbol, value] of Object.entries(l.legend))
        if (isTile(value) && !("random" in value)) { const r = randoms.get(randomKey(value)); if (r) l.legend[symbol] = r; }
      if (out.data.mode === "sketch" && !legend.length)
        out.data.warnings = [...(out.data.warnings ?? []), "Sketch without colorLegend: each colour got its nearest flat tile. Call again with colorLegend mapping every palette hex to a tile, {random:[...]} for ground, or {stampId} for houses/trees/bridges."];
      const proposalId = tx.keepProposal(out.data.mapId, out.data.grid.layers);
      return { data: { proposalId, ...out.data }, ...(out.image ? { image: out.image } : {}) };
    }
    case "render_compare": {
      const a = args as ToolArguments["render_compare"];
      check((a.referenceId === undefined) !== (a.baseline === undefined), E.INVALID_ARGUMENT, "Give exactly one of referenceId or baseline", { nextAction: "Use referenceId to compare with the user's picture, or baseline:\"draftStart\" to see what your edit changed." });
      if (a.referenceId) known(tx, a.referenceId);
      if (a.baseline) check(tx.pending, E.INVALID_ARGUMENT, "baseline:\"draftStart\" needs a pending edit", { nextAction: "Call begin_edit first, or compare against a referenceId." });
      const store = await storeFor(tx, a.mapId, call);
      if (a.region) rect(store, a.region);
      if (a.layerIds) for (const id of a.layerIds) layer(store, id);
      const out = await waitFor(references.compare(a, call), call.signal);
      return { data: out.data, ...(out.image ? { image: out.image } : {}) };
    }
  }
}
