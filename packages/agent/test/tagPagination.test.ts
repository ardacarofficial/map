import { expect, it } from "vitest";
import { emptyTags, serializeTags } from "../src/tags";
import { CallSignal } from "../src/transactions";
import { error, harness, success } from "./helpers";

it("binds unqueried tag pagination to its filters instead of skipping the first missing tile", async () => {
  const h = harness();
  const expectedFingerprint = await h.host.images.tileFingerprint("tiles", 0, new CallSignal());
  success(await h.run("set_tags", {
    context: { ...h.context(), idempotencyKey: "tag-first-tile" },
    entries: [{ target: { kind: "tile", tilesetId: "tiles", tileId: 0 }, expectedFingerprint, tags: ["grass"] }],
  }));
  const first = success(await h.read("get_tags", { status: "all", limit: 1 }));
  expect(first.data).toMatchObject({ items: [{ target: { tileId: 0 }, status: "current" }] });
  if (!("nextCursor" in first.data)) throw new Error("Expected tag page");
  error(await h.read("get_tags", { status: "missing", limit: 1, cursor: first.data.nextCursor }), "INVALID_ARGUMENT");
  const missing = success(await h.read("get_tags", { status: "missing", limit: 1 }));
  expect(missing.data).toMatchObject({ items: [{ target: { tileId: 1 } }] });
});

it("continues unchanged unqueried tag pages and rejects a page after tag metadata changes", async () => {
  const h = harness();
  const first = success(await h.read("get_tags", { status: "all", limit: 1 }));
  if (!("nextCursor" in first.data)) throw new Error("Expected tag page");
  const cursor = first.data.nextCursor;
  const second = success(await h.read("get_tags", { status: "all", limit: 1, cursor }));
  expect(second.data).toMatchObject({ items: [{ target: { tileId: 1 } }] });
  const tags = emptyTags();
  tags.tiles = [{ tilesetId: "tiles", tileId: 0, fingerprint: "a".repeat(64), tags: ["changed"], note: "" }];
  h.host.loadTags(serializeTags(tags));
  error(await h.read("get_tags", { status: "all", limit: 1, cursor }), "INVALID_ARGUMENT");
});

it("rejects an unqueried tags cursor after the world revision changes", async () => {
  const h = harness();
  const first = success(await h.read("get_tags", { status: "all", limit: 1 }));
  if (!("nextCursor" in first.data)) throw new Error("Expected tag page");
  h.host.contentChanged();
  error(await h.read("get_tags", { status: "all", limit: 1, cursor: first.data.nextCursor }), "REVISION_CONFLICT");
});

for (const query of [undefined, "grass"])
  it(`rejects tags changed during an awaited ${query ? "semantic" : "unqueried"} page read`, async () => {
    const h = harness(), tags = emptyTags();
    tags.tiles = [0, 1].map(tileId => ({ tilesetId: "tiles", tileId, fingerprint: "a".repeat(64), tags: ["grass"], note: "" }));
    h.host.loadTags(serializeTags(tags));
    const get = h.host.tags.get;
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    h.host.tags.get = async (...args) => {
      const page = await get(...args);
      entered();
      await gate;
      return page;
    };
    const pending = h.read("get_tags", { status: "all", limit: 1, ...(query ? { query } : {}) });
    await started;
    tags.tiles[0]!.tags = ["changed"];
    h.host.loadTags(serializeTags(tags));
    release();
    error(await pending, "REVISION_CONFLICT");
  });
