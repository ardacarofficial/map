import { expect, it } from 'vitest';
import { createDocument, MapStore, parseProject, parseLevel, serializeProject, serializeLevel, exportGameJson, exportUnityMap, exportTmj, layerDrawList, FLIP_H, makeCell } from '../src';
it('edited assets keep normal PNG paths, atlas coordinates and flags in JSON, Unity, TMJ and PNG plans', () => {
  const store=new MapStore(createDocument({width:4,height:4,tileWidth:1,tileHeight:1}));
  const layerId=store.dispatch({type:'addLayer',layer:{name:'Tiles'}});
  const slot=store.dispatch({type:'allocateEditedTile',tileWidth:1,tileHeight:1,pixels:new Uint8Array([1,2,3,255])});
  store.dispatch({type:'paintCells',layerId,cells:[{x:1,y:2,cell:makeCell(slot.paletteIndex,FLIP_H)}]});
  const doc=store.document,ts=doc.tilesets[0]!;
  const project=parseProject(serializeProject({name:'P',levels:[],tilesets:doc.tilesets}));
  const loaded=parseLevel(serializeLevel(doc),project.tilesets);
  expect(loaded.tilesets[0]!.edited).toEqual(ts.edited);
  expect(exportGameJson(loaded)).toContain(ts.imagePath.split('/').pop());
  for(const result of [exportUnityMap(loaded,'Main'),exportTmj(loaded,'Main')]){
    expect(result.images).toHaveLength(1);
    expect(result.images[0]!.sourcePath).toBe(ts.imagePath);
    expect(result.text).toContain(ts.imagePath.split('/').pop());
  }
  const draw=layerDrawList(loaded).layers[0]!.items[0]!;
  expect(draw.tileset.edited).toEqual(ts.edited);
  expect(draw.flipH).toBe(true);
  expect(draw.src).toEqual({x:0,y:0,width:1,height:1});
});
