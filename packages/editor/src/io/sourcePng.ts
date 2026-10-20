import { UnsupportedPngError, workingSource, sourceGamma } from './sourcePngFormat';
/** Lossless PNG decoding without canvas premultiplication or colour conversion. */
import { convertIndexedToRgb, decode, encode } from 'fast-png';
import { assertRasterSize, type RgbaImage } from '@smap/core';
export function decodeSourcePng(bytes: Uint8Array): RgbaImage {
  if (bytes.length < 33) throw Error('Invalid PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assertRasterSize(view.getUint32(16), view.getUint32(20));
  // A single RGBA8 edit cannot preserve a 16-bit or animated source faithfully.
  if (bytes[24] === 16) throw new UnsupportedPngError('depth');
  let input=bytes, transparency:Uint16Array|undefined;
  for (let p=8;p+12<=bytes.length;) {
    const n=view.getUint32(p), type=String.fromCharCode(...bytes.subarray(p+4,p+8));
    if(p+n+12>bytes.length)throw Error('Invalid PNG chunk');
    if(type==='acTL')throw new UnsupportedPngError('animation');
    if(type==='tRNS' && (bytes[25]===0||bytes[25]===2)) {
      // fast-png 8 incorrectly bounds RGB tRNS by pixel count. Parse this small
      // standards-defined chunk ourselves, retaining its CRC check even when removed.
      const channels=bytes[25]===0?1:3;
      if(transparency||n!==channels*2)throw Error('Invalid PNG transparency');
      let crc=0xffffffff;
      for(const b of bytes.subarray(p+4,p+8+n)){crc^=b;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
      if(((crc^0xffffffff)>>>0)!==view.getUint32(p+8+n))throw Error('Invalid PNG CRC');
      transparency=new Uint16Array(channels);for(let c=0;c<channels;c++)transparency[c]=view.getUint16(p+8+c*2);
      input=new Uint8Array(bytes.length-n-12);input.set(bytes.subarray(0,p));input.set(bytes.subarray(p+n+12),p);
    }
    p+=n+12;
  }
  const png = decode(input, { checkCrc: true });
  const { width, height } = png;
  let samples: Uint8Array;
  let channels = png.channels;
  if (png.palette) { samples = convertIndexedToRgb(png); channels = png.palette[0]!.length; }
  else if (png.depth < 8) {
    samples = new Uint8Array(width * height);
    const mask = (1 << png.depth) - 1, stride = Math.ceil(width * png.depth / 8);
    for (let y=0;y<height;y++) for(let x=0;x<width;x++) samples[y*width+x] = (png.data[y*stride+Math.floor(x*png.depth/8)]! >>> (8-png.depth-(x*png.depth%8))) & mask;
  } else samples = new Uint8Array(png.data);
  const data = new Uint8Array(width * height * 4), scale = png.palette || png.depth === 8 ? 1 : 255 / ((1 << png.depth) - 1);
  for (let i=0;i<width*height;i++) {
    const p=i*channels, q=i*4;
    const grey=channels<=2;
    data[q]=samples[p]!*scale; data[q+1]=samples[p+(grey?0:1)]!*scale; data[q+2]=samples[p+(grey?0:2)]!*scale;
    const transparent = transparency?.length && transparency.every((v,c)=>samples[p+c]===v);
    data[q+3]=channels===2 || channels===4 ? samples[p+channels-1]! : transparent ? 0 : 255;
  }
  return { width, height, data };
}
/** Unlike the edited-atlas encoder, this preserves RGB underneath transparent pixels. */
export function encodeSourcePng(image: RgbaImage): Uint8Array {
  return encode({ width: image.width, height: image.height, data: image.data, channels: 4, depth: 8 });
}

export function decodeWorkingSourcePng(bytes: Uint8Array): RgbaImage { sourceGamma(bytes); return workingSource(decodeSourcePng(bytes), bytes); }
