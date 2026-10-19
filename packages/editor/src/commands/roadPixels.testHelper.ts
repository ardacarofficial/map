/** Continuous repeatable bordered artwork at the requested native resolution. */
export function roadPixels(rect:{x:number;y:number;width:number;height:number}) {
 const {width,height}=rect,data=new Uint8Array(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const edge=Math.min(x,y,width-1-x,height-1-y),v=edge<3?40:edge<5?90:160;
  data.set([v,v+10,v+20,255],(y*width+x)*4);
 }
 return {width,height,data,originX:rect.x,originY:rect.y};
}
