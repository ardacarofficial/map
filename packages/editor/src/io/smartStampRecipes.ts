/** Immutable bake provenance, using the existing v3 stamp codec. Never a map-cell or prefab link. */
import { parseStamp, serializeClip, type Stamp, type Tileset } from "@smap/core";
import { FileNotFoundError, type ProjectFileSystem } from "./fs";
export interface GeneratedRecipe { readonly tilesetId: string; readonly stamp: Stamp }
export const generatedRecipePath = (tilesetId: string): string => `tilesets/${tilesetId}.recipe.json`;
export function sameBakeRecipe(a: Stamp, b: Stamp): boolean { return serializeClip(a) === serializeClip(b); }
export async function loadGeneratedRecipes(fs: ProjectFileSystem, assets: readonly Tileset[], stamps: readonly Stamp[], broken: string[] = []): Promise<GeneratedRecipe[]> {
  const recipes: GeneratedRecipe[] = [];
  for (const asset of assets) {
    if (!asset.generated) continue;
    try {
      const stamp = parseStamp(await fs.readText(generatedRecipePath(asset.id)));
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
