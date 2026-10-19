import { expect,it } from "vitest";
import { createDocument, MapStore, makeCell, FLIP_H, parseLevel, parseProject, parseStamp, serializeLevel, serializeProject, serializeStamp, buildLayout1RoadProfile, type Stamp } from "../src";
import { migrateV5 } from "../src/migrations/v5";
import { source } from "./smartStampHelpers";
it("v4→v5 changes only the version header, retaining source flags, off preference and the complete layout-1 ABI",()=>{
 const ts={id:"baked",name:"Road (yol)",imagePath:"tilesets/baked.png",tileWidth:16,tileHeight:16,columns:8,rows:8,margin:0,spacing:0,generated:{kind:"nineSlice" as const,stampId:"road",layerId:"s",sourceWidth:3,sourceHeight:3,layoutVersion:1 as const,sources:[{tilesetId:"source",imageHash:"hash"}]},roadProfile:buildLayout1RoadProfile(3,3)};
 const stamp:Stamp={...source(),id:"road",name:"Road",smartDisabled:true,nineSlice:{border:1,tileLayers:[{layerId:"s",tilesetId:"baked"}],road:{tilesetId:"baked",profile:ts.roadProfile}}};
 const store=new MapStore(createDocument({width:8,height:8,tileWidth:16,tileHeight:16}));store.dispatch({type:"addTileset",tileset:ts});const layerId=store.dispatch({type:"addLayer",layer:{name:"Ground"}});store.dispatch({type:"paintCells",layerId,cells:[{x:2,y:3,cell:makeCell(store.getOrAddPaletteIndex("baked",31),FLIP_H)}]});
 const project=serializeProject({name:"P",tilesets:[ts],levels:[],generatedRecipes:[stamp]}),level=serializeLevel(store.document),saved=serializeStamp(stamp);
 const old=(s:string)=>s.replaceAll('"documentFormatVersion": 5','"documentFormatVersion": 4');
 expect(serializeProject(parseProject(old(project)))).toBe(project);
 expect(serializeLevel(parseLevel(old(level),[ts]))).toBe(level);
 expect(serializeStamp(parseStamp(old(saved)))).toBe(saved);
 const input=Object.freeze(JSON.parse(old(project))),before=JSON.stringify(input),next=migrateV5(input);
 expect(JSON.stringify(input)).toBe(before);expect(migrateV5(next)).toBe(next);expect(next.generatedRecipes).toEqual([JSON.parse(saved)]);
});
