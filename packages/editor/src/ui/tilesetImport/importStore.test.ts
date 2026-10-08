import { describe, expect, it } from "vitest";

import { draftFromSpec } from "./importModel";
import { openTilesetCard, tilesetCardOpen, useTilesetCard, type CardRequest } from "./importStore";

const request = (fileName: string): CardRequest => ({
  mode: { kind: "add" },
  fileName,
  bitmap: {} as ImageBitmap,
  width: 32,
  height: 32,
  alpha: null,
  initial: draftFromSpec(fileName, { tileWidth: 16, tileHeight: 16, margin: 0, spacing: 0 }),
  suggestions: [],
  mapTile: { tileWidth: 32, tileHeight: 32 },
});

describe("tileset card queue", () => {
  it("shows one card at a time and resolves each with its choice", async () => {
    const first = openTilesetCard(request("a.png"));
    const second = openTilesetCard(request("b.png"));
    await Promise.resolve();
    expect(useTilesetCard.getState().request?.fileName).toBe("a.png");
    expect(tilesetCardOpen()).toBe(true);
    useTilesetCard.getState().close({ kind: "confirm", name: "A", spec: { tileWidth: 16, tileHeight: 16, margin: 0, spacing: 0 } });
    expect(await first).toMatchObject({ kind: "confirm", name: "A" });
    await Promise.resolve();
    await Promise.resolve();
    expect(useTilesetCard.getState().request?.fileName).toBe("b.png");
    useTilesetCard.getState().close(null);
    expect(await second).toBeNull();
    expect(tilesetCardOpen()).toBe(false);
  });
});
