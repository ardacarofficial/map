import { createDocument, MapStore, type Tileset } from "@smap/core";
import { beforeEach, describe, expect, it } from "vitest";

import { useEditorStore } from "../../state/editorStore";
import { useUiStore } from "../uiStore";
import { pickRecentTile } from "./recentTiles";

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
