/** Immutable bake provenance, using the existing v3 stamp codec. Never a map-cell or prefab link. */
import { parseStamp, serializeClip, stampTilesetUsage, type Stamp, type Tileset } from "@smap/core";
import { FileNotFoundError, type ProjectFileSystem } from "./fs";
export interface GeneratedRecipe { readonly tilesetId: string; readonly stamp: Stamp }
export const generatedRecipePath = (tilesetId: string): string => `tilesets/${tilesetId}.recipe.json`;
export function sameBakeRecipe(a: Stamp, b: Stamp): boolean { return (a.nineSlice?.border ?? 1) === (b.nineSlice?.border ?? 1) && serializeClip(a) === serializeClip(b); }
export async function loadGeneratedRecipes(fs: ProjectFileSystem, assets: readonly Tileset[], stamps: readonly Stamp[], broken: string[] = []): Promise<GeneratedRecipe[]> {
  const recipes: GeneratedRecipe[] = [];
  for (const asset of assets) {
    if (!asset.generated) continue;
    try {
      const stamp = parseStamp(await fs.readText(generatedRecipePath(asset.id)), assets);
      if (stamp.id !== asset.generated.stampId || stamp.width !== asset.generated.sourceWidth || stamp.height !== asset.generated.sourceHeight || !stamp.layers.some(l => l.layerId === asset.generated!.layerId)) throw new Error("Generated recipe provenance does not match its atlas");
      recipes.push({ tilesetId: asset.id, stamp });
    }
    catch (error) {
      if (!(error instanceof FileNotFoundError)) { broken.push(generatedRecipePath(asset.id)); continue; } // Early v3 bakes have no sidecar; the unchanged library recipe remains a compatible fallback.
      const stamp = stamps.find(s => s.id === asset.generated!.stampId);
      if (stamp) recipes.push({ tilesetId: asset.id, stamp });
    }
  }
  return recipes;
}

/** Distinct library/archived stamp recipes affected by removal, including inner art
 * and generated banks that depend on another generated bank. Ignore orphan sidecars. */
export function affectedTilesetStamps(tilesetId: string, stamps: readonly Stamp[], recipes: readonly GeneratedRecipe[], tilesets: readonly Tileset[]): string[] {
  const missing = new Set([tilesetId]), affected = new Set<string>();
  let grew: boolean;
  do {
    grew = false;
    for (const asset of tilesets) if (asset.generated && (missing.has(asset.id) || asset.generated.sources.some(s => missing.has(s.tilesetId)))) {
      affected.add(asset.generated.stampId);
      if (!missing.has(asset.id)) { missing.add(asset.id); grew = true; }
    }
  } while (grew);
  const retainedRecipes = recipes.filter(r => tilesets.some(ts => ts.id === r.tilesetId));
  for (const stamp of [...stamps, ...retainedRecipes.map(r => r.stamp)]) {
    if ([...missing].some(id => {
      const usage = stampTilesetUsage(stamp, id);
      return usage.cells > 0 || usage.bakedLayers.length > 0 || usage.road;
    })) affected.add(stamp.id);
  }
  return [...affected].sort();
}
