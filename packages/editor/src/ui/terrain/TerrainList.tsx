import type { TerrainSet, Tileset } from "@smap/core";
import { useState } from "react";

import { chooseTerrain, removeTerrain, renameTerrain } from "../../commands/terrainActions";
import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { useStructureVersion } from "../hooks";
import { IconButton } from "../primitives/Button";
import { SectionHeader } from "../primitives/SectionHeader";
import { Icon } from "../primitives/Icon";
import { RenameInput } from "../primitives/RenameInput";
import { TileSwatch } from "../primitives/TileSwatch";
import { Tooltip } from "../primitives/Tooltip";
import { useUiStore } from "../uiStore";
import { startDefine } from "./terrainDraft";
import { resolveTerrain, sameTerrain, terrainSetEntries, terrainSwatch, type TerrainRef } from "./terrainModel";

/** The terrain the brush paints right now (terrain brush on and the terrain exists), or null. */
export function useActiveTerrain(): TerrainRef | null {
  const terrain = useEditorStore((s) => (s.terrainActive ? s.terrain : null));
  const doc = useEditorStore((s) => s.project?.store.document);
  return resolveTerrain(doc, terrain) ? terrain : null;
}

/** A small round colour dot of a terrain. */
export function TerrainDot({ color, size = 6, className = "" }: { color: string; size?: number; className?: string }) {
  return <span aria-hidden className={`inline-block shrink-0 rounded-full ${className}`} style={{ width: size, height: size, background: color }} />;
}

/** The terrain's representative tile, or its colour when it has no tile. */
export function TerrainSwatch({ tileset, set, terrainId, size }: { tileset: Tileset; set: TerrainSet; terrainId: number; size: number }) {
  const tile = terrainSwatch(set, terrainId);
  const color = set.terrains.find((x) => x.id === terrainId)?.color ?? "var(--color-muted)";
  if (tile === null) return <span aria-hidden className="shrink-0 rounded-xs" style={{ width: size, height: size, background: color }} />;
  return <TileSwatch tileset={tileset} tileId={tile} size={size} className="rounded-xs" />;
}

/**
 * "Araziler" — every terrain set of the project (all tilesets) with its
 * terrains (colour dot + tile swatch). Click a terrain: the terrain brush
 * paints it on the active tile layer; double-click: rename; trash: delete
 * (undoable); "+": ⚙ Düzenle → Arazi in the tileset, ready for a rough
 * rectangle over a block (concept "Terrain sets").
 */
export function TerrainSets({ separated = false }: { separated?: boolean }) {
  const store = useEditorStore((s) => s.project?.store);
  useStructureVersion(store);
  const active = useActiveTerrain();
  const activeTilesetId = useUiStore((s) => s.activeTilesetId);
  const [editing, setEditing] = useState<string | null>(null);
  const doc = store?.document;
  if (!doc || doc.tilesets.length === 0) return null;
  const entries = terrainSetEntries(doc);
  const terrainCount = entries.reduce((n, e) => n + e.set.terrains.length, 0);
  const several = new Set(entries.map((e) => e.tileset.id)).size > 1;
  const keyOf = (r: TerrainRef) => `${r.tilesetId}/${r.setId}/${r.terrainId}`;

  return (
    <section
      aria-label={t("terrain.list")}
      data-terrain-sets=""
      data-empty={terrainCount === 0 || undefined}
      className={`flex shrink-0 flex-col ${separated ? "border-t border-line-subtle" : ""}`}
    >
      <SectionHeader padding={12} title={<>{t("terrain.list")} <span className="ml-1 font-mono text-faint">{terrainCount}</span></>} actions={
        <Tooltip label={t("terrain.defineNew")}>
          <IconButton size="sm" aria-label={t("terrain.defineNew")} data-terrain-add onClick={() => startDefine(activeTilesetId ?? undefined)}><Icon name="plus" /></IconButton>
        </Tooltip>
      } />
      {terrainCount === 0 ? <p className="px-3 py-1 text-sm text-muted">{t("terrain.none")}</p> : (
        <ul role="listbox" aria-label={t("terrain.list")} className="flex max-h-56 flex-col overflow-y-auto px-2 pb-1">
          {entries.map(({ tileset, set }) => (
            <li key={`${tileset.id}/${set.id}`} role="presentation" data-terrain-set={set.id} className="flex flex-col">
              {entries.length > 1 && <div data-terrain-set-heading className="flex h-6 items-center gap-1.5 px-2 text-xs text-faint">
                <span className="min-w-0 truncate font-medium text-muted">{set.name}</span>
                <span className="shrink-0">· {t(set.kind === "corner" ? "terrain.kindCorner" : "terrain.kindBlob")}</span>
                {several && <span className="ml-auto min-w-0 truncate">{tileset.name}</span>}
              </div>}
              <ul role="group" aria-label={set.name} className="flex flex-col">
                {set.terrains.map((terrain) => {
                  const ref: TerrainRef = { tilesetId: tileset.id, setId: set.id, terrainId: terrain.id };
                  const on = sameTerrain(ref, active);
                  return (
                    <li
                      key={terrain.id}
                      role="option"
                      aria-selected={on}
                      data-terrain-id={terrain.id}
                      data-terrain-name={terrain.name}
                      title={t("terrain.renameHint")}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("button, input")) return;
                        chooseTerrain(ref);
                      }}
                      onDoubleClick={(e) => {
                        if (!(e.target as HTMLElement).closest("button")) setEditing(keyOf(ref));
                      }}
                      className={`group relative flex h-row shrink-0 cursor-default items-center gap-2 rounded-sm pr-0 pl-2 text-sm ${
                        on ? "bg-accent-soft text-text" : "text-muted hover:bg-hover hover:text-text"
                      }`}
                    >
                      <TerrainSwatch tileset={tileset} set={set} terrainId={terrain.id} size={16} />
                      {editing === keyOf(ref) ? (
                        <RenameInput
                          initial={terrain.name}
                          label={t("terrain.rename")}
                          onDone={(name) => {
                            setEditing(null);
                            if (name !== null) renameTerrain(ref, name);
                          }}
                        />
                      ) : (
                        <span className="min-w-0 flex-1 truncate">{terrain.name}</span>
                      )}
                      <TerrainDot color={terrain.color} className="group-hover:hidden" />
                      <IconButton size="sm"
                        aria-label={t("terrain.remove")}
                        title={t("terrain.remove")}
                        onClick={() => removeTerrain(ref)}
                        className="invisible text-faint group-hover:visible hover:text-danger focus-visible:visible"
                      >
                        <Icon name="trash" size={16} />
                      </IconButton>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
