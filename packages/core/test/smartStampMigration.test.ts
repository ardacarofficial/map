import { buildLayout1RoadProfile } from "../src/smartStamp/roadProfile";
import { describe, expect, it } from "vitest";
import { fileFormatVersion, parseClip, parseLevel, parseProject, parseStamp, serializeClip, serializeLevel, serializeProject, serializeStamp } from "../src/serialize";
import { stampNineSliceProblem, type Stamp } from "../src/stamp";
import { source } from "./smartStampHelpers";
import p1 from "./fixtures/v14/v1-project.json";
import p2 from "./fixtures/v14/v2-project.json";
import l1 from "./fixtures/v14/v1-level.json";
import l2 from "./fixtures/v14/v2-level.json";
import s1 from "./fixtures/v14/v1-stamp.json";
import s2 from "./fixtures/v14/v2-stamp.json";
import c1 from "./fixtures/v14/v1-clip.json";
import c2 from "./fixtures/v14/v2-clip.json";

const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

describe("smart stamp format 3 migration", () => {
  for (const [version, project, level, stamp, clip] of [[1, p1, l1, s1, c1], [2, p2, l2, s2, c2]] as const) {
    it(`reads v${version} project/level/stamp/clip and writes stable v5 without inferring smart metadata`, () => {
      const p = parseProject(json(project)), doc = parseLevel(json(level), p.tilesets);
      expect(doc.seed).toBe(0xffff_ffff); expect(doc.getLayer("tiles")!.getCell(0, 0)).toBe(0xe0000001);
      expect(doc.getLayer("tiles")).toMatchObject({ visible: false, locked: true, opacity: 0.5 });
      const old = parseStamp(json(stamp)); expect(old.nineSlice).toBeUndefined();
      expect(old.layers[0]!.cells[0]).toBe(0xe0000001);
      const texts = [serializeProject(p), serializeLevel(doc), serializeStamp(old), serializeClip(parseClip(json(clip)))];
      for (const text of texts) { expect(fileFormatVersion(text)).toBe(5); expect(text.endsWith("\n")).toBe(true); expect(text.includes("\r")).toBe(false); }
      expect(serializeProject(parseProject(texts[0]!))).toBe(texts[0]);
      expect(serializeLevel(parseLevel(texts[1]!, p.tilesets))).toBe(texts[1]);
      expect(serializeStamp(parseStamp(texts[2]!))).toBe(texts[2]);
      expect(serializeClip(parseClip(texts[3]!))).toBe(texts[3]);
      // Fixed golden layout: the legacy stamp/clip body changes only its version header.
      expect(texts[2]).toBe(json({ ...stamp, documentFormatVersion: 5 }));
      expect(texts[3]).toBe(json({ ...clip, documentFormatVersion: 5 }));
      expect(parseStamp(json({ ...stamp, nineSlice: { border: 1 } })).nineSlice).toBeUndefined();
    });
  }

  it("serializes metadata before the clip body with canonical nested key order", () => {
    const s: Stamp = { ...source(), id: "road", name: "Road", category: "Roads", nineSlice: { tileLayers: [{ tilesetId: "baked", layerId: "s" }], road: { profile: buildLayout1RoadProfile(3, 3), tilesetId: "baked" }, border: 1 } };
    const text = serializeStamp(s), root = JSON.parse(text);
    expect(Object.keys(root)).toEqual(["format", "documentFormatVersion", "id", "name", "category", "nineSlice", "width", "height", "palette", "layers"]);
    expect(Object.keys(root.nineSlice)).toEqual(["border", "tileLayers", "road"]);
    expect(Object.keys(root.nineSlice.tileLayers[0])).toEqual(["layerId", "tilesetId"]);
    expect(Object.keys(root.nineSlice.road)).toEqual(["tilesetId", "profile"]);
    expect(serializeStamp(parseStamp(text))).toBe(text);
    expect(Object.isFrozen(parseStamp(text).nineSlice!.tileLayers[0])).toBe(true);
  });

  it("rejects bad dimensions, borders, layer references and incomplete road representatives", () => {
    const s = source(), valid = { border: 1, tileLayers: [{ layerId: "s", tilesetId: "baked" }] };
    expect(stampNineSliceProblem(s, valid)).toBeNull();
    for (const value of [{ ...valid, border: 2 }, { ...valid, tileLayers: [] }, { ...valid, tileLayers: [{ layerId: "missing", tilesetId: "baked" }] }, { ...valid, road: { tilesetId: "other", profile: buildLayout1RoadProfile(3, 3) } }, { ...valid, road: { tilesetId: "baked", profile: { tiles: [] } } }]) {
      expect(() => parseStamp(json({ ...s1, documentFormatVersion: 5, nineSlice: value }))).toThrow(/nineSlice/);
    }
    expect(stampNineSliceProblem({ ...s, width: 2 }, valid)).toMatch(/3/);
    for (const [fixture, parse] of [[p1, parseProject], [l1, parseLevel], [s1, parseStamp], [c1, parseClip]] as const) expect(() => parse(json({ ...fixture, documentFormatVersion: 6 }))).toThrow(/newer/);
  });
});
