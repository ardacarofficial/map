import { expect, it, vi } from "vitest";
import { harness, success, error, stamp } from "./helpers";
import { semanticMatches, normalizeSemanticText } from "../src/tags";

it("discovers a cold 50,000-tile atlas from metadata without hashing or requiring source images", async () => {
  const h = harness();
  const tileset = { ...h.host.world.tilesets()[0]!, columns: 250, rows: 200 };
  h.host.world.tilesets = () => [tileset];
  const fingerprint = vi.spyOn(h.host.images, "tileFingerprint").mockRejectedValue(new Error("Artwork unavailable"));
  const sourceKey = h.host.images.catalogSourceKey = vi.fn(() => null);
  const availability = vi.spyOn(h.host.tags, "availability");
  const result = success(await h.read("list_tilesets", { includeDetails: false }));
  expect(result.data).toMatchObject({ items: [{ id: "tiles", columns: 250, rows: 200, tileCount: 50000 }] });
  const item = (result.data as { items: object[] }).items[0]!;
  expect(item).not.toHaveProperty("fingerprint");
  expect(item).not.toHaveProperty("tagCounts");
  expect(fingerprint).not.toHaveBeenCalled();
  expect(sourceKey).not.toHaveBeenCalled();
  expect(availability).not.toHaveBeenCalled();
});

it("binds tileset pagination to detail mode while treating omitted and true modes identically", async () => {
  const h = harness();
  const tileset = h.host.world.tilesets()[0]!;
  h.host.world.tilesets = () => [tileset, { ...tileset, id: "second", columns: 1, rows: 1 }];
  const fingerprint = h.host.images.tileFingerprint;
  h.host.images.tileFingerprint = (id, ...args) => fingerprint(id === "second" ? "tiles" : id, ...args);
  const first = success(await h.read("list_tilesets", { limit: 1, includeDetails: false }));
  const cursor = (first.data as { nextCursor: string }).nextCursor;
  expect(success(await h.read("list_tilesets", { limit: 1, includeDetails: false, cursor })).data).toMatchObject({ items: [{ id: "second" }], nextCursor: null });
  error(await h.read("list_tilesets", { limit: 1, cursor }), "INVALID_ARGUMENT");
  const detailed = success(await h.read("list_tilesets", { limit: 1 }));
  const detailedCursor = (detailed.data as { nextCursor: string }).nextCursor;
  expect(success(await h.read("list_tilesets", { limit: 1, includeDetails: true, cursor: detailedCursor })).data).toMatchObject({ items: [{ id: "second", tagCounts: { current: 0, stale: 0, missing: 1 } }] });
});

it("folds Turkish search and uses a small explicit bilingual object vocabulary", () => {
  expect(normalizeSemanticText("İĞDE AĞACI / ÇİMEN TAŞI")).toBe("igde agaci cimen tasi");
  expect(semanticMatches("AĞAÇ", ["tree"])).toBe(true);
  expect(semanticMatches("stone grass", ["taş", "çimen"])).toBe(true);
  expect(semanticMatches("tree", ["street"])).toBe(false);
  expect(semanticMatches("water", ["grass"])).toBe(false);
});

it("sheet metadata follows the selected region and pages within that region", async () => {
  const h = harness();
  const result = success(await h.read("get_tile_catalog", { tilesetId: "tiles", image: "sheet", sheetRegion: { x: 3, y: 2, width: 2, height: 2 }, limit: 2 }));
  expect(result.data).toMatchObject({ items: [{ tileId: 19 }, { tileId: 20 }], nextOffset: 2 });
  expect(success(await h.read("get_tile_catalog", { tilesetId: "tiles", image: "sheet", sheetRegion: { x: 3, y: 2, width: 2, height: 2 }, limit: 2, offset: 2 })).data).toMatchObject({ items: [{ tileId: 27 }, { tileId: 28 }] });
  error(await h.read("get_tile_catalog", { tilesetId: "tiles", image: "sheet", tileIds: [0] }), "INVALID_ARGUMENT");
});

it("caches summaries across calls and invalidates source, grid, and tag changes independently", async () => {
  const h = harness();
  let source = "one";
  h.host.images.catalogSourceKey = () => source;
  const fingerprint = vi.spyOn(h.host.images, "tileFingerprint");
  success(await h.read("list_tilesets"));
  expect(fingerprint).toHaveBeenCalledTimes(64);
  success(await h.read("list_tilesets"));
  expect(fingerprint).toHaveBeenCalledTimes(64);
  const fp = await h.host.images.tileFingerprint("tiles", 0, {aborted:false,throwIfAborted(){},onAbort:()=>()=>{}});
  success(await h.run("set_tags", { context: {...h.context(), idempotencyKey:"tile-tags"}, entries:[{target:{kind:"tile",tilesetId:"tiles",tileId:0},expectedFingerprint:fp,tags:["tree"]}] }));
  const before = fingerprint.mock.calls.length;
  expect(success(await h.read("list_tilesets")).data).toMatchObject({ items: [{ tagCounts: { current: 1, missing: 63 } }] });
  expect(fingerprint).toHaveBeenCalledTimes(before);
  source = "two";
  success(await h.read("list_tilesets"));
  expect(fingerprint).toHaveBeenCalledTimes(before + 64);
  (h.host.world.tilesets()[0]! as { spacing: number }).spacing++;
  expect(success(await h.read("list_tilesets")).data).toMatchObject({items:[{tagCounts:{stale:1}}]});
  expect(fingerprint).toHaveBeenCalledTimes(before + 128);
});

