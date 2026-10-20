import { AgentError, AgentErrorCode, type AgentSignal, type AgentWriteGate, type SaveAdmission } from "@smap/agent";
import { t } from "../i18n";
import { toast } from "../ui/toast/toastStore";

/** Save admission spans preparation, queueing, files, backups and export listeners. */
export function createEditGate(currentWorld: () => string | null): AgentWriteGate {
  const saves = new Set<object>(), listeners = new Set<() => void>();
  let edit: object | null = null;
  const emit = () => { for (const cb of listeners) { try { cb(); } catch { console.warn("Agent write gate observer failed"); } } };
  const world = (id: string) => { if (id !== currentWorld()) throw new AgentError(AgentErrorCode.STALE_WORLD, "World has changed"); };
  const pending = () => { throw new AgentError(AgentErrorCode.WRITER_BUSY, "AI edit pending approval"); };
  return {
    get blocked() { return edit !== null; },
    subscribe(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    assertSaveAllowed(id) { world(id); if (edit) pending(); },
    admitSave(worldSessionId) {
      world(worldSessionId); if (edit) pending();
      const token = {}; saves.add(token);
      return { worldSessionId, assertAllowed() { world(worldSessionId); if (!saves.has(token)) pending(); }, release() { if (saves.delete(token)) emit(); } };
    },
    acquireEdit(worldSessionId) {
      world(worldSessionId); if (edit) pending();
      const token = {}; edit = token; emit();
      const assertCurrent = () => { world(worldSessionId); if (edit !== token) throw new AgentError(AgentErrorCode.CANCELLED, "Edit admission ended"); };
      return {
        worldSessionId, assertCurrent,
        waitForWrites(signal: AgentSignal, deadline: number) {
          assertCurrent(); signal.throwIfAborted();
          if (!saves.size) return Promise.resolve();
          return new Promise<void>((resolve, reject) => {
            let offAbort = () => {};
            const done = (error?: unknown) => { clearTimeout(timer); listeners.delete(check); offAbort(); if (error) reject(error); else resolve(); };
            const check = () => { try { assertCurrent(); signal.throwIfAborted(); if (!saves.size) done(); } catch (e) { done(e); } };
            const timer = setTimeout(() => done(new AgentError(AgentErrorCode.TIMEOUT, "Save drain timed out")), Math.max(0, deadline - Date.now()));
            listeners.add(check);
            offAbort = signal.onAbort(() => done(new AgentError(AgentErrorCode.CANCELLED, "Save drain cancelled")));
            check();
          });
        },
        release() { if (edit === token) { edit = null; emit(); } },
      };
    },
  };
}

let worldSessionId: string | null = null;
export const editGate = createEditGate(() => worldSessionId);
export const getAgentWorldSessionId = () => worldSessionId;
export function resetAgentWorld(): void { worldSessionId = crypto.randomUUID(); }
export function clearAgentWorld(): void { worldSessionId = null; }
let cancelPending: (() => Promise<void>) | null = null;
export function registerPendingCancellation(cancel: () => Promise<void>): () => void { cancelPending = cancel; return () => { if (cancelPending === cancel) cancelPending = null; }; }
export async function cancelPendingEdit(): Promise<void> {
  if (!editGate.blocked) return;
  if (!cancelPending) throw new AgentError(AgentErrorCode.EDITOR_UNAVAILABLE, "Pending edit runtime unavailable");
  await cancelPending();
  if (editGate.blocked) throw new AgentError(AgentErrorCode.WRITER_BUSY, "Edit cancellation is still pending");
}
export function manualEditAllowed(notify = true): boolean {
  if (!editGate.blocked) return true;
  if (notify) toast.warning(t("aiRuntime.editLocked"));
  return false;
}
export function saveDeferred(): boolean {
  if (!editGate.blocked) return false;
  toast.warning(t("aiRuntime.saveDeferred")); return true;
}

/** Legacy temporary documents have no world; they still respect the pending lock. */
export function admitEditorSave(): SaveAdmission {
  const id = getAgentWorldSessionId();
  if (id) return editGate.admitSave(id);
  if (editGate.blocked) throw new AgentError(AgentErrorCode.WRITER_BUSY, "AI edit pending approval");
  return { worldSessionId: "", assertAllowed() { if (getAgentWorldSessionId() !== null) throw new AgentError(AgentErrorCode.STALE_WORLD, "World has changed"); }, release() {} };
}

let flushWorld: (() => Promise<void>) | null = null;
export function registerAgentWorldFlush(flush: () => Promise<void>): () => void { flushWorld=flush; return()=>{if(flushWorld===flush)flushWorld=null;}; }
export const hasAgentWorldFlush = () => flushWorld !== null;
export async function prepareAgentWorldChange(): Promise<void> { await cancelPendingEdit(); await flushWorld?.(); }

let worldChangeDepth = 0;
export const agentWorldChanging = () => worldChangeDepth > 0;
export function enterAgentWorldChange(): () => void {
  worldChangeDepth++;
  let released=false;
  return()=>{if(!released){released=true;worldChangeDepth--;}};
}
