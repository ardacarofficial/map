import { createDocument, MapStore } from "@smap/core";
import { describe, expect, it } from "vitest";

import { libraryTabsFor, registerLibraryTab, resolveLibraryTab } from "./LibraryPanel";

const store = new MapStore(createDocument({ width: 4, height: 4, tileWidth: 16, tileHeight: 16 }));
const entityLayer = store.document.getLayer(store.dispatch({ type: "addLayer", layer: { name: "Entity", type: "entity" } }));

describe("library tabs", () => {
  it("lists Stamp'ler; Entity only next to an entity layer", () => {
    expect(libraryTabsFor({ doc: undefined, layer: undefined }).map((t) => t.id)).toEqual(["stamps"]);
    const withEntity = libraryTabsFor({ doc: undefined, layer: entityLayer });
    expect(withEntity.map((t) => t.id)).toEqual(["stamps", "entities"]);
    expect(withEntity.find((t) => t.id === "entities")?.auto?.({ doc: undefined, layer: entityLayer })).toBe(true);
  });

  it("falls back to the first listed tab when the selected one is not listed", () => {
    const listed = libraryTabsFor({ doc: undefined, layer: undefined });
    expect(resolveLibraryTab("entities", listed)?.id).toBe("stamps");
    expect(resolveLibraryTab("stamps", listed)?.id).toBe("stamps");
  });

  it("accepts new tabs in order and removes them again", () => {
    const off = registerLibraryTab({ id: "terrain", label: "terrain.list", order: 15, Component: () => null });
    expect(libraryTabsFor({ doc: undefined, layer: undefined }).map((t) => t.id)).toEqual(["stamps", "terrain"]);
    off();
    expect(libraryTabsFor({ doc: undefined, layer: undefined }).map((t) => t.id)).toEqual(["stamps"]);
  });
});
