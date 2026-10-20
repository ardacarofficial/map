import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { encode } from 'fast-png';
import { decodeSourcePng, encodeSourcePng } from './sourcePng';
import { capturedPixelHash } from '../state/pixelProvenance';
import { rasterContentHash } from '@smap/core';
import { readPixelSource } from './pixelAssetIo';
import { clearTilesetImages, setTilesetImage } from '../state/tilesetImages';

describe('lossless source PNGs',()=>{
  it('preserves every RGBA8 byte, including invisible RGB and low alpha, for filtered/interlaced sources',()=>{
    fc.assert(fc.property(fc.integer({min:1,max:12}),fc.integer({min:1,max:8}),fc.uint8Array({minLength:384,maxLength:384}),(width,height,bytes)=>{
      const data=new Uint8Array(width*height*4);for(let i=0;i<data.length;i++)data[i]=bytes[i%bytes.length]!;
      const png=encode({width,height,channels:4,data},{interlace:'Adam7'});
      const decoded=decodeSourcePng(png);expect(decoded.data).toEqual(data);
      expect(decodeSourcePng(encodeSourcePng(decoded)).data).toEqual(data);
    }),{numRuns:40});
  });
  it('expands indexed transparency, greyscale and RGB without canvas colour conversion',()=>{
    const palette=[[12,34,56,7],[90,80,70,0]];
    expect(decodeSourcePng(encode({width:2,height:1,data:Uint8Array.of(0,1),channels:1,depth:8,palette})).data).toEqual(Uint8Array.of(12,34,56,7,90,80,70,0));
    expect(decodeSourcePng(encode({width:2,height:1,data:Uint8Array.of(0b01000000),channels:1,depth:1})).data).toEqual(Uint8Array.of(0,0,0,255,255,255,255,255));
    const rgb=encode({width:2,height:1,data:Uint8Array.of(4,5,6,7,8,9),channels:3,depth:8});
    // fast-png's encoder only emits indexed tRNS; supply a standards-compliant RGB chunk.
    const chunk=Uint8Array.of(0,0,0,6,116,82,78,83,0,4,0,5,0,6,0,0,0,0);let crc=0xffffffff;
    for(const b of chunk.subarray(4,14)){crc^=b;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    new DataView(chunk.buffer).setUint32(14,(crc^0xffffffff)>>>0);
    const transparent=new Uint8Array(rgb.length+chunk.length);transparent.set(rgb.subarray(0,33));transparent.set(chunk,33);transparent.set(rgb.subarray(33),33+chunk.length);
    expect(decodeSourcePng(transparent).data).toEqual(Uint8Array.of(4,5,6,0,7,8,9,255));
  });
  it('refuses corrupt and 16-bit sources before any write',()=>{
    const png=encode({width:1,height:1,channels:4,depth:16,data:Uint16Array.of(1,2,3,65535)});
    expect(()=>decodeSourcePng(png)).toThrow('Unsupported');
    const broken=encodeSourcePng({width:1,height:1,data:Uint8Array.of(1,2,3,255)});broken[29]=broken[29]!^1;
    expect(()=>decodeSourcePng(broken)).toThrow();
  });
  it('captures exact source pixels instead of premultiplied canvas readback',()=>{
    clearTilesetImages();const source={id:'low-alpha',name:'Source',imagePath:'tilesets/s.png',tileWidth:1,tileHeight:1,columns:1,rows:1,margin:0,spacing:0};
    const data=Uint8Array.of(18,52,86,7),bytes=encodeSourcePng({width:1,height:1,data});
    setTilesetImage({tilesetId:source.id,bytes,bitmap:{width:1,height:1,close(){}} as ImageBitmap});
    const pixels=readPixelSource(source,0)!;expect(pixels.data).toEqual(data);
    expect(capturedPixelHash(rasterContentHash(1,1,pixels.data),source)).toContain('|[1,1,1,1,0,0]');clearTilesetImages();
  });
});
