import { expect, it } from "vitest";
import fc from "fast-check";
import { detectNineSliceSelection, type NineSliceSelectionInput } from "../src/smartStamp/detect";
import { nineSliceBlits, nineSliceLayout, sampleNineSlice } from "../src/nineSlice";
import { source } from "./smartStampHelpers";

/** Border relief spans b tiles. Tile seams share a one-pixel neutral gutter. */
function artwork(b:number,rx=1,ry=1,size=16,margin=1,spacing=2,col=2,row=1,w=b*(2+rx),h=b*(2+ry)):NineSliceSelectionInput {
 const columns=w+col+1,rows=h+row+1;
 const width=2*margin+columns*size+(columns-1)*spacing,height=2*margin+rows*size+(rows-1)*spacing,data=new Uint8Array(width*height*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let py=0;py<size;py++)for(let px=0;px<size;px++){
  const ex=x<b?x:x>=w-b?w-1-x:b,ey=y<b?y:y>=h-b?h-1-y:b;
  const v=px===0||py===0||px===size-1||py===size-1?120:50+ex*17+ey*23;
  data.set([v,v+10,v+20,255],((margin+(row+y)*(size+spacing)+py)*width+margin+(col+x)*(size+spacing)+px)*4);
 }
 return {tileset:{id:"source",columns,rows,tileWidth:size,tileHeight:size,margin,spacing},rect:{col,row,width:w,height:h},ids:Array.from({length:w*h},(_,i)=>(row+Math.floor(i/w))*columns+col+i%w),emptyIds:new Set(),pixels:{width,height,data}};
}
it("detects full-span b=2 corners and chooses the smallest evidenced band",()=>{
 expect(detectNineSliceSelection(artwork(2))?.border).toBe(2);
 expect(detectNineSliceSelection(artwork(1,4,4))?.border).toBe(1);
});
it("detects variable b, repeats, pixel grids and sheet offsets deterministically",()=>{
 fc.assert(fc.property(fc.integer({min:1,max:4}),fc.integer({min:1,max:3}),fc.integer({min:1,max:3}),fc.constantFrom(16,32),fc.integer({min:0,max:3}),fc.integer({min:0,max:3}),(b,rx,ry,size,margin,spacing)=>{
  const s=artwork(b,rx,ry,size,margin,spacing);
  const detected=detectNineSliceSelection(s);expect(detected).not.toBeNull();expect(detected!.border).toBeLessThanOrEqual(b);
  expect(s.rect.width-2*detected!.border).toBeGreaterThanOrEqual(1);expect(s.rect.height-2*detected!.border).toBeGreaterThanOrEqual(1);
  expect(detectNineSliceSelection(s)).toEqual(detectNineSliceSelection(s));
 }),{numRuns:30});
},30_000);
it("allocates a separate stable patch bank and every compact area size",()=>{
 const s={...source(6,6),nineSlice:{border:2,tileLayers:[]}},l=nineSliceLayout(s);
 expect(l.bank).toBe(144);expect(l.slots).toBe(332);
 for(const w of [1,2,3,4,5,13])for(const h of [1,2,3,4,5,12]){
  const samples=Array.from({length:w*h},(_,i)=>sampleNineSlice({x:-3,y:-2,width:w,height:h},{x:-3+i%w,y:-2+Math.floor(i/w)},s)!);
  expect(samples.every(p=>p.slot>=0&&p.slot<l.bank)).toBe(true);
  expect(nineSliceBlits(s,"s",16,16).some(p=>p.slot===samples[0]!.slot)).toBe(true);
 }
});

