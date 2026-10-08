import { createDocument, makeCell, MapStore, type TileClip, type Tileset } from "@smap/core";
import { beforeEach, describe, expect, it } from "vitest";

import { useEditorStore } from "../../state/editorStore";
import { useUiStore } from "../uiStore";
import { pickRecentTile, recentStampLabel, stampAnchorTile } from "./recentTiles";

function openProject() {
  const store = new MapStore(createDocument({ width: 8, height: 8, tileWidth: 16, tileHeight: 16 }));
  const ts: Tileset = { id: "ts", name: "ts", imagePath: "tilesets/ts.png", tileWidth: 16, tileHeight: 16, columns: 4, rows: 4, margin: 0, spacing: 0 };
  store.dispatch({ type: "addTileset", tileset: ts });
  store.dispatch({ type: "addLayer", layer: { name: "Zemin" } });
  useEditorStore.getState().setProject({ name: "p", store, levelPath: "levels/main.json" });
}

describe("recent tiles strip click", () => {
  beforeEach(openProject);

  it("makes the tile the brush: selection set, stamp and random set cleared, brush tool, its tileset shown", () => {
    const ed = useEditorStore.getState();
    ed.setTool("fill");
    ed.setStamp({ width: 1, height: 1, palette: [], layers: [] });
    ed.setRandomSet([
      { tilesetId: "ts", tileId: 1 },
      { tilesetId: "ts", tileId: 2 },
    ]);
    useUiStore.getState().setActiveTileset(null);

    expect(pickRecentTile({ tilesetId: "ts", tileId: 5 })).toBe(true);
    const s = useEditorStore.getState();
    expect(s.selection).toEqual({ tilesetId: "ts", tileId: 5 });
    expect(s.stamp).toBeNull();
    expect(s.randomSet).toEqual([]);
    expect(s.tool).toBe("brush");
    expect(useUiStore.getState().activeTilesetId).toBe("ts");
  });

  it("ignores tiles of a tileset that is gone", () => {
    useEditorStore.getState().setSelection({ tilesetId: "ts", tileId: 1 });
    expect(pickRecentTile({ tilesetId: "missing", tileId: 3 })).toBe(false);
    expect(useEditorStore.getState().selection).toEqual({ tilesetId: "ts", tileId: 1 });
  });
});

describe("recent stamp label", () => {
  beforeEach(openProject);

  const clip = (cells: number[], palette: TileClip["palette"], extra: Partial<TileClip> = {}): TileClip => ({
    width: 3,
    height: 3,
    palette,
    layers: [{ layerId: "l", name: "Zemin", cells: Uint32Array.from(cells) }],
    ...extra,
  });

  it("names the anchor tile (first non-empty cell, row-major) so same-sized stamps differ", () => {
    const doc = useEditorStore.getState().project!.store.document;
    const a = clip([makeCell(1), makeCell(2), 0, 0, 0, 0, 0, 0, 0], [{ tilesetId: "ts", tileId: 12 }, { tilesetId: "ts", tileId: 13 }]);
    const b = clip([0, makeCell(1, 0x8000_0000), 0, 0, 0, 0, 0, 0, 0], [{ tilesetId: "ts", tileId: 4 }]);
    expect(stampAnchorTile(a)).toEqual({ tilesetId: "ts", tileId: 12 });
    expect(recentStampLabel(doc, a)).toBe("ts · 3×3 @ 12");
    expect(recentStampLabel(doc, b)).toBe("ts · 3×3 @ 4");
    expect(recentStampLabel(doc, a)).not.toBe(recentStampLabel(doc, b));
  });

  it("skips grid layers, keeps saved names, falls back without tiles or tileset", () => {
    const doc = useEditorStore.getState().project!.store.document;
    const gridOnly: TileClip = { width: 2, height: 1, palette: [], layers: [{ layerId: "g", name: "Collision", cells: Uint32Array.from([1, 1]), grid: true }] };
    expect(stampAnchorTile(gridOnly)).toBeNull();
    expect(recentStampLabel(doc, gridOnly)).toBe("Stamp · 2×1");
    const named = { ...clip([makeCell(1), 0, 0, 0, 0, 0, 0, 0, 0], [{ tilesetId: "ts", tileId: 1 }]), name: "Ev" };
    expect(recentStampLabel(doc, named)).toBe("Ev · 3×3");
    const orphan = clip([makeCell(1), 0, 0, 0, 0, 0, 0, 0, 0], [{ tilesetId: "gone", tileId: 1 }]);
    expect(recentStampLabel(doc, orphan)).toBe("Stamp · 3×3");
  });
});
