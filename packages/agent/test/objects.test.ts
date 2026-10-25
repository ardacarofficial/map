import { describe, expect, it } from "vitest";
import type { AgentObjectsPort, DetectObjectsRequest, SuggestStampsArgs } from "../src/objects";
import type { AgentReferencePort } from "../src/vision";
import { error, harness, stamp, success } from "./helpers";

const references = { list: () => [{ referenceId: "ref-1", name: "Köy", width: 64, height: 64, origin: "user" as const }] } as unknown as AgentReferencePort;
function objects(detects: DetectObjectsRequest[], suggests: SuggestStampsArgs[]): AgentObjectsPort {
  return {
    detect: async args => {
      detects.push(args);
      return { data: { mapId: args.mapId, referenceId: args.referenceId, alignment: { cellPx: 32, scale: 1, offsetX: 0, offsetY: 0, cols: 16, rows: 16, confidence: 0, method: "auto" }, matches: [{ stampId: "house", x: 1, y: 2, score: 0.93, pixelResidual: { dx: 0, dy: 0 } }], positionsByStamp: { house: [[1, 2]] }, truncated: false, warnings: [], mapRevision: 0 } };
    },
    suggest: async args => { suggests.push(args); return { data: { tilesetId: args.tilesetId, candidates: [], truncated: false, skipped: { tooLarge: 0, opaque: 0 } } }; },
  };
}

describe("object tools", () => {
  it("explain missing hosts, unknown pictures, stamps and tilesets before searching", async () => {
    const h = harness({ stamps: [stamp] });
    error(await h.run("reference_detect_objects", { referenceId: "ref-1", mapId: "map-1" }), "EDITOR_UNAVAILABLE");
    error(await h.run("suggest_stamps", { tilesetId: "tiles" }), "EDITOR_UNAVAILABLE");
    const detects: DetectObjectsRequest[] = [], suggests: SuggestStampsArgs[] = [];
    h.host.references = references;
    h.host.objects = objects(detects, suggests);
    expect((await h.run("reference_detect_objects", { referenceId: "nope", mapId: "map-1" })).structuredContent).toMatchObject({ ok: false, code: "UNKNOWN_ID", details: { validIds: ["ref-1"] } });
    expect((await h.run("reference_detect_objects", { referenceId: "ref-1", mapId: "map-1", stampIds: ["barn"] })).structuredContent).toMatchObject({ ok: false, code: "UNKNOWN_ID", details: { stampId: "barn" } });
    error(await h.run("suggest_stamps", { tilesetId: "nope" }), "UNKNOWN_ID");
    error(await h.run("suggest_stamps", { tilesetId: "tiles", region: { x: 6, y: 0, width: 4, height: 1 } }), "OUT_OF_BOUNDS");
    expect(detects).toEqual([]);
    expect(suggests).toEqual([]);
  });

  it("searches every stamp by default (mapId defaults to the only map) and passes alignment through", async () => {
    const h = harness({ stamps: [stamp, { ...stamp, id: "barn", name: "Barn" }] });
    const detects: DetectObjectsRequest[] = [], suggests: SuggestStampsArgs[] = [];
    h.host.references = references;
    h.host.objects = objects(detects, suggests);
    const out = success(await h.run("reference_detect_objects", { referenceId: "ref-1" }));
    expect(out.data).toMatchObject({ matches: [{ stampId: "house", x: 1, y: 2 }], positionsByStamp: { house: [[1, 2]] } });
    expect(detects[0]).toMatchObject({ mapId: "map-1", stampIds: ["house", "barn"] });
    const alignment = { cellPx: 64, scale: 2, offsetX: -3, offsetY: 5.5, cols: 8, rows: 8, confidence: 0.7, method: "manual" };
    success(await h.run("reference_detect_objects", { referenceId: "ref-1", stampIds: ["barn"], alignment, minScore: 0.9 }));
    expect(detects[1]).toMatchObject({ stampIds: ["barn"], alignment, minScore: 0.9 });
    success(await h.run("suggest_stamps", { tilesetId: "tiles", region: { x: 0, y: 0, width: 8, height: 2 } }));
    expect(suggests[0]).toMatchObject({ tilesetId: "tiles", region: { x: 0, y: 0, width: 8, height: 2 } });
  });

  it("needs stamps to look for and searches at most 64 per call", async () => {
    const empty = harness();
    empty.host.references = references;
    empty.host.objects = objects([], []);
    error(await empty.run("reference_detect_objects", { referenceId: "ref-1" }), "INVALID_ARGUMENT");
    const many = harness({ stamps: Array.from({ length: 65 }, (_, i) => ({ ...stamp, id: `s${i}`, name: `S${i}` })) });
    many.host.references = references;
    many.host.objects = objects([], []);
    error(await many.run("reference_detect_objects", { referenceId: "ref-1" }), "LIMIT_EXCEEDED");
    success(await many.run("reference_detect_objects", { referenceId: "ref-1", stampIds: ["s0", "s64"] }));
  });
});
