import { describe, expect, it } from "vitest";
import { createDocument, makeCell, MapStore } from "@smap/core";
import { defoldTarget } from "./defold";
import { t } from "../../i18n";
import { grass } from "../testDoc";

function input() {
  const store = new MapStore(createDocument({ width: 2, height: 2, tileWidth: 16, tileHeight: 16, tilesets: [grass] }));
  store.dispatch({ type: "addLayer", layer: { id: "ground", name: "Ground" } });
  store.dispatch({ type: "paintCells", layerId: "ground", cells: [{ x: 0, y: 0, cell: makeCell(store.getOrAddPaletteIndex(grass.id, 0)) }] });
  return { store, doc: store.document, levelName: "room", bytes: () => new Uint8Array([137, 80, 78, 71]) };
}

describe("Defold target plugin", () => {
  it("declares translated options, plans files with deferred PNGs and translates preflight failures", async () => {
    const source = input();
    expect(defoldTarget.id).toBe("defold");
    expect(t(defoldTarget.labelKey)).toBe("Defold");
    for (const option of defoldTarget.options) expect(t(option.labelKey)).not.toBe(option.labelKey);
    expect(defoldTarget.preflight(source, {})).toEqual([]);
    const files = await defoldTarget.planFiles({ ...source, bytes: () => async () => source.bytes() }, {});
    expect(files.some((file) => file.path === "exported/room/map.collection")).toBe(true);
    expect(files.find((file) => file.path.endsWith(".png"))?.data).toEqual(source.bytes());
    const problems = defoldTarget.preflight({ ...source, bytes: () => undefined }, {});
    expect(problems).toHaveLength(1);
    expect(problems[0]?.severity).toBe("error");
    expect(t(problems[0]!.key, problems[0]!.params)).toContain("Grass");
    await expect(defoldTarget.planFiles({ ...source, bytes: () => undefined }, {})).rejects.toThrow("Grass");
  });

  it("passes layer selection and collision options without exporting unselected unsupported layers", async () => {
    const source = input();
    source.store.dispatch({ type: "setLayerProps", layerId: "ground", props: { opacity: 0.5 } });
    expect(defoldTarget.preflight(source, {}).map((p) => p.key)).toContain("defoldExport.layerOpacity");
    expect(defoldTarget.preflight({ ...source, layers: [] }, {})).toEqual([]);
    const files = await defoldTarget.planFiles({ ...source, layers: [] }, { projectSubfolder: "/assets/maps", collision: false });
    expect(files.some((file) => file.path === "assets/maps/room/map.collection")).toBe(true);
    expect(files.some((file) => file.path.endsWith(".tilemap"))).toBe(false);
  });
});

it('namespaces duplicate, sanitized and Windows case-colliding names by stable map identity', async () => {
  const source = input();
  const paths: Set<string>[] = [];
  for (const [levelId, levelName] of [['a', 'Same'], ['b', 'Same'], ['A', 'same'], ['a-b', 'same?']] as const) {
    const files = await defoldTarget.planFiles({ ...source, levelId, levelName }, {});
    paths.push(new Set(files.map(f => f.path.toLowerCase())));
  }
  for (let i = 0; i < paths.length; i++) for (let j = 0; j < i; j++) expect([...paths[i]!].filter(p => paths[j]!.has(p))).toEqual([]);
});
