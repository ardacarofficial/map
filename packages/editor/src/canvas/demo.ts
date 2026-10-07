/**
 * TEMPORARY harness for the map canvas (`/canvas-demo.html` in vite dev).
 * Not part of the app; safe to delete once the UI mounts the canvas.
 */
import { MapStore, createDocument, makeCell } from "@smap/core";

import tilesetUrl from "../../../../samples/tilesets/overworld-32.png?url";
import { useEditorStore } from "../state/editorStore";
import { setTilesetImage } from "../state/tilesetImages";
import { mountCanvas, type CanvasHandle } from "./index";

async function main(): Promise<void> {
  const doc = createDocument({
    width: 100,
    height: 80,
    tilesets: [
      {
        id: "overworld",
        name: "overworld",
        imagePath: "tilesets/overworld-32.png",
        tileWidth: 32,
        tileHeight: 32,
        columns: 8,
        rows: 8,
        margin: 0,
        spacing: 0,
      },
    ],
  });
  const store = new MapStore(doc);
  const layerId = store.dispatch({ type: "addLayer", layer: { name: "Ground" } });

  // Some content: a grass field with every tile of the set in the corner.
  const grass = store.getOrAddPaletteIndex("overworld", 0);
  const cells = [];
  for (let y = 0; y < 40; y++) for (let x = 0; x < 50; x++) cells.push({ x, y, cell: makeCell(grass) });
  for (let id = 0; id < 64; id++) {
    const p = store.getOrAddPaletteIndex("overworld", id);
    cells.push({ x: 2 + (id % 8), y: 2 + Math.floor(id / 8), cell: makeCell(p) });
  }
  store.dispatch({ type: "paintCells", layerId, cells });

  useEditorStore.getState().setProject({ name: "demo", store, levelPath: "levels/main.json" });
  useEditorStore.getState().setSelection({ tilesetId: "overworld", tileId: 9 });

  const container = document.getElementById("stage")!;
  const handle: CanvasHandle = await mountCanvas(container);

  // Image arrives after mount (exercises the late-atlas path).
  const bytes = new Uint8Array(await (await fetch(tilesetUrl)).arrayBuffer());
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
  setTilesetImage({ tilesetId: "overworld", bitmap, bytes });

  (window as unknown as { __demo: unknown }).__demo = {
    store,
    layerId,
    handle,
    editor: useEditorStore,
    mountCanvas,
    container,
    ready: true,
  };
}

void main();