it("searches stamp names, category, manual tags, and current AI tags", async () => {
  const h = harness({stamps:[{...stamp, name:"İĞDE",category:"Orman",tags:["çimen"]}]});
  expect(success(await h.read("list_stamps",{query:"igde orman grass"})).data).toMatchObject({items:[{id:"house"}]});
  const result = success(await h.read("get_tags", {kind:"stamps",status:"all"}));
  const record = (result.data as {items:{currentFingerprint:string}[]}).items[0]!;
  success(await h.run("set_tags",{context:{...h.context(),idempotencyKey:"stamp-tags"},entries:[{target:{kind:"stamp",stampId:"house"},expectedFingerprint:record.currentFingerprint,tags:["ağaç"]}]}));
  expect(success(await h.read("list_stamps",{query:"tree"})).data).toMatchObject({items:[{id:"house",semanticTags:["ağaç"]}]});
  const changed=h.host.pixels.get(JSON.stringify(["tiles",4]))!;changed[0]=changed[0]!+1;
  expect(success(await h.read("list_stamps",{query:"tree"})).data).toMatchObject({items:[]});
});

it("semantic tag search defaults to current status and keeps query-bound pagination", async () => {
  const h = harness();
  const all = success(await h.read("get_tags", {status:"all",limit:2}));
  const records = (all.data as {items:{target:unknown;currentFingerprint:string}[]}).items;
  success(await h.run("set_tags", {context:{...h.context(),idempotencyKey:"tree-tags"},entries:records.map(record=>({target:record.target,expectedFingerprint:record.currentFingerprint,tags:["ağaç"]}))}));
  const page = success(await h.read("get_tags", {query:"tree",limit:1}));
  expect(page.data).toMatchObject({items:[{target:{tileId:0},status:"current"}]});
  const cursor = (page.data as {nextCursor:string}).nextCursor;
  expect(success(await h.read("get_tags", {query:"tree",limit:1,cursor})).data).toMatchObject({items:[{target:{tileId:1}}]});
  error(await h.read("get_tags", {query:"water",limit:1,cursor}), "INVALID_ARGUMENT");
});

it("reuses batched semantic scan remainders and excludes stale tags by default", async () => {
  const h = harness();
  const records=(success(await h.read("get_tags",{status:"all",limit:2})).data as {items:{target:unknown;currentFingerprint:string}[]}).items;
  success(await h.run("set_tags",{context:{...h.context(),idempotencyKey:"stairs-tags"},entries:records.map(record=>({target:record.target,expectedFingerprint:record.currentFingerprint,tags:["merdiven"]}))}));
  const get=vi.spyOn(h.host.tags,"get");
  const first=success(await h.read("get_tags",{query:"stairs",limit:1})).data as {nextCursor:string};
  expect(get).toHaveBeenCalledTimes(1);expect(get.mock.calls[0]![0].limit).toBe(128);
  success(await h.read("get_tags",{query:"stairs",limit:1,cursor:first.nextCursor}));
  expect(get).toHaveBeenCalledTimes(1);
  const changed=h.host.pixels.get(JSON.stringify(["tiles",0]))!;changed[0]=changed[0]!+1;
  expect(success(await h.read("get_tags",{query:"steps"})).data).toMatchObject({items:[{target:{tileId:1},status:"current"}]});
  expect(success(await h.read("get_tags",{query:"stair",status:"stale"})).data).toMatchObject({items:[{target:{tileId:0},status:"stale"}]});
  expect(success(await h.read("get_tags",{status:"current"})).data).toMatchObject({items:[{target:{tileId:1},status:"current"}]});
});

it("excludes unused tail slots of an edited atlas from summaries and sheet pages", async () => {
  const h=harness({tilesets:[{id:"edited",name:"Edited",imagePath:"tilesets/edited.png",tileWidth:16,tileHeight:16,columns:16,rows:2,margin:0,spacing:0,edited:{kind:"pixel",layoutVersion:1,nextTileId:18,contentHash:"a".repeat(64),origins:[]}}]});
  expect(success(await h.read("list_tilesets")).data).toMatchObject({items:[{tileCount:18,tagCounts:{missing:18}}]});
  const sheet=success(await h.read("get_tile_catalog",{tilesetId:"edited",image:"sheet",sheetRegion:{x:0,y:1,width:16,height:1}}));
  expect(sheet.data).toMatchObject({items:[{tileId:16},{tileId:17}]});
  expect((sheet.data as {items:unknown[]}).items).toHaveLength(2);
  expect(success(await h.read("get_tile_catalog",{tilesetId:"edited",image:"sheet",sheetRegion:{x:4,y:1,width:2,height:1}})).data).toMatchObject({items:[]});
});

it("never reuses fingerprints without a source identity and rejects mid-scan replacement", async () => {
  const h=harness(), original=h.host.images.tileFingerprint, fingerprint=vi.spyOn(h.host.images,"tileFingerprint");
  success(await h.read("list_tilesets"));success(await h.read("list_tilesets"));
  expect(fingerprint).toHaveBeenCalledTimes(128);
  let source="before";h.host.images.catalogSourceKey=()=>source;
  fingerprint.mockImplementation(async(...args)=>{const value=await original(...args);source="after";return value;});
  error(await h.read("list_tilesets"),"SOURCE_CHANGED");
});
