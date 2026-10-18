
import type { Entity, EntityLayer, MapDocument, TileLayer } from "@smap/core";
import type { ComponentType } from "react";

import type { CellRegion } from "../../state/editorStore";
import type { InspectorMode } from "./mode";

export interface InspectorContext {
  doc: MapDocument;
  /** The active layer, if any. */
  layer: TileLayer | undefined;
  /** The selected entity and its layer, when one is selected and still exists. */
  entity: { entity: Entity; layer: EntityLayer } | undefined;
  /** What the inspector is about right now (first match wins). */
  mode: InspectorMode;
  /** The marquee region (clipped to the map) in "region" mode, else null. */
  region: CellRegion | null;
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