import { applySmartStampRoad, buildRoadProfile, createDocument, FLIP_D, FLIP_H, FLIP_V, MapStore, parseStamp, prepareNineSliceTileset, roadMembership, serializeLevel, serializeStamp, type Stamp, type Tileset } from "../src";
import { BLOB47_MASKS, flipBlobMask } from "../src/smartStamp/topology";
import { macroRect } from "../src/smartStamp/macroRoad";
const orientations=[0,FLIP_H,FLIP_V,(FLIP_H|FLIP_V)>>>0,FLIP_D,(FLIP_D|FLIP_H)>>>0,(FLIP_D|FLIP_V)>>>0,(FLIP_D|FLIP_H|FLIP_V)>>>0];
function prepared(b=2,n=3*b,m=3*b) {
 const raw:Stamp={...source(n,m),id:"road",name:"Road",nineSlice:{border:b,tileLayers:[{layerId:"s",tilesetId:"baked"}]}};
 const ts:Tileset={id:"source",name:"Source",imagePath:"tilesets/source.png",tileWidth:16,tileHeight:16,columns:n,rows:m,margin:0,spacing:0};
 const atlas=prepareNineSliceTileset(raw,"s",{id:"baked",imagePath:"tilesets/baked.png",tilesets:[ts],tileWidth:16,tileHeight:16,imageHashes:new Map([["source","hash"]])});
 const stamp:Stamp={...raw,nineSlice:{...raw.nineSlice!,road:{tilesetId:"baked",profile:buildRoadProfile(raw,"s")}}};
 const store=new MapStore(createDocument({width:24,height:24,tileWidth:16,tileHeight:16}));
 store.dispatch({type:"addTileset",tileset:ts});store.dispatch({type:"addTileset",tileset:atlas});store.dispatch({type:"addLayer",layer:{name:"Ground"}});for(let i=0;i<nineSliceLayout(stamp).slots;i++)store.getOrAddPaletteIndex("baked",i);store.clearHistory();
 return {store,stamp,atlas,layer:store.document.layers[0]!};
}
it("solves all 47 masks at macro scale, with every D4 patch interior orientation",()=>{
 const offsets=[[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]];
 for(const b of [2,3])for(const mask of BLOB47_MASKS)for(const orientation of orientations){
  const {store,stamp,layer}=prepared(b),bank=nineSliceLayout(stamp).bank;
  const points=[{x:3*b,y:3*b},...offsets.flatMap(([x,y],bit)=>mask&(1<<bit)?[{x:(3+x!)*b,y:(3+y!)*b}]:[])];
  applySmartStampRoad(store,stamp,layer.id,roadMembership(points),{orientation});
  const lookup=flipBlobMask(mask,!!(orientation&FLIP_H),!!(orientation&FLIP_V),!!(orientation&FLIP_D));
  // Transposes and reflections are inverted in lookup space by the solver.
  const inverse=orientation&FLIP_D?((orientation&FLIP_H?FLIP_V:0)|(orientation&FLIP_V?FLIP_H:0)|FLIP_D)>>>0:orientation;
  const canonical=flipBlobMask(mask,!!(inverse&FLIP_H),!!(inverse&FLIP_V),!!(inverse&FLIP_D));
  expect(BLOB47_MASKS).toContain(lookup);
  for(let y=0;y<b;y++)for(let x=0;x<b;x++){
   const p=orientPoint({x,y},b,b,orientation),cell=layer.getCell(3*b+p.x,3*b+p.y);
   expect(store.document.palette.get(cell&0x1fffffff)?.tileId).toBe(bank+BLOB47_MASKS.indexOf(canonical)*b*b+y*b+x);
   expect((cell&0xe0000000)>>>0).toBe(orientation);
  }
 }
},30_000);
import { orientPoint } from "../src/nineSlice";
it("separate strokes join and erase repairs macro neighbours in one reversible operation",()=>{
 const {store,stamp,layer}=prepared();
 applySmartStampRoad(store,stamp,layer.id,roadMembership([{x:4,y:4},{x:6,y:4},{x:8,y:4}]));
 const before=serializeLevel(store.document);
 applySmartStampRoad(store,stamp,layer.id,roadMembership([{x:6,y:2},{x:6,y:4},{x:6,y:6}]));
 const after=serializeLevel(store.document);store.undo();expect(serializeLevel(store.document)).toBe(before);store.redo();expect(serializeLevel(store.document)).toBe(after);
 applySmartStampRoad(store,stamp,layer.id,roadMembership([{x:6,y:4}]),{erase:true});
 for(let y=4;y<6;y++)for(let x=6;x<8;x++)expect(layer.getCell(x,y)).toBe(0);
 const left=store.document.palette.get(layer.getCell(4,4)&0x1fffffff)!;
 expect(left.tileId).toBe(nineSliceLayout(stamp).bank); // isolated mask 0
 store.undo();expect(serializeLevel(store.document)).toBe(after);
});
it("uses negative-safe origin alignment and clips partial map-edge macro patches",()=>{
 expect(macroRect({x:-1,y:-5,width:4,height:6},3)).toEqual({x:-1,y:-2,width:2,height:3});
 const {store,stamp,layer}=prepared(3);
 store.dispatch({type:"resizeMap",width:23,height:23,offsetX:0,offsetY:0});
 applySmartStampRoad(store,stamp,layer.id,roadMembership([{x:-1,y:3},{x:0,y:3},{x:22,y:22}]));
 expect(layer.getCell(0,3)).not.toBe(0);expect(layer.getCell(22,22)).not.toBe(0);
});
it("roundtrips thick saved sources, off preference and layout-2 metadata deterministically",()=>{
 const {stamp,atlas}=prepared(3),disabled={...stamp,smartDisabled:true};
 const text=serializeStamp(disabled);expect(JSON.parse(text).documentFormatVersion).toBe(5);
 expect(parseStamp(text)).toEqual(disabled);expect(serializeStamp(parseStamp(text))).toBe(text);
 expect(atlas.generated).toMatchObject({layoutVersion:2,border:3});
});
it("random macro gestures and erases undo/redo with deterministic complete patches",()=>{
 fc.assert(fc.property(fc.array(fc.record({x:fc.integer({min:0,max:7}),y:fc.integer({min:0,max:7}),erase:fc.boolean()}),{minLength:1,maxLength:20}),steps=>{
  const {store,stamp,layer}=prepared();const initial=serializeLevel(store.document);
  for(const p of steps)applySmartStampRoad(store,stamp,layer.id,roadMembership([{x:p.x*2,y:p.y*2}]),{erase:p.erase});
  const last=serializeLevel(store.document),depth=store.undoDepth;
  for(let i=0;i<depth;i++)store.undo();expect(serializeLevel(store.document)).toBe(initial);
  for(let i=0;i<depth;i++)store.redo();expect(serializeLevel(store.document)).toBe(last);
 }),{numRuns:30});
});

