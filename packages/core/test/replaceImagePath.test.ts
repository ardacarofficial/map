import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createDocument, MapStore, serializeLevel, serializeProject } from '../src';
const source={id:'s',name:'Source',imagePath:'tilesets/original.png',tileWidth:16,tileHeight:16,columns:2,rows:2,margin:0,spacing:0};
const snapshot=(s:MapStore)=>serializeLevel(s.document)+serializeProject({name:'World',tilesets:s.document.tilesets,levels:[]});
describe('source image replacement revision paths',()=>{
  it('is deterministic and undo/redo restores path and document exactly without renumbering cells',()=>{
    fc.assert(fc.property(fc.nat(),fc.integer({min:1,max:4}),(revision,columns)=>{
      const run=()=>{
        const s=new MapStore(createDocument({width:4,height:4,tilesets:[source]}));const layerId=s.dispatch({type:'addLayer',layer:{name:'Ground'}});const index=s.getOrAddPaletteIndex(source.id,0);s.dispatch({type:'paintCells',layerId,cells:[{x:0,y:0,cell:index}]});s.clearHistory();
        const before=snapshot(s),path=`tilesets/replaced-${revision}.png`;
        s.dispatch({type:'replaceTilesetImage',tilesetId:source.id,imageWidth:columns*16,imageHeight:32,imagePath:path});
        expect(s.document.getTileset(source.id)!.imagePath).toBe(path);expect(s.document.getLayer(layerId)!.getCell(0,0)).toBe(index);
        const after=snapshot(s);s.undo();expect(snapshot(s)).toBe(before);s.redo();expect(snapshot(s)).toBe(after);return after;
      };expect(run()).toBe(run());
    }),{numRuns:40});
  });
});
