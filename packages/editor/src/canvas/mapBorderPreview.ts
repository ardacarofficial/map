import type { SmartStampPlan } from "@smap/core";
import { borderPlan, useMapBorder } from "../commands/mapBorder";
import type { OverlayHost } from "./overlayRenderer";

/** Shares the exact cell plan with Apply and uses the existing smart preview masking/atlas path. */
export function drawMapBorderPreview(host: OverlayHost): boolean {
  const draft = useMapBorder.getState().draft, scene = host.scene;
  if (!draft || !scene || scene.store !== draft.store) return false;
  const result = borderPlan(draft), v = host.visible;
  const plan: SmartStampPlan = { revision: scene.store.revision, windowed: true, layers: [{
    sourceLayerId: "map-border", layerId: result.layerId, name: "", grid: false,
    writes: result.cells.filter(p => p.x >= v.x && p.y >= v.y && p.x < v.x + v.width && p.y < v.y + v.height).map(p => ({ x: p.x, y: p.y, tile: p.entry, flags: p.flags })),
  }] };
  scene.setSmartPreview(plan, `border:${result.id}:${scene.atlasVersion}:${v.x},${v.y},${v.width},${v.height}`);
  return true;
}
