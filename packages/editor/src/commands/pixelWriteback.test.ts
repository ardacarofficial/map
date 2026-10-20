import { describe, expect, it } from 'vitest';
import { createDocument, MapStore, rasterContentHash, type Tileset } from '@smap/core';
import { collectPngVariants, variantGroups } from './pixelWriteback';
import { capturedPixelHash } from '../state/pixelProvenance';
const source: Tileset = { id:'source',name:'Source',imagePath:'tilesets/s.png',tileWidth:2,tileHeight:2,columns:1,rows:1,margin:0,spacing:0 };
describe('PNG variant selection',()=>{
  it('collects independent clones and never arbitrarily selects a conflicting variant',()=>{
    const store = new MapStore(createDocument({ width:4,height:4,tilesets:[source] }));
    const data=new Uint8Array(16).fill(255), hash=capturedPixelHash(rasterContentHash(2,2,data),source);
    for(const value of [1,2]) { const pixels=data.slice();pixels[0]=value; store.dispatch({type:'allocateEditedTile',tileWidth:2,tileHeight:2,pixels,source:{tilesetId:'source',tileId:0,pixelHash:hash}}); }
    const variants=collectPngVariants(store);
    expect(variants).toHaveLength(2); expect(variants.every(v=>!v.reason)).toBe(true);
    const groups=variantGroups(variants,source); expect(groups).toHaveLength(1); expect(groups[0]!.variants).toHaveLength(2); expect(groups[0]!.choice).toBeNull();
  });
  it('lists road, expanded, missing and legacy-grid provenance as not applicable',()=>{
    const road={...source,id:'road',generated:{kind:'nineSlice',layoutVersion:1,stampId:'stamp',layerId:'l',sourceWidth:3,sourceHeight:3,sources:[]}} as unknown as Tileset;
    const store=new MapStore(createDocument({width:4,height:4,tilesets:[source,road]})), pixels=new Uint8Array(16).fill(255);
    for(const id of ['road','missing','source']) store.dispatch({type:'allocateEditedTile',tileWidth:2,tileHeight:2,pixels,source:{tilesetId:id,tileId:0,pixelHash:'legacy'}});
    store.dispatch({type:'allocateEditedTile',tileWidth:3,tileHeight:2,pixels:new Uint8Array(24),source:{tilesetId:'source',tileId:0,pixelHash:'legacy'}});
    expect(collectPngVariants(store).map(v=>v.reason)).toEqual(['road','missing','grid','size']);
  });
});

it('resolves copies of shared edited tiles back to their unambiguous source and groups every descendant conflict',()=>{
  const store=new MapStore(createDocument({width:4,height:4,tilesets:[source]}));const original=new Uint8Array(16).fill(255),base=capturedPixelHash(rasterContentHash(2,2,original),source);
  let slot=store.dispatch({type:'allocateEditedTile',tileWidth:2,tileHeight:2,pixels:original,source:{tilesetId:source.id,tileId:0,pixelHash:base}});
  for(const value of [12,24]){
    const parent=store.document.getTileset(slot.assetId)!,pixels=original.slice();pixels[0]=value;
    slot=store.dispatch({type:'allocateEditedTile',tileWidth:2,tileHeight:2,pixels,source:{tilesetId:slot.assetId,tileId:slot.tileId,pixelHash:capturedPixelHash(rasterContentHash(2,2,original),parent)}});
  }
  const variants=collectPngVariants(store);expect(variants.every(v=>!v.reason&&v.source?.id===source.id&&v.baseHash===base)).toBe(true);
  expect(variantGroups(variants,source)[0]!.variants).toHaveLength(3);expect(variantGroups(variants,source)[0]!.choice).toBeNull();
});
