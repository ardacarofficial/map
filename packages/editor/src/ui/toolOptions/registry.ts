
import type { MapDocument, TileLayer } from "@smap/core";
import type { ComponentType } from "react";

import type { ToolId } from "../../state/editorStore";
import type { BrushContent } from "../inspector/mode";

/** What an entry's `when` sees. */
export interface ToolOptionsContext {
  tool: ToolId;
  /** Current brush content, including floating paste clips. */
  brush: BrushContent;
  doc: MapDocument | undefined;
  /** The active layer, if any. */
  layer: TileLayer | undefined;
}

export interface ToolOptionsEntry {
  /** Unique id; registering the same id again replaces the entry. */
  id: string;
  tools: readonly ToolId[] | "all";
  /** Left-to-right position; built-ins use 10, 20, 30… */
  order: number;
  when?: (ctx: ToolOptionsContext) => boolean;
  Component: ComponentType;
}

export interface ToolOptionsOptions {
  /** Defaults to the tool list joined, plus a counter. */
  id?: string;
  order?: number;
  when?: (ctx: ToolOptionsContext) => boolean;
}

const entries = new Map<string, ToolOptionsEntry>();
const listeners = new Set<() => void>();
let version = 0;
let autoId = 0;

function changed(): void {
  version++;
  for (const l of [...listeners]) l();
}

/**
 * Adds options for `tool` (one id, a list, or "all"). Returns a function
 * that removes them again.
 *
 * @example registerToolOptions("fill", FillModeOptions, { order: 15 })
 */
export function registerToolOptions(
  tool: ToolId | readonly ToolId[] | "all",
  Component: ComponentType,
  options: ToolOptionsOptions = {},
): () => void {
  const tools = tool === "all" ? "all" : typeof tool === "string" ? [tool] : [...tool];
  const id = options.id ?? `${tools === "all" ? "all" : tools.join("+")}#${++autoId}`;
  const entry: ToolOptionsEntry = { id, tools, order: options.order ?? 50, Component, ...(options.when ? { when: options.when } : {}) };
  entries.set(id, entry);
  changed();
  return () => {
    if (entries.get(id) === entry) {
      entries.delete(id);
      changed();
    }
  };
}

/** Entries to show for `ctx`, in display order. */
export function toolOptionsFor(ctx: ToolOptionsContext): ToolOptionsEntry[] {
  return [...entries.values()]
    .filter((e) => (e.tools === "all" || e.tools.includes(ctx.tool)) && (e.when?.(ctx) ?? true))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** For `useSyncExternalStore`: re-render the bar when entries change. */
export function subscribeToolOptions(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function toolOptionsVersion(): number {
  return version;
}
