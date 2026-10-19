import { expect, it } from "vitest";
import fc from "fast-check";
import { createDocument, MapStore, serializeLevel } from "../src/index";
it("changes an empty map grid deterministically with an exact undo/redo round trip", () => {
 fc.assert(fc.property(fc.integer({min:4,max:128}),fc.integer({min:4,max:128}),(tileWidth,tileHeight)=>{
  const store=new MapStore(createDocument({width:24,height:20}));
  store.dispatch({type:"addLayer",layer:{name:"Ground"}});store.clearHistory();
  const before=serializeLevel(store.document);
  store.dispatch({type:"resizeMap",width:24,height:20,tileWidth,tileHeight});
  const after=serializeLevel(store.document);expect(store.document.map.tileWidth).toBe(tileWidth);expect(store.document.map.tileHeight).toBe(tileHeight);
  if(before!==after){store.undo();expect(serializeLevel(store.document)).toBe(before);store.redo();expect(serializeLevel(store.document)).toBe(after);}
 }));
});
it("rejects a grid change in a painted map atomically",()=>{
 const store=new MapStore(createDocument({width:24,height:20}));const id=store.dispatch({type:"addLayer",layer:{name:"Collision",type:"grid",role:"collision"}});
 store.dispatch({type:"paintGrid",layerId:id,cells:[{x:0,y:0,value:1}]});const before=serializeLevel(store.document);
 expect(()=>store.dispatch({type:"resizeMap",width:24,height:20,tileWidth:16,tileHeight:16})).toThrow();expect(serializeLevel(store.document)).toBe(before);
});
