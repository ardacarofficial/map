/** Only the explicit editor sharing action publishes a crop. One bounded snapshot per world. */
import { AGENT_LIMITS, AgentError, AgentErrorCode } from "@smap/agent";
import { canonicalRgba, type RgbaImage } from "@smap/core";
let shared: { selectionToken:string; world:string; pixels:RgbaImage } | null=null;
export function clearSelectedReference():void { shared=null; }
export function publishSelectedReference(world:string,pixels:RgbaImage):void {
  if(pixels.width<1||pixels.height<1||pixels.width>AGENT_LIMITS.imageSide||pixels.height>AGENT_LIMITS.imageSide||pixels.width*pixels.height>AGENT_LIMITS.imagePixels)
    throw new AgentError(AgentErrorCode.LIMIT_EXCEEDED,"Selected reference exceeds image budget");
  const data=canonicalRgba(pixels.width,pixels.height,new Uint8Array(pixels.data));
  let visible=false;for(let i=3;i<data.length;i+=4)if(data[i]){visible=true;break;}
  if(!visible)throw new AgentError(AgentErrorCode.INVALID_ARGUMENT,"Selected reference contains no visible pixel");
  shared={selectionToken:crypto.randomUUID(),world,pixels:{width:pixels.width,height:pixels.height,data}};
}
export function selectedReferenceInfo(world:string|null) {
  return shared&&shared.world===world?{selectionToken:shared.selectionToken,width:shared.pixels.width,height:shared.pixels.height}:null;
}
export function resolveSelectedReference(selectionToken:string,world:string):RgbaImage {
  if(!shared||shared.selectionToken!==selectionToken||shared.world!==world)throw new AgentError(AgentErrorCode.UNKNOWN_ID,"Unknown explicitly shared reference in this world");
  return {width:shared.pixels.width,height:shared.pixels.height,data:shared.pixels.data.slice()};
}
