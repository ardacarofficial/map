import { isGridLayer, terrainSlotTileId, terrainTemplateInfo, type Terrain, type Tileset } from "@smap/core";
import { useState } from "react";

import { activateTerrain, allTerrains, deleteTerrain, renameTerrain } from "../../commands/terrainActions";
import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { useStructureVersion } from "../hooks";
import { Icon } from "../primitives/Icon";
import { RenameInput } from "../primitives/RenameInput";
import { TileSwatch } from "../primitives/TileSwatch";
import { Tooltip } from "../primitives/Tooltip";
import { useUiStore } from "../uiStore";
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

/** "Blob 47 · Godot 3×3 minimal" → "Godot 3×3 minimal" (the family is implied in a terrain row). */
function templateLabel(terrain: Terrain): string {
  return templateShortName(terrainTemplateInfo(terrain.template)).replace(/^Blob 47 · |^Corner 16 · /, "");
}

/**
 * "Araziler" — every terrain of the project (all tilesets), each with its
 * centre tile as swatch. Click: paint it (the terrain layer is found or
 * created, see `activateTerrain`); double-click: rename; trash: delete; "+"
 * starts "Arazi tanımla" in the tileset view. Meant to sit under the
 * tileset in the library (concept 5 "Terrain sets").
 */
export function TerrainSets() {
  const store = useEditorStore((s) => s.project?.store);
  useStructureVersion(store);
  const activeId = useActiveTerrainId();
  const defining = useUiStore((s) => s.tilesetMode === "terrain");
  const [editingId, setEditingId] = useState<number | null>(null);
  const doc = store?.document;
  if (!doc || doc.tilesets.length === 0) return null;
  const terrains = allTerrains(doc);
  const several = new Set(terrains.map((x) => x.tilesetId)).size > 1;

  const startDefine = () => {
    const ui = useUiStore.getState();
    ui.setLibraryTab("tileset");
    ui.setTilesetMode("terrain");
  };

  return (
    <section aria-label={t("terrain.list")} data-terrain-sets="" className="flex shrink-0 flex-col border-t border-line-subtle">
      <div className="flex h-7 items-center pr-1.5 pl-3 text-2xs font-semibold tracking-wide text-faint">
        {t("terrain.list")}
        {terrains.length > 0 && <span className="ml-1.5 font-mono font-normal tabular">{terrains.length}</span>}
        <Tooltip label={t("terrain.defineNew")}>
          <button
            type="button"
            aria-label={t("terrain.defineNew")}
            aria-pressed={defining}
            onClick={startDefine}
            className={`ml-auto grid size-6 place-items-center rounded-sm hover:bg-hover hover:text-text ${defining ? "text-terrain-tint" : "text-faint"}`}
          >
            <Icon name="plus" size={13} />
          </button>
        </Tooltip>
      </div>
      {terrains.length === 0 ? (
        <button
          type="button"
          onClick={startDefine}
          className="mx-1.5 mb-1.5 flex items-center gap-2 rounded-md border border-dashed border-line px-2.5 py-2 text-left text-xs leading-4 text-muted hover:border-line-strong hover:bg-hover hover:text-text"
        >
          <Icon name="terrain" size={14} className="shrink-0 text-terrain-tint" />
          <span>{t("terrain.setsEmpty")}</span>
        </button>
      ) : (
        <ul role="listbox" aria-label={t("terrain.list")} className="flex max-h-[168px] flex-col overflow-y-auto px-1.5 pb-1.5">
          {terrains.map((terrain) => {
            const tileset = doc.getTileset(terrain.tilesetId);
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
                {tileset ? (
                  <TileSwatch tileset={tileset} tileId={terrainSwatchTile(tileset, terrain)} size={20} className="rounded-xs" />
                ) : (
                  <span className="size-5 rounded-xs bg-line" />
                )}
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
                    <span className="shrink-0 truncate text-2xs text-faint group-hover:hidden">
                      {several && tileset ? tileset.name : templateLabel(terrain)}
                    </span>
                  </>
                )}
                {active && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-terrain-tint group-hover:hidden" />}
                <button
                  type="button"
                  aria-label={t("terrain.remove")}
                  title={t("terrain.remove")}
                  onClick={() => deleteTerrain(terrain.id)}
                  className="hidden size-6 shrink-0 place-items-center rounded-sm text-faint group-hover:grid hover:bg-hover hover:text-danger focus-visible:grid"
                >
                  <Icon name="trash" size={13} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * @deprecated Mount {@link TerrainSets} instead. Kept so the tileset panel's
 * existing `<TerrainList tileset={...} />` shows the project-wide list.
 */
export function TerrainList(_props: { tileset?: Tileset }) {
  return <TerrainSets />;
}
