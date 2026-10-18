// eslint-disable-next-line no-restricted-imports -- frozen exporter fixtures are test-only
import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { collisionAt, createDocument, deriveCollision, exportGameJson, exportTmj, MapStore, serializeLevel, decodeRle } from "../src";
function setup() {
  const store = new MapStore(createDocument({ width: 8, height: 6, tileWidth: 16, tileHeight: 32 }));
  for (const id of ["base", "top"]) store.dispatch({ type: "addLayer", layer: { id, name: id, type: "grid", role: "collision", visible: id === "base" } });
  store.clearHistory(); return store;
}
describe("manual Collision", () => {
  it("uses the topmost nonzero value even on hidden layers; zero inherits and tiles never contribute", () => {
    const store = setup();
    store.dispatch({ type: "paintGrid", layerId: "base", cells: [{ x: 1, y: 2, value: 1 }, { x: 2, y: 2, value: 2 }] });
    store.dispatch({ type: "paintGrid", layerId: "top", cells: [{ x: 1, y: 2, value: 2 }, { x: 2, y: 2, value: 1 }] });
    expect(collisionAt(store.document, 1, 2)).toBe(false); expect(collisionAt(store.document, 2, 2)).toBe(true);
    expect(collisionAt(store.document, -1, 2)).toBe(false);
    const data = deriveCollision(store.document).data;
    expect([...data].reduce((a,b) => a+b, 0)).toBe(1);
    expect(decodeRle(JSON.parse(exportGameJson(store.document)).collision.solid, data.length)).toEqual(data);
    store.dispatch({ type: "paintGrid", layerId: "top", cells: [{ x: 1, y: 2, value: 0 }] });
    expect(collisionAt(store.document, 1, 2)).toBe(true);
  });
  it("paintGrid gestures undo/redo byte-exactly and deterministically", () => {
    fc.assert(fc.property(fc.array(fc.record({ x: fc.integer({ min: 0, max: 7 }), y: fc.integer({ min: 0, max: 5 }), value: fc.integer({ min: 0, max: 2 }) }), { maxLength: 80 }), cells => {
      const a = setup(), b = setup(), before = serializeLevel(a.document);
      a.beginTransaction(); a.dispatch({ type: "paintGrid", layerId: "base", cells }); a.commit();
      b.dispatch({ type: "paintGrid", layerId: "base", cells });
      const after = serializeLevel(a.document); expect(after).toBe(serializeLevel(b.document));
      if (a.undoDepth) { a.undo(); expect(serializeLevel(a.document)).toBe(before); a.redo(); expect(serializeLevel(a.document)).toBe(after); }
      const grid = deriveCollision(a.document);
      for (let y=0; y<6; y++) for (let x=0; x<8; x++) expect(grid.data[y*8+x] === 1).toBe(collisionAt(a.document,x,y));
    }));
  });
  it("TMJ merges identical horizontal runs vertically, sorts y/x, uses pixel units and avoids name clashes", () => {
    const store = setup(); store.dispatch({ type: "addLayer", layer: { name: "Collision" } });
    store.dispatch({ type: "paintGrid", layerId: "base", cells: [{ x: 1,y: 1,value: 1 }, { x: 2,y: 1,value: 1 }, { x: 1,y: 2,value: 1 }, { x: 2,y: 2,value: 1 }, { x: 5,y: 1,value: 1 }, { x: 5,y: 2,value: 1 }, { x: 5,y: 3,value: 1 }] });
    const result = exportTmj(store.document, "Map"), map = JSON.parse(result.text);
    const collision = map.layers.find((l: { properties?: { name:string; value:string }[] }) => l.properties?.some(p => p.name === "smapRole" && p.value === "collision"));
    expect(collision).toMatchObject({ type: "objectgroup", name: "Collision 2", visible: false });
    expect(collision.objects.map((o: {x:number;y:number;width:number;height:number;visible:boolean}) => [o.x,o.y,o.width,o.height,o.visible])).toEqual([[16,32,32,64,false],[80,32,16,96,false]]);
    expect(map.nextobjectid).toBe(3); expect(map.nextlayerid).toBe(map.layers.length+1);
    expect(result.warnings).toEqual([]); expect(exportTmj(store.document, "Map").text).toBe(result.text);
  });
  it("TMJ rectangles cover exactly the final manual grid, without overlap, for arbitrary overrides", () => {
    fc.assert(fc.property(fc.array(fc.record({x:fc.integer({min:0,max:7}),y:fc.integer({min:0,max:5}),value:fc.integer({min:0,max:2}),top:fc.boolean()}),{maxLength:80}),writes=>{
      const store=setup();for(const top of [false,true])store.dispatch({type:"paintGrid",layerId:top?"top":"base",cells:writes.filter(w=>w.top===top)});
      const map=JSON.parse(exportTmj(store.document,"Map").text), group=map.layers.at(-1), raster=new Uint8Array(48);
      for(const r of group.objects)for(let y=r.y/32;y<(r.y+r.height)/32;y++)for(let x=r.x/16;x<(r.x+r.width)/16;x++){expect(raster[y*8+x]).toBe(0);raster[y*8+x]=1;}
      expect(raster).toEqual(deriveCollision(store.document).data);
    }),{numRuns:60});
  });
  it("keeps the frozen TypeScript → Unity fixtures byte-identical at wire version 1", () => {
    const store=new MapStore(createDocument({width:4,height:3,tileWidth:16,tileHeight:32}));
    store.dispatch({type:"addLayer",layer:{id:"c",name:"Collision",type:"grid",role:"collision"}});
    const directory=decodeURIComponent(import.meta.url.replace(/^file:\/\//, "")).replace(/\/[^/]*$/, "");
    for(const name of ["all-passable","manual-collision"]){
      if(name==="manual-collision")store.dispatch({type:"paintGrid",layerId:"c",cells:[{x:0,y:0,value:1},{x:1,y:0,value:1},{x:2,y:1,value:1},{x:1,y:2,value:1},{x:0,y:2,value:2}]});
      const frozen=readFileSync(directory+`/fixtures/v15/${name}.smapmap`,"utf8");
      expect(exportGameJson(store.document)).toBe(frozen);
      expect(readFileSync(directory+`/../../../unity/com.smap.mapimporter/Tests/Fixtures/${name}.smapmap`,"utf8")).toBe(frozen);
    }
  });

});
