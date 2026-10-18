import { describe, expect, it } from "vitest";
import { decidePick, pickLayer, type LayerInfo } from "./tools";
const layer = (id: string, value: number, props = {}): LayerInfo => ({ id, visible: true, locked: false, grid: false, getCell: () => value, ...props });
describe("layer-aware pick", () => {
  it("defaults to the topmost visible non-empty tile even above a populated active layer", () => {
    const layers = [layer("ground", 1), layer("roof", 2, { locked: true }), layer("hidden", 3, { visible: false }), layer("empty", 0)];
    expect(pickLayer(layers, "ground", 0, 0)?.id).toBe("roof");
    expect(decidePick(layers, "ground", { x: 0, y: 0, width: 1, height: 1 }, i => ({ tilesetId: "t", tileId: i }))).toEqual({ kind: "tile", layerId: "roof", entry: { tilesetId: "t", tileId: 2 } });
  });
  it("active scope never falls back and area picks keep their active-layer source", () => {
    expect(pickLayer([layer("ground", 0), layer("roof", 2)], "ground", 0, 0, "active")).toBeNull();
    expect(pickLayer([layer("ground", 1), layer("roof", 2)], "ground", 0, 0, "active")?.id).toBe("ground");
    expect(decidePick([layer("ground", 1), layer("roof", 2)], "ground", { x: 0, y: 0, width: 2, height: 2 }, () => undefined)).toMatchObject({ kind: "clip", layerId: "ground" });
  });
});
