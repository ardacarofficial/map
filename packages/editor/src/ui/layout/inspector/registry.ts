/**
 * Sections of the inspector (right column, above Layers). Each section says
 * when it applies; the inspector shows the matching ones in `order` (lower
 * first, top to bottom). Built-ins (PropertiesPanel.tsx): entity 10,
 * brush 20, grid-layer brush 30, map 90. Later features add their own with
 * `registerInspectorSection` (e.g. tileset settings at 40).
 */
import type { Entity, EntityLayer, MapDocument, TileLayer } from "@smap/core";
import type { ComponentType } from "react";

export interface InspectorContext {
  doc: MapDocument;
  /** The active layer, if any. */
  layer: TileLayer | undefined;
  /** The selected entity and its layer, when one is selected and still exists. */
  entity: { entity: Entity; layer: EntityLayer } | undefined;
}

export interface InspectorSection {
  /** Unique id; registering the same id again replaces the section. */
  id: string;
  order: number;
  when(ctx: InspectorContext): boolean;
  /** Rendered with the context; draws its own sub-heading if it wants one. */
  Component: ComponentType<{ ctx: InspectorContext }>;
}

const sections = new Map<string, InspectorSection>();
const listeners = new Set<() => void>();
let version = 0;

function changed(): void {
  version++;
  for (const l of [...listeners]) l();
}

/** Adds (or replaces) an inspector section. Returns a function that removes it. */
export function registerInspectorSection(section: InspectorSection): () => void {
  sections.set(section.id, section);
  changed();
  return () => {
    if (sections.get(section.id) !== section) return;
    sections.delete(section.id);
    changed();
  };
}

/** Sections that apply to `ctx`, in display order. */
export function inspectorSectionsFor(ctx: InspectorContext): InspectorSection[] {
  return [...sections.values()].filter((s) => s.when(ctx)).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function subscribeInspector(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function inspectorVersion(): number {
  return version;
}
