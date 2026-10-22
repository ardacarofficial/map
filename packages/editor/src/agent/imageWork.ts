import { AgentError, AgentErrorCode, type AgentCallContext } from "@smap/agent";

/** Check synchronous work too: a timer cannot expire while raster work owns
 * the event loop. Occasionally yield a macrotask so Stop can reach the call. */
export function imageWork(call: AgentCallContext): () => Promise<void> | undefined {
  let nextYield=Date.now()+8;
  const check=()=>{
    call.signal.throwIfAborted();
    if(Date.now()>=call.deadline)throw new AgentError(AgentErrorCode.TIMEOUT,"Image preparation deadline expired");
  };
  return ()=>{
    check();
    if(Date.now()<nextYield)return;
    return new Promise<void>(resolve=>setTimeout(resolve,0)).then(()=>{check();nextYield=Date.now()+8;});
  };
}
