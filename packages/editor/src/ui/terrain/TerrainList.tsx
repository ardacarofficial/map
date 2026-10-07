import { isGridLayer, terrainSlotTileId, terrainTemplateInfo, type Terrain, type Tileset } from "@smap/core";
import { useState } from "react";

import { activateTerrain, deleteTerrain, renameTerrain } from "../../commands/terrainActions";
import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { Icon } from "../primitives/Icon";
import { RenameInput } from "../primitives/RenameInput";
import { TileSwatch } from "../primitives/TileSwatch";
import { templateShortName } from "./TemplatePicker";
import { fillSlot } from "./templateGlyph";

/** Id of the terrain the brush paints right now, or null. */
export function useActiveTerrainId(): number | null {
  return useEditorStore((s) => {
    const layer = s.activeLayerId ? s.project?.store.document.getLayer(s.activeLayerId) : undefined;
    return isGridLayer(layer) && layer.role === "terrain" ? s.gridValue : null;
  });
}

/** A terrain's representative tile (the fully surrounded one). */
export function terrainSwatchTile(tileset: Tileset, terrain: Terrain): number {
  return terrainSlotTileId(tileset, terrain, fillSlot(terrainTemplateInfo(terrain.template)));
}

/**
 * Terrains of one tileset. Clicking one makes it the brush (creating a
 * terrain layer if needed); double-click renames; the trash icon deletes.
 */
export function TerrainList({ tileset }: { tileset: Tileset }) {
  const terrains = tileset.terrains ?? [];
  const activeId = useActiveTerrainId();
  const [editingId, setEditingId] = useState<number | null>(null);
  if (terrains.length === 0) return null;

  return (
    <div className="flex shrink-0 flex-col border-t border-line-subtle">
      <div className="flex h-7 items-center px-3 text-2xs font-semibold tracking-wide text-faint">
        {t("terrain.list")}
        <span className="ml-1.5 font-mono font-normal tabular">{terrains.length}</span>
      </div>
      <ul role="listbox" aria-label={t("terrain.list")} className="flex max-h-[136px] flex-col overflow-y-auto px-1.5 pb-1.5">
        {terrains.map((terrain) => {
          const info = terrainTemplateInfo(terrain.template);
          const active = terrain.id === activeId;
          return (
            <li
              key={terrain.id}
              role="option"
              aria-selected={active}
              data-terrain-id={terrain.id}
              title={t("terrain.renameHint")}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("button, input")) return;
                activateTerrain(terrain.id);
              }}
              onDoubleClick={(e) => {
                if (!(e.target as HTMLElement).closest("button")) setEditingId(terrain.id);
              }}
              className={`group relative flex h-8 shrink-0 cursor-default items-center gap-2 rounded-md pr-1 pl-2 text-md ${
                active ? "bg-active text-text" : "text-muted hover:bg-hover hover:text-text"
              }`}
            >
              {active && <span aria-hidden className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-terrain-tint" />}
              <TileSwatch tileset={tileset} tileId={terrainSwatchTile(tileset, terrain)} size={20} className="rounded-xs" />
              {editingId === terrain.id ? (
                <RenameInput
                  initial={terrain.name}
                  label={t("terrain.rename")}
                  onDone={(name) => {
                    setEditingId(null);
                    if (name !== null) renameTerrain(terrain.id, name);
                  }}
                />
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate">{terrain.name}</span>
                  <span className="shrink-0 truncate text-2xs text-faint">
                    {templateShortName(info).replace(/^Blob 47 · |^Corner 16 · /, "")}
                  </span>
                </>
              )}
              <button
                type="button"
                aria-label={t("terrain.remove")}
                title={t("terrain.remove")}
                onClick={() => deleteTerrain(terrain.id)}
                className="grid size-6 shrink-0 place-items-center rounded-sm text-faint opacity-0 transition-opacity duration-100 group-hover:opacity-100 hover:bg-hover hover:text-danger focus-visible:opacity-100"
              >
                <Icon name="trash" size={13} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
