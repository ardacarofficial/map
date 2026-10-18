import { isEntityLayer, isGridLayer, isTileLayer, type MapDocument, type TileLayer } from "@smap/core";
import { useSyncExternalStore } from "react";

import { clampRegion } from "../../commands/enablement";
import { useRandomBrush } from "../../commands/randomBrush";
import { useEditorStore } from "../../state/editorStore";
import { useStructureVersion } from "../hooks";
import { useUiStore } from "../uiStore";
import { useStampLibrary } from "../stamps/stampLibraryStore";
import { useProjectLibrary } from "../../io/projectLibrary";
import { useTerrainDraft } from "../terrain/terrainDraft";
import { resolveTerrain } from "../terrain/terrainModel";
import { brushContent, inspectorMode, terrainEditActive, type LayerKind } from "./mode";
import { inspectorSectionsFor, inspectorVersion, subscribeInspector, type InspectorContext } from "./registry";
import { registerBuiltinInspectorSections } from "./sections";

registerBuiltinInspectorSections();

export function layerKind(layer: TileLayer | undefined): LayerKind {
  if (!layer) return "none";
  if (isEntityLayer(layer)) return "entity";
  if (isGridLayer(layer)) return "collision";
  return isTileLayer(layer) ? "tile" : "none";
}

/** The inspector context of the editor state right now. */
function useInspectorContext(doc: MapDocument): InspectorContext {
  const stampId = useStampLibrary((s) => s.selectedId);
  const libraryStamp = useProjectLibrary((s) => s.stamps.some((stamp) => stamp.id === stampId));
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const selectedEntityId = useEditorStore((s) => s.selectedEntityId);
  const tool = useEditorStore((s) => s.tool);
  const rawRegion = useEditorStore((s) => s.region);
  const brush = useEditorStore((s) => brushContent(s));
  const randomStamps = useRandomBrush((s) => s.stamps.length);
  const terrainBrush = useEditorStore((s) => s.terrainActive && resolveTerrain(doc, s.terrain) !== null);
  const tilesetMode = useUiStore((s) => s.tilesetMode);
  const terrainEdit = useTerrainDraft((s) => s.draft !== null || resolveTerrain(doc, s.fix) !== null);
  const layer = activeLayerId ? doc.getLayer(activeLayerId) : undefined;
  const found = selectedEntityId ? doc.findEntity(selectedEntityId) : undefined;
  const region = clampRegion(rawRegion, doc.map.width, doc.map.height);
  const mode = inspectorMode({
    entitySelected: found !== undefined,
    libraryStamp,
    layer: layerKind(layer),
    tool,
    region: region !== null,
    // Stamps alone make a random brush too (tileset agent's random sets).
    brush: brush === "tile" && randomStamps > 0 ? "random" : brush,
    solidEdit: tilesetMode === "solid",
    terrainBrush,
    terrainEdit: terrainEditActive(tilesetMode, terrainEdit),
  });
  return {
    doc,
    layer,
    entity: found ? { entity: found.entity, layer: found.layer } : undefined,
    mode,
    region: mode === "region" ? region : null,
  };
}

/**
 * The Denetçi tab's content: the cards of the current context (first
 * match wins, `mode.ts`) plus any section later features registered for
 * it. Mount it in the right column's "Denetçi" tab; it scrolls by itself.
 */
export function InspectorBody() {
  const store = useEditorStore((s) => s.project?.store);
  useStructureVersion(store);
  useSyncExternalStore(subscribeInspector, inspectorVersion);
  const doc = store?.document;
  if (!doc) return null;
  return <InspectorSections doc={doc} />;
}

function InspectorSections({ doc }: { doc: MapDocument }) {
  const ctx = useInspectorContext(doc);
  const sections = inspectorSectionsFor(ctx);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3" data-inspector data-inspector-mode={ctx.mode}>
      {sections.map(({ id, Component }) => (
        <div key={id} data-inspector-section={id}>
          <Component ctx={ctx} />
        </div>
      ))}
    </div>
  );
}
