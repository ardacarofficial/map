import { expect, it } from 'vitest';
import { encodeSourcePng } from './sourcePng';
import { readPixelSource } from './pixelAssetIo';
import { clearTilesetImages, setTilesetImage, type TilesetImage } from '../state/tilesetImages';
it('captures straight-alpha source pixels on image publication, before the first brush read',()=>{
  clearTilesetImages();
  const source={id:'warm',name:'Source',imagePath:'tilesets/source.png',tileWidth:1,tileHeight:1,columns:1,rows:1,margin:0,spacing:0};
  const data=Uint8Array.of(18,52,86,7),image:TilesetImage={tilesetId:source.id,bytes:encodeSourcePng({width:1,height:1,data}),bitmap:{width:1,height:1,close(){}} as ImageBitmap};
  setTilesetImage(image);
  // The encoded payload need not remain available during a pointer sample.
  // A canvas fallback cannot reconstruct these exact low-alpha channels.
  image.bytes=undefined;
  expect(readPixelSource(source,0)!.data).toEqual(data);
  clearTilesetImages();
});
