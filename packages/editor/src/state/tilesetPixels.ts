import type { TilesetBitmap } from "./tilesetImages";
/** Decoded selected rectangles live outside UI state, keyed by immutable image snapshots. */
import type { NineSliceSelectionInput } from "@smap/core";
type Pixels=NonNullable<NineSliceSelectionInput["pixels"]>;
const cache=new WeakMap<TilesetBitmap,Map<string,Pixels>>();
export function tilesetPixels(bitmap:TilesetBitmap,rect:{x:number;y:number;width:number;height:number}):Pixels {
  const key=JSON.stringify(rect);let byRect=cache.get(bitmap);const hit=byRect?.get(key);if(hit)return hit;
  const canvas=document.createElement("canvas");canvas.width=rect.width;canvas.height=rect.height;
  const ctx=canvas.getContext("2d",{willReadFrequently:true});if(!ctx)throw new Error("Canvas unavailable");
  ctx.drawImage(bitmap,rect.x,rect.y,rect.width,rect.height,0,0,rect.width,rect.height);
  const image=ctx.getImageData(0,0,rect.width,rect.height);
  const pixels={width:rect.width,height:rect.height,data:image.data,originX:rect.x,originY:rect.y};
  if(!byRect){byRect=new Map();cache.set(bitmap,byRect);}if(byRect.size>=16)byRect.delete(byRect.keys().next().value!);byRect.set(key,pixels);return pixels;
}
