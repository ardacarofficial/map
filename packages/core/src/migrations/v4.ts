/** Raw JSON migration: disk tile cells always win. Never derive cells or collision. */
import { buildLayout1RoadProfile, normalizeRoadProfile, roadProfileProblem, type RoadProfile } from "../smartStamp/roadProfile";
type Json = Record<string, unknown>;
const object = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

function legacyProfile(tileset: Json, setId?: unknown, terrainId?: unknown): RoadProfile | undefined {
  if (Array.isArray(tileset.terrainSets)) for (const set of tileset.terrainSets) {
    if (!object(set) || set.kind !== "blob" || (setId !== undefined && set.id !== setId) || !Array.isArray(set.tiles)) continue;
    const families = terrainId === undefined ? [...new Set(set.tiles.filter(object).map(t => t.terrainId))] : [terrainId];
    for (const family of families) {
      const profile = { tiles: set.tiles.filter(object).filter(t => t.terrainId === family).map(t => ({ tileId: t.tileId as number, mask: t.mask as number })) };
      if (!roadProfileProblem(profile)) return normalizeRoadProfile(profile);
    }
  }
  return undefined;
}

/** Nonmutating and idempotent. Optional project tilesets preserve custom legacy smart variants in sidecar stamps. */
export function migrateV4(input: Json, projectTilesets: readonly Json[] = []): Json {
  if (typeof input.documentFormatVersion !== "number" || input.documentFormatVersion >= 4) return input;
  const version = input.documentFormatVersion;
  const tilesets = Array.isArray(input.tilesets) ? input.tilesets.filter(object) : projectTilesets;
  const root: Json = { ...input, documentFormatVersion: 4 };
  if (Array.isArray(input.tilesets)) root.tilesets = input.tilesets.map(item => {
    if (!object(item)) return item;
    const t = item;
    const { terrains: _a, terrainSets: _b, solidTiles: _c, ...next } = t;
    if (version < 3) delete next.generated;
    if (object(next.generated)) {
      const g = next.generated;
      const profile = legacyProfile(t);
      if (profile) next.roadProfile = profile;
      else if (g.layoutVersion === 1 && typeof g.sourceWidth === "number" && typeof g.sourceHeight === "number") next.roadProfile = buildLayout1RoadProfile(g.sourceWidth, g.sourceHeight);
    }
    return next;
  });
  if (Array.isArray(input.layers)) root.layers = input.layers.filter(l => !object(l) || l.role !== "terrain" || (l.type !== "grid" && l.grid !== true));
  if (version < 3) delete root.nineSlice;
  else if (object(input.nineSlice)) {
    const meta = { ...input.nineSlice };
    const retained = new Set(Array.isArray(root.layers) ? root.layers.filter(object).map(l => l.layerId) : []);
    if (Array.isArray(meta.tileLayers)) meta.tileLayers = meta.tileLayers.filter(l => !object(l) || retained.has(l.layerId));
    if (object(meta.road)) {
      const old = meta.road;
      if (typeof old.tilesetId !== "string" || !old.tilesetId || typeof old.setId !== "string" || !old.setId || typeof old.terrainId !== "number" || !Number.isInteger(old.terrainId) || old.terrainId < 1 || old.terrainId > 255) throw new Error("nineSlice road requires legacy baked tileset, set and family identifiers");
      const t = tilesets.find(t => t.id === old.tilesetId);
      const profile = t && (legacyProfile(t, old.setId, old.terrainId) ?? (object(t.roadProfile) ? t.roadProfile as unknown as RoadProfile : undefined));
      meta.road = { tilesetId: old.tilesetId, profile: profile ?? buildLayout1RoadProfile(input.width as number, input.height as number) };
    }
    root.nineSlice = meta;
  }
  if (Array.isArray(input.generatedRecipes)) root.generatedRecipes = input.generatedRecipes.map(r => object(r) ? migrateV4(r, tilesets) : r);
  return root;
}
