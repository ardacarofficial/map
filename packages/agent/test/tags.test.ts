import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { rasterContentHash } from "@smap/core";
import { canonicalJson } from "../src/toolSchemas";
import {
  emptyTags,
  hashCanonical,
  normalizeTags,
  parseTags,
  serializeTags,
  stampFingerprint,
  tileFingerprint,
} from "../src/tags";
import { harness, error, success, stamp } from "./helpers";

it("hashes the versioned canonical tile tuple with SHA-256 and normalizes transparent RGB", () => {
  const h = harness(),
    ts = h.host.world.tilesets()[0]!,
    rgba = new Uint8Array(32 * 32 * 4),
    a = tileFingerprint(ts, 0, rgba);
  rgba[0] = 250;
  expect(tileFingerprint(ts, 0, rgba)).toBe(a);
  const tuple = [
    "tile-v1",
    32,
    32,
    8,
    8,
    0,
    0,
    0,
    rasterContentHash(32, 32, rgba),
  ];
  expect(a).toBe(
    createHash("sha256").update(canonicalJson(tuple)).digest("hex"),
  );
  rgba[3] = 255;
  expect(tileFingerprint(ts, 0, rgba)).not.toBe(a);
  expect(
    tileFingerprint({ ...ts, spacing: 1 }, 0, new Uint8Array(32 * 32 * 4)),
  ).not.toBe(a);
  expect(hashCanonical("ü🌍")).toBe(
    createHash("sha256").update(canonicalJson("ü🌍")).digest("hex"),
  );
});
it("stamp fingerprints ignore library metadata but include content, flags and referenced pixel hashes", async () => {
  const fp = async (_id: string, tileId: number) => hashCanonical(tileId),
    a = await stampFingerprint(stamp, fp);
  expect(
    await stampFingerprint(
      { ...stamp, name: "Renamed", category: "Nature", tags: ["tree"] },
      fp,
    ),
  ).toBe(a);
  expect(
    await stampFingerprint(
      {
        ...stamp,
        layers: [{ ...stamp.layers[0]!, cells: Uint32Array.of(2, 1) }],
      },
      fp,
    ),
  ).not.toBe(a);
  expect(
    await stampFingerprint(stamp, async () => hashCanonical("new pixels")),
  ).not.toBe(a);
});
it("sidecar serialization has fixed root/record order, sorted normalized tags and one final LF", () => {
  const sidecar = emptyTags();
  sidecar.tiles = [
    {
      tilesetId: "z",
      tileId: 10,
      fingerprint: "a".repeat(64),
      tags: [" b ", "a", "a"],
      note: "",
    },
    {
      tilesetId: "a",
      tileId: 2,
      fingerprint: "b".repeat(64),
      tags: ["e\u0301", "é"],
      note: "Note",
    },
  ];
  const text = serializeTags(sidecar);
  expect(text.indexOf('"format"')).toBeLessThan(
    text.indexOf('"tagFormatVersion"'),
  );
  expect(text.indexOf('"tilesetId": "a"')).toBeLessThan(
    text.indexOf('"tilesetId": "z"'),
  );
  expect(normalizeTags([" b ", "a", "a", "e\u0301", "é"])).toEqual([
    "a",
    "b",
    "é",
  ]);
  expect(text.endsWith("\n")).toBe(true);
  expect(text.endsWith("\n\n")).toBe(false);
  const parsed = parseTags(text);
  expect(parsed.state).toBe("ready");
  if (parsed.state === "ready")
    expect(serializeTags(parsed.sidecar)).toBe(text);
});
it("missing tags are optional and malformed/future/duplicate/oversized data remains unavailable", () => {
  expect(parseTags(null)).toEqual({ state: "ready", sidecar: emptyTags() });
  expect(parseTags("garbage")).toMatchObject({
    state: "unavailable",
    reason: "malformed",
  });
  expect(parseTags('{"tagFormatVersion":2}')).toMatchObject({
    state: "unavailable",
    reason: "futureVersion",
  });
  const entry = {
    tilesetId: "tiles",
    tileId: 0,
    fingerprint: "a".repeat(64),
    tags: ["grass"],
    note: "",
  };
  expect(
    parseTags(JSON.stringify({ ...emptyTags(), tiles: [entry, entry] })),
  ).toMatchObject({ state: "unavailable", reason: "malformed" });
  expect(parseTags(" ".repeat(8 * 1024 * 1024 + 1))).toMatchObject({
    state: "unavailable",
    reason: "oversized",
  });
});
it("unavailable sidecars reject writes without overwriting original bytes", async () => {
  const h = harness();
  h.host.loadTags('{"tagFormatVersion":2}');
  const before = h.host.tagsText;
  error(
    await h.run("set_tags", {
      context: { ...h.context(), idempotencyKey: "tags-future" },
      entries: [
        {
          target: { kind: "tile", tilesetId: "tiles", tileId: 0 },
          expectedFingerprint: "a".repeat(64),
          tags: ["grass"],
        },
      ],
    }),
    "DISK_CONFLICT",
  );
  expect(h.host.tagsText).toBe(before);
});
it("stale and orphan tag records remain discoverable and cannot silently rebind", async () => {
  const h = harness();
  h.host.loadTags(
    serializeTags({
      ...emptyTags(),
      tiles: [
        {
          tilesetId: "tiles",
          tileId: 0,
          fingerprint: "a".repeat(64),
          tags: ["grass"],
          note: "",
        },
        {
          tilesetId: "gone",
          tileId: 1,
          fingerprint: "b".repeat(64),
          tags: ["door"],
          note: "",
        },
      ],
    }),
  );
  const result = success(await h.read("get_tags", { status: "stale" }));
  expect(result.data).toMatchObject({
    items: [
      { target: { tilesetId: "tiles", tileId: 0 }, status: "stale" },
      {
        target: { tilesetId: "gone", tileId: 1 },
        status: "stale",
        currentFingerprint: null,
      },
    ],
  });
});