it("accepts longer edge/centre segments, including single-span segments, with real repeat evidence",()=>{
 fc.assert(fc.property(fc.integer({min:2,max:4}),fc.integer({min:1,max:3}),fc.integer({min:1,max:3}),fc.integer({min:1,max:2}),fc.constantFrom(16,32),(b,sx,sy,repeats,size)=>{
  const s=artwork(b,sx*repeats,sy*repeats,size),p=s.pixels!,data=p.data.slice(),{width:w,height:h,col,row}=s.rect,t=s.tileset;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let py=1;py<size-1;py++)for(let px=1;px<size-1;px++){
   // Distinct periodic grain inside the segments, without changing any tile seam.
   const cx=x>=b&&x<w-b?(x-b)%(sx*b):0,cy=y>=b&&y<h-b?(y-b)%(sy*b):0;
   const index=((t.margin+(row+y)*(size+t.spacing)+py)*p.width+t.margin+(col+x)*(size+t.spacing)+px)*4;
   data[index+2]=(data[index+2]!+cx*3+cy*5)%256;
  }
  const detected=detectNineSliceSelection({...s,pixels:{...p,data}});
  expect(detected).not.toBeNull();expect(detected!.border).toBeLessThanOrEqual(b);
 }),{numRuns:20});
},30_000);
it("rejects thick near misses, cut corners, objects, solid colour and partial transparency",()=>{
 const s=artwork(2,2,2),p=s.pixels!,t=s.tileset;
 for(const kind of ["cut","seam","objects","solid","empty"]){
  const data=p.data.slice();
  for(let y=0;y<s.rect.height;y++)for(let x=0;x<s.rect.width;x++)for(let py=0;py<t.tileHeight;py++)for(let px=0;px<t.tileWidth;px++){
   const index=((t.margin+(s.rect.row+y)*(t.tileHeight+t.spacing)+py)*p.width+t.margin+(s.rect.col+x)*(t.tileWidth+t.spacing)+px)*4;
   if(kind==="cut"&&x<2&&y<2)data.set([0,0,0,0],index);
   if(kind==="seam"&&x===3&&y===0&&px===0)data.set([255,0,0,255],index);
   if(kind==="objects")data.set([(x*71+y*29+px*13)%256,(y*43+py*19)%256,120,255],index);
   if(kind==="solid")data.set([120,120,120,255],index);
   if(kind==="empty"&&x===3&&y===3)data[index+3]=0;
  }
  expect(detectNineSliceSelection({...s,pixels:{...p,data}}),kind).toBeNull();
 }
});

