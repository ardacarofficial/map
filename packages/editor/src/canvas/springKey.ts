/**
 * Spring-loaded Alt = temporary eyedropper (Photoshop / Aseprite habit).
 *
 * - Alt pressed: nothing yet ("pending").
 * - Held for {@link SPRING_HOLD_MS}, or a click while it is held: the
 *   eyedropper takes over ("active"); clicks pick from the map.
 * - Alt released: the tool that was active before comes back.
 * - A quick tap does nothing; another key pressed with Alt (a shortcut such
 *   as Alt+Tab) cancels a pending hold; focus loss always resets.
 *
 * Pure reducer: the canvas feeds it key / click / timer events and applies
 * the returned tool change. Unit tested.
 */
import type { ToolId } from "../state/editorStore";

/** Hold time after which Alt alone switches to the eyedropper. */
export const SPRING_HOLD_MS = 200;

export type SpringState =
  | { readonly phase: "idle" }
  | { readonly phase: "pending"; readonly since: number }
  | { readonly phase: "active"; readonly previous: ToolId };

export type SpringEvent =
  /** Alt went down (repeats are fine). `busy`: a drag is in progress, Alt belongs to it. */
  | { readonly type: "down"; readonly time: number; readonly busy?: boolean }
  /** Timer / any later moment while Alt is held. */
  | { readonly type: "tick"; readonly time: number }
  /** A map click while Alt is held. */
  | { readonly type: "click" }
  /** Another key was pressed while Alt is held. */
  | { readonly type: "otherKey" }
  /** Alt went up. */
  | { readonly type: "up" }
  /** Window lost focus / canvas went away. */
  | { readonly type: "reset" };

export interface SpringResult {
  readonly state: SpringState;
  /** Tool to switch to now, or null. */
  readonly setTool: ToolId | null;
}

export const SPRING_IDLE: SpringState = { phase: "idle" };

/**
 * Next state for `event`; `tool` is the store's current tool. Going back
 * only happens when the eyedropper is still the current tool (the user may
 * have picked another one meanwhile, which then wins).
 */
export function springStep(state: SpringState, event: SpringEvent, tool: ToolId): SpringResult {
  const stay = { state, setTool: null };
  switch (event.type) {
    case "down":
      if (state.phase !== "idle") return stay;
      if (event.busy || tool === "eyedropper") return stay;
      return { state: { phase: "pending", since: event.time }, setTool: null };
    case "tick":
      if (state.phase !== "pending" || event.time - state.since < SPRING_HOLD_MS) return stay;
      return activate(tool);
    case "click":
      return state.phase === "pending" ? activate(tool) : stay;
    case "otherKey":
      return state.phase === "pending" ? { state: SPRING_IDLE, setTool: null } : stay;
    case "up":
    case "reset":
      if (state.phase === "active") {
        return { state: SPRING_IDLE, setTool: tool === "eyedropper" ? state.previous : null };
      }
      return state.phase === "idle" ? stay : { state: SPRING_IDLE, setTool: null };
  }
}

function activate(tool: ToolId): SpringResult {
  if (tool === "eyedropper") return { state: SPRING_IDLE, setTool: null };
  return { state: { phase: "active", previous: tool }, setTool: "eyedropper" };
}
