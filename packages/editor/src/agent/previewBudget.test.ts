import { describe, expect, it, vi } from "vitest";
import { createDocument, layerDrawList, MapStore, makeCell, FLIP_D, FLIP_H, FLIP_V } from "@smap/core";
import { compositeOps, regionCompositeOps, type CanvasOp } from "../export/pngComposite";
function setup(){
  const ts={id:"large",name:"Large",imagePath:"tilesets/large.png",tileWidth:5,tileHeight:7,columns:1,rows:1,margin:0,spacing:0};
  const store=new MapStore(createDocument({width:80,height:40,tileWidth:2,tileHeight:2,tilesets:[ts]}));
  const id=store.dispatch({type:"addLayer",layer:{name:"Ground"}}),index=store.getOrAddPaletteIndex(ts.id,0);
  const flags=[0,FLIP_H,FLIP_V,FLIP_H|FLIP_V,FLIP_D,FLIP_D|FLIP_H,FLIP_D|FLIP_V,FLIP_D|FLIP_V|FLIP_H];
  for(let i=0;i<flags.length;i++)store.dispatch({type:"paintCells",layerId:id,cells:[{x:30+i,y:30+i%3,cell:makeCell(index,flags[i])}]});
  return store;
}
const overlaps=(op:CanvasOp,region:{x:number;y:number;width:number;height:number})=>{
  if(op.kind!=="draw")return false;const [a,b,c,d,e,f]=op.transform;
  const points=[[e,f],[e+a*op.dw,f+b*op.dw],[e+c*op.dh,f+d*op.dh],[e+a*op.dw+c*op.dh,f+b*op.dw+d*op.dh]];
  return Math.max(...points.map(p=>p[0]!))>region.x&&Math.min(...points.map(p=>p[0]!))<region.x+region.width&&Math.max(...points.map(p=>p[1]!))>region.y&&Math.min(...points.map(p=>p[1]!))<region.y+region.height;
};
describe("bounded region PNG replay",()=>{
  it("streams the same row-major orientation/oversized overlaps as the full core draw list across chunk edges",()=>{
    const store=setup(),region={x:32,y:29,width:4,height:4},pixels={x:64,y:58,width:8,height:8};
    const expected=compositeOps(layerDrawList(store.document),1).filter(op=>overlaps(op,pixels));
    expect([...regionCompositeOps(store.document,region,1)].filter(op=>op.kind==="draw")).toEqual(expected);
  });
  it("does not materialize the map before yielding the first visible tile",()=>{
    const store=setup(),read=vi.spyOn(store.document,"getTileset"),ops=regionCompositeOps(store.document,{x:30,y:30,width:1,height:1},1);
    expect(read).not.toHaveBeenCalled();let op=ops.next();while(!op.done&&op.value.kind!=="draw")op=ops.next();
    expect(op.done).toBe(false);expect(read.mock.calls.length).toBeLessThan(8);read.mockRestore();
  });
});