import { applySmartStampPlan, planSmartStampArea, planSmartStampRoad } from "../src";
it("thick area plans preserve window phase, locked/hidden feedback, and undo/redo across every target size",()=>{
 const {store,stamp,layer}=prepared(2),initial=serializeLevel(store.document);
 for(const orientation of orientations)for(const width of [1,2,3,4,5,11])for(const height of [1,2,3,4,5,10]){
  const rect={x:3,y:3,width,height},options={revision:store.revision,orientation,mapping:[{clipLayerId:"s",targetLayerId:layer.id,name:layer.name}]};
  const plan=planSmartStampArea(store.document,stamp,rect,options),preview=planSmartStampArea(store.document,stamp,rect,{...options,window:{x:4,y:4,width:4,height:4}});
  for(const l of preview.layers)for(const w of l.writes)expect(plan.layers[0]!.writes).toContainEqual(w);
  applySmartStampPlan(store,plan);const after=serializeLevel(store.document);store.undo();expect(serializeLevel(store.document)).toBe(initial);store.redo();expect(serializeLevel(store.document)).toBe(after);store.undo();
 }
 for(const props of [{locked:true},{locked:false,visible:false}]){
  store.dispatch({type:"setLayerProps",layerId:layer.id,props});
  expect(planSmartStampArea(store.document,stamp,{x:1,y:1,width:5,height:5},{revision:store.revision,mapping:[{clipLayerId:"s",targetLayerId:layer.id,name:layer.name}]}).layers[0]?.writes).toEqual([]);
 }
},30_000);
it("macro preview is a subset of full connectivity and partial/foreign patches stay fixed",()=>{
 const {store,stamp,layer}=prepared(3),member=roadMembership([{x:3,y:3},{x:6,y:3},{x:9,y:3},{x:9,y:6}]);
 const options={revision:store.revision};const full=planSmartStampRoad(store.document,stamp,layer.id,member,options),preview=planSmartStampRoad(store.document,stamp,layer.id,member,{...options,window:{x:5,y:2,width:2,height:2}});
 for(const w of preview.layers[0]!.writes)expect(full.layers[0]!.writes).toContainEqual(w);
 applySmartStampPlan(store,full);
 const broken=layer.getCell(6,3);store.dispatch({type:"paintCells",layerId:layer.id,cells:[{x:6,y:3,cell:0}]});
 const before=Array.from({length:9},(_,i)=>layer.getCell(6+i%3,3+Math.floor(i/3)));
 applySmartStampRoad(store,stamp,layer.id,roadMembership([{x:3,y:3}]),{erase:true});
 expect(Array.from({length:9},(_,i)=>layer.getCell(6+i%3,3+Math.floor(i/3)))).toEqual(before);expect(broken).not.toBe(0);
});
it("layout-2 provenance cannot change its band or slot identity after publication",()=>{
 const {store,stamp,atlas}=prepared(2);
 expect(()=>store.dispatch({type:"setTilesetMeta",tilesetId:atlas.id,generated:{...atlas.generated!,border:3}})).toThrow();
 expect(()=>prepareNineSliceTileset({...stamp,nineSlice:{...stamp.nineSlice!,border:1}},"s",{id:atlas.id,imagePath:atlas.imagePath,tileWidth:16,tileHeight:16,tilesets:store.document.tilesets,imageHashes:new Map([["source","new"]])})).toThrow(/layout/);
});
it("packs thick atlases compactly without changing their permanent slots",()=>{
 const {atlas,stamp}=prepared(4),layout=nineSliceLayout(stamp);
 expect(atlas.columns).toBeGreaterThanOrEqual(Math.sqrt(layout.slots));
 expect(Math.max(atlas.columns,atlas.rows)/Math.min(atlas.columns,atlas.rows)).toBeLessThan(2);
});

