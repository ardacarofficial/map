// eslint-disable-next-line no-restricted-imports -- test-only frozen fixture oracle
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FormatError, deriveCollision, decodeUint32LE, encodeUint32LE, nineSliceBlits, orientPoint, MapStore, applySmartStampRoad, roadMembership, fileFormatVersion, parseClip, parseLevel, parseProject, parseStamp, serializeClip, serializeLevel, serializeProject, serializeStamp } from "../src";
import { migrateV4 } from "../src/migrations/v4";
import { decodePng } from "./png";
import { pixelHash } from "./pixelOracle";
import manifest from "./fixtures/v15/manifest.json";
const fixtureRoot = decodeURIComponent(import.meta.url.replace(/^file:\/\//, "")).replace(/\/[^/]*$/, "") + "/fixtures/v15/";
const read = (name: string) => readFileSync(fixtureRoot + name, "utf8");
const raw = (name: string) => JSON.parse(read(name));

describe("frozen e94d93d → format 4", () => {
  for (const version of [1, 2, 3] as const) it(`preserves v${version} disk pixels, cells, palette, flags and layer properties without deriving`, () => {
    const project = parseProject(read(`v${version}-project.json`));
    const before = raw(`v${version}-level.json`), doc = parseLevel(read(`v${version}-level.json`), project.tilesets);
    const after = JSON.parse(serializeLevel(doc));
    expect(after.documentFormatVersion).toBe(4);
    expect(after.palette).toEqual(before.palette);
    expect(after.layers).toEqual(before.layers.filter((l: { role?: string }) => l.role !== "terrain"));
    const images = new Map([[version === 3 ? "source" : "terrain", decodePng(readFileSync(fixtureRoot + `v${version}-source.png`))]]);
    if (version === 3) images.set("baked", decodePng(readFileSync(fixtureRoot + "v3-baked.png")));
    expect(pixelHash(doc, images)).toBe(manifest.hashes[`v${version}`]);
    expect(doc.migrations.length).toBeGreaterThan(0);
    expect(deriveCollision(doc).data[0]).toBe(0);
    expect([...deriveCollision(doc).data].filter(Boolean)).toHaveLength(3);
    const stamp = parseStamp(read(`v${version}-stamp.json`)), clip = parseClip(read(`v${version}-clip.json`));
    expect(stamp.layers.map(l => l.layerId)).toEqual(["s"]);
    expect(clip.layers.map(l => l.layerId)).toEqual(["s"]);
    expect(stamp.nineSlice === undefined).toBe(version < 3);
    const texts = [serializeProject(project), serializeLevel(doc), serializeStamp(stamp), serializeClip(clip)];
    for (const text of texts) {
      expect(fileFormatVersion(text)).toBe(4); expect(text.endsWith("\n")).toBe(true); expect(text).not.toContain("\r");
      expect(text).not.toMatch(/"(?:terrains|terrainSets|solidTiles|setId|terrainId)"/);
    }
    expect(serializeProject(parseProject(texts[0]!))).toBe(texts[0]);
    expect(serializeLevel(parseLevel(texts[1]!, project.tilesets))).toBe(texts[1]);
    expect(serializeStamp(parseStamp(texts[2]!))).toBe(texts[2]);
    expect(serializeClip(parseClip(texts[3]!))).toBe(texts[3]);
  });
  it("raw migration is pure, retains every retained property/chunk and converts embedded recipes before dropping tags", () => {
    const input = raw("v3-project.json"), original = JSON.stringify(input);
    const migrated = migrateV4(input);
    expect(JSON.stringify(input)).toBe(original);
    expect(migrated).not.toBe(input);
    const recipe = (migrated.generatedRecipes as { nineSlice: { road: unknown } }[])[0]!;
    expect(recipe.nineSlice.road).toHaveProperty("profile");
    expect(JSON.stringify(migrated)).not.toMatch(/"(?:terrains|terrainSets|solidTiles|setId|terrainId)"/);
    expect(migrateV4(migrated)).toEqual(migrated);
  });
  it("archives custom v3 variants in project and sidecar profiles and roundtrips embedded recipes", () => {
    const old = raw("v3-project.json"), set = old.tilesets[1].terrainSets[0];
    set.tiles.push({ tileId: 63, terrainId: 1, mask: 0 });
    const project = parseProject(JSON.stringify(old));
    expect(project.tilesets[1]!.roadProfile!.tiles.at(-1)).toEqual({ tileId: 63, mask: 0 });
    const stamp = parseStamp(read("v3-stamp.json"), project.tilesets);
    expect(stamp.nineSlice!.road!.profile.tiles.at(-1)).toEqual({ tileId: 63, mask: 0 });
    expect(JSON.parse(serializeProject(project)).generatedRecipes).toHaveLength(1);
  });

  it("rebuilds the frozen v3 generated atlas with identical RGBA and keeps its old road usable with one undo", () => {
    const project = parseProject(read("v3-project.json")), stamp = parseStamp(read("v3-stamp.json"),project.tilesets);
    const source = decodePng(readFileSync(fixtureRoot+"v3-source.png")), expected = decodePng(readFileSync(fixtureRoot+"v3-baked.png"));
    const actual = new Uint8Array(expected.data.length), input = project.tilesets[0]!, target = project.tilesets[1]!;
    for(const b of nineSliceBlits(stamp,"s",32,32)) for(let y=0;y<b.sourceRect.height;y++) for(let x=0;x<b.sourceRect.width;x++) {
      const q=orientPoint({x,y},b.sourceRect.width,b.sourceRect.height,b.flags);
      const sx=b.tile.tileId%input.columns*32+b.sourceRect.x+x, sy=Math.floor(b.tile.tileId/input.columns)*32+b.sourceRect.y+y;
      const dx=b.slot%target.columns*32+b.destinationRect.x+q.x, dy=Math.floor(b.slot/target.columns)*32+b.destinationRect.y+q.y;
      actual.set(source.data.subarray((sy*source.width+sx)*4,(sy*source.width+sx)*4+4),(dy*expected.width+dx)*4);
    }
    expect(actual.every((value,i)=>value===expected.data[i])).toBe(true);
    const store = new MapStore(parseLevel(read("v3-level.json"),project.tilesets)), before = serializeLevel(store.document);
    applySmartStampRoad(store,stamp,"tiles",roadMembership([{x:18,y:12},{x:19,y:12},{x:20,y:12}]));
    expect(store.undoDepth).toBe(1); expect(store.document.getLayer("tiles")!.getCell(19,12)).not.toBe(0);
    const after=serializeLevel(store.document);store.undo();expect(serializeLevel(store.document)).toBe(before);store.redo();expect(serializeLevel(store.document)).toBe(after);
  });

  it("preserves raw negative tile chunks and handles deeply frozen inputs without mutation",()=>{
    const input=raw("v3-level.json"), tile=input.layers.find((l:{type:string})=>l.type==="tile");
    tile.chunks.unshift({...tile.chunks[0],cx:-1,cy:-2});
    const freeze=(v:unknown)=>{if(v&&typeof v==="object"){for(const child of Object.values(v))freeze(child);Object.freeze(v);}};
    freeze(input);const before=JSON.stringify(input), migrated=migrateV4(input);
    expect(JSON.stringify(input)).toBe(before);expect((migrated.layers as {chunks:unknown[]}[])[0]!.chunks).toEqual(tile.chunks);
  });
  it("persists disabled smart preferences and source D4 flags without discarding the recipe",()=>{
    const input=raw("v3-stamp.json");input.smartDisabled=true;
    const cells=decodeUint32LE(input.layers[0].data);cells[0]=0xe0000001;input.layers[0].data=encodeUint32LE(cells);
    const stamp=parseStamp(JSON.stringify(input));expect(stamp.smartDisabled).toBe(true);expect(stamp.layers[0]!.cells[0]).toBe(0xe0000001);
    expect(stamp.nineSlice!.road).toBeDefined();expect(serializeStamp(parseStamp(serializeStamp(stamp)))).toBe(serializeStamp(stamp));
  });
  it("keeps malformed retained metadata errors explicit while discarding obsolete marking metadata",()=>{
    const project=raw("v3-project.json");project.tilesets=[null];
    expect(()=>parseProject(JSON.stringify(project))).toThrow(/tilesets\[0\]/);
    const stamp=raw("v3-stamp.json");stamp.nineSlice.road={tilesetId:"baked",setId:"",terrainId:0};
    expect(()=>parseStamp(JSON.stringify(stamp))).toThrow(FormatError);
    expect(()=>parseStamp(JSON.stringify(stamp))).toThrow(/nineSlice/);
  });

});
