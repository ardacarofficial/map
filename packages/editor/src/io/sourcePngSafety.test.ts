import { LevelWorkspace } from './levelWorkspace';
import { syncLevelGrids } from './tilesetRegrid';
import { describe, expect, it } from 'vitest';
import { createDocument, MapStore, encodeRgbaPng } from '@smap/core';
import { MemoryFileSystem } from './memoryFs';
import { saveProject } from './projectIo';
const source={id:'s',name:'Source',imagePath:'tilesets/original.png',tileWidth:1,tileHeight:1,columns:1,rows:1,margin:0,spacing:0};
describe('ordinary saves cannot modify existing source PNGs',()=>{
  it('preserves external disk changes even when the editor still holds stale source bytes',async()=>{
    const fs=new MemoryFileSystem(),original=encodeRgbaPng(1,1,Uint8Array.of(1,2,3,255));
    const input={name:'World',document:createDocument({width:4,height:4,tilesets:[source]}),levelPath:'levels/main.json',tilesetBytes:()=>original};
    await saveProject(fs,input);const external=encodeRgbaPng(1,1,Uint8Array.of(4,5,6,255));await fs.writeBytes(source.imagePath,external);
    await saveProject(fs,input);expect(await fs.readBytes(source.imagePath)).toEqual(external);
  });
  it('creates imported images and immutable source revisions in new destinations',async()=>{
    const fs=new MemoryFileSystem(),png=encodeRgbaPng(1,1,Uint8Array.of(1,2,3,255));const revision={...source,imagePath:'tilesets/replacement-revision.png'};
    await saveProject(fs,{name:'World',document:createDocument({width:4,height:4,tilesets:[source, {...revision,id:'r'}]}),levelPath:'levels/main.json',tilesetBytes:()=>png});
    expect(await fs.readBytes(source.imagePath)).toEqual(png);expect(await fs.readBytes(revision.imagePath)).toEqual(png);
  });
});

it('keeps source revision paths synchronized across maps and restores both paths on undo/redo',()=>{
  for(const columns of [1,3]) {
    const a=new MapStore(createDocument({width:4,height:4,tileWidth:1,tileHeight:1,tilesets:[source]}));
    const ws=new LevelWorkspace({name:'World',levels:[{id:'a',name:'A',path:'levels/a.json',world:{x:0,y:0}}],active:{id:'a',store:a,knownText:null}});
    const b=ws.add({name:'B',width:4,height:4,tileSize:1,layerName:'Ground'});const other=ws.entry(b.id)!.store;
    a.dispatch({type:'replaceTilesetImage',tilesetId:source.id,imageWidth:columns,imageHeight:1,imagePath:'tilesets/revision.png'});syncLevelGrids(ws);
    expect(other.document.getTileset(source.id)!.imagePath).toBe('tilesets/revision.png');
    a.undo();syncLevelGrids(ws);expect(other.document.getTileset(source.id)!.imagePath).toBe(source.imagePath);
    a.redo();syncLevelGrids(ws);expect(other.document.getTileset(source.id)!.imagePath).toBe('tilesets/revision.png');
  }
});

it('reserves existing orphan PNG filenames when creating a world with imported tilesets',async()=>{
  const {newProject,closeProject}=await import('./session');const {useEditorStore}=await import('../state/editorStore');const {browserPlatform,setPlatform}=await import('../platform');
  const fs=new MemoryFileSystem(),original=encodeRgbaPng(1,1,Uint8Array.of(1,2,3,255)),replacement=encodeRgbaPng(1,1,Uint8Array.of(4,5,6,255));await fs.writeBytes('tilesets/source.png',original);
  setPlatform({...browserPlatform,watchProject:()=>{},recents:{...browserPlatform.recents,add:async()=>{},list:async()=>[]}});
  try {
    await newProject({name:'World',width:4,height:4,tileSize:1,folder:{fs,ref:'world',label:'World'},tilesets:[{name:'Source',png:{file:{name:'source.png'} as File,bytes:replacement,bitmap:{width:1,height:1,close(){}} as ImageBitmap},spec:{tileWidth:1,tileHeight:1,margin:0,spacing:0}}]});
    const imported=useEditorStore.getState().project!.store.document.tilesets[0]!;
    expect(imported.imagePath).not.toBe('tilesets/source.png');expect(await fs.readBytes(imported.imagePath)).toEqual(replacement);expect(await fs.readBytes('tilesets/source.png')).toEqual(original);
  } finally {closeProject();setPlatform(browserPlatform);}
},30_000);