/** Independent review's opaque relief and globally periodic texture repros. */
function reviewArt(w:number,h:number,texture=false):NineSliceSelectionInput {
 const size=16,width=w*size,height=h*size,data=new Uint8Array(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const px=x%size,py=y%size,d=Math.min(x,y,width-1-x,height-1-y);
  const v=texture?(px===0||py===0||px===size-1||py===size-1?120:40+Math.floor(x/size)%3*35+Math.floor(y/size)%3*20):Math.min(180,40+Math.floor(d*140/(2*size)));
  data.set([v,v,v,255],(y*width+x)*4);
 }
 return {tileset:{id:"source",columns:w,rows:h,tileWidth:size,tileHeight:size,margin:0,spacing:0},rect:{col:0,row:0,width:w,height:h},ids:Array.from({length:w*h},(_,i)=>i),emptyIds:new Set(),pixels:{width,height,data}};
}
it("rejects the review's 6×6 globally periodic texture without outer boundary evidence",()=>{
 expect(detectNineSliceSelection(reviewArt(6,6,true))).toBeNull();
});
it.each([[7,6],[6,7],[5,5]])("detects the review's %i×%i relief with two-tile bands and a positive centre span",(w,h)=>{
 expect(detectNineSliceSelection(reviewArt(w,h))?.border).toBe(2);
});
it("infers b independently of centre lengths, including centres shorter than b",()=>{
 fc.assert(fc.property(fc.integer({min:2,max:4}),fc.integer({min:1,max:7}),fc.integer({min:1,max:7}),fc.constantFrom(16,32),(b,cx,cy,size)=>{
  const s=artwork(b,1,1,size,1,2,2,1,2*b+cx,2*b+cy),result=detectNineSliceSelection(s);
  expect(result).not.toBeNull();expect(result!.border).toBeLessThanOrEqual(b);
 }),{numRuns:30});
},30_000);
it.each([[7,6],[6,7],[5,5]])("non-multiple %i×%i sources keep area phase, macro joins, saved metadata and regeneration slots",(n,m)=>{
 const {store,stamp,atlas,layer}=prepared(2,n,m),layout=nineSliceLayout(stamp);
 expect(layout.bank).toBe(n*m+6*(n+m)+36);
 const saved=parseStamp(serializeStamp(stamp));expect(saved).toEqual(stamp);
 for(const orientation of orientations)for(const width of [1,2,3,4,5,11])for(const height of [1,2,3,4,5,10]){
  const before=serializeLevel(store.document),plan=planSmartStampArea(store.document,saved,{x:3,y:3,width,height},{revision:store.revision,orientation,mapping:[{clipLayerId:"s",targetLayerId:layer.id,name:layer.name}]});
  expect(plan.layers[0]!.writes).toHaveLength(width*height);applySmartStampPlan(store,plan);store.undo();expect(serializeLevel(store.document)).toBe(before);
 }
 applySmartStampRoad(store,saved,layer.id,roadMembership([{x:4,y:4},{x:6,y:4}]));
 applySmartStampRoad(store,saved,layer.id,roadMembership([{x:8,y:4}]));
 for(let y=0;y<2;y++)for(let x=0;x<2;x++)expect(store.document.palette.get(layer.getCell(6+x,4+y)&0x1fffffff)?.tileId).toBe(layout.bank+BLOB47_MASKS.indexOf(68)*4+y*2+x);
 const reopened=parseLevel(serializeLevel(store.document),parseProject(serializeProject({name:"Thick",levels:[],tilesets:store.document.tilesets})).tilesets);
 expect(serializeLevel(reopened)).toBe(serializeLevel(store.document));
 const regenerated=prepareNineSliceTileset(saved,"s",{id:atlas.id,imagePath:atlas.imagePath,tilesets:reopened.tilesets,tileWidth:16,tileHeight:16,imageHashes:new Map([["source","changed"]])});
 expect({...regenerated.generated,sources:[]}).toEqual({...atlas.generated,sources:[]});expect(regenerated.columns).toBe(atlas.columns);expect(regenerated.rows).toBe(atlas.rows);
},30_000);
import { parseLevel, parseProject, serializeProject } from "../src";
