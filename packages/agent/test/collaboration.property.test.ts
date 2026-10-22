import fc from "fast-check";
import { expect, it } from "vitest";
import { serializeLevel } from "@smap/core";
import { collaborationHarness } from "./collaborationTestHarness";

it("arbitrary interleaving and peer cancellation never changes the other member's claimed cells", async () => {
  await fc.assert(fc.asyncProperty(fc.array(fc.record({ client: fc.constantFrom("A", "B"), x: fc.integer({ min: 0, max: 3 }),
    y: fc.integer({ min: 0, max: 7 }), tileId: fc.integer({ min: 0, max: 63 }) }), { minLength: 2, maxLength: 24 }),
  fc.boolean(), async (operations, cancelPeer) => {
    const h = collaborationHarness(), baseline = serializeLevel(h.store.document);
    try {
      await h.begin(); await h.join();
      const expected = new Map<string, { tilesetId: string; tileId: number }>();
      for (const operation of operations) {
        const x = operation.x + (operation.client === "B" ? 4 : 0);
        await h.paint(operation.client, x, operation.y, operation.tileId);
        expected.set(`${x},${operation.y}`, { tilesetId: "tiles", tileId: operation.tileId });
      }
      if (cancelPeer) {
        await h.ok("B", "cancel_edit", { reason: "Property cancellation" });
        for (const key of [...expected.keys()]) if (Number(key.split(",")[0]) >= 4) expected.delete(key);
      }
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const tile = expected.get(`${x},${y}`), value = h.cell(x, y);
        if (!tile) expect(value).toBe(0);
        else expect(h.store.document.palette.get(value & 0x1fffffff)).toMatchObject(tile);
      }
      const combined = serializeLevel(h.store.document);
      await h.api.userAction("approve");
      if (h.host.history.undoDepth) {
        h.host.history.undo(); expect(serializeLevel(h.store.document)).toBe(baseline);
        h.host.history.redo(); expect(serializeLevel(h.store.document)).toBe(combined);
      }
    } finally { await h.api.dispose(); }
  }), { numRuns: 30 });
});
