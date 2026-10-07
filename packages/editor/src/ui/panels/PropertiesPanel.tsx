import { Switch } from "@base-ui/react/switch";
import {
  COLLISION_PASSABLE,
  COLLISION_SOLID,
  isGridLayer,
  isTileSolid,
  tilePosition,
  type GridLayer,
  type MapDocument,
  type Tileset,
} from "@smap/core";
import type { ReactNode } from "react";

import { runCommand } from "../../commands/registry";
import { activateTerrain, allTerrains, setTilesSolid } from "../../commands/terrainActions";
import { t, type MessageKey } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { useStructureVersion } from "../hooks";
import { Button } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { TileSwatch } from "../primitives/TileSwatch";
import { terrainSwatchTile } from "../terrain/TerrainList";
import { PanelSection } from "./PanelSection";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-faint">{label}</dt>
      <dd className="min-w-0 truncate text-text">{children}</dd>
    </>
  );
}

/**
 * Brush options of the active grid layer (terrain / collision), info about
 * the selected tile (with its "katı" switch), and the map when nothing is
 * selected.
 */
export function PropertiesPanel() {
  const store = useEditorStore((s) => s.project?.store);
  const selection = useEditorStore((s) => s.selection);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  useStructureVersion(store);
  const tileset = selection ? store?.document.getTileset(selection.tilesetId) : undefined;
  const map = store?.document.map;
  const activeLayer = activeLayerId ? store?.document.getLayer(activeLayerId) : undefined;
  const grid = isGridLayer(activeLayer) ? activeLayer : null;

  return (
    <PanelSection title={t("panels.properties")} className="shrink-0">
      {grid && store && <GridBrush doc={store.document} layer={grid} />}
      <div className="px-3 pb-3">
        {selection && tileset ? (
          <div className="flex gap-3">
            <TileSwatch tileset={tileset} tileId={selection.tileId} size={56} className="rounded-md border border-line" />
            <dl className="grid min-w-0 flex-1 grid-cols-[auto_1fr] content-start items-center gap-x-3 gap-y-1 text-sm">
              <Row label={t("properties.tileset")}>{tileset.name}</Row>
              <Row label={t("properties.tileId")}>
                <span className="font-mono tabular">{selection.tileId}</span>
                <span className="ml-2 font-mono text-faint tabular">
                  ({tilePosition(tileset, selection.tileId).col}, {tilePosition(tileset, selection.tileId).row})
                </span>
              </Row>
              <Row label={t("properties.size")}>
                <span className="font-mono tabular">
                  {tileset.tileWidth} × {tileset.tileHeight}
                </span>
              </Row>
              <SolidRow tileset={tileset} tileId={selection.tileId} />
            </dl>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col">
              <span className="text-sm text-muted">{t("properties.noSelection")}</span>
              <span className="text-xs text-faint">{t("properties.noSelectionHint")}</span>
            </div>
            {map && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <Row label={t("properties.mapSize")}>
                  <span className="font-mono tabular">{t("common.cells", { width: map.width, height: map.height })}</span>
                </Row>
                <Row label={t("properties.tileSize")}>
                  <span className="font-mono tabular">{t("common.px", { value: map.tileWidth })}</span>
                </Row>
              </dl>
            )}
            {map && (
              <Button className="h-7 self-start px-2.5 text-sm" onClick={() => runCommand("map.resize")}>
                <Icon name="resize" size={14} />
                {t("properties.resizeMap")}
              </Button>
            )}
          </div>
        )}
      </div>
    </PanelSection>
  );
}

/** "Katı: evet / hayır" for the selected tile (undoable). */
function SolidRow({ tileset, tileId }: { tileset: Tileset; tileId: number }) {
  const solid = isTileSolid(tileset, tileId);
  return (
    <>
      <dt className="text-faint">{t("properties.solid")}</dt>
      <dd className="flex items-center gap-2">
        <Switch.Root
          checked={solid}
          onCheckedChange={(checked) => setTilesSolid(tileset.id, [tileId], checked)}
          aria-label={t("properties.solid")}
          className="relative flex h-4 w-7 shrink-0 items-center rounded-full bg-line-strong p-0.5 transition-colors duration-100 data-checked:bg-collision-solid"
        >
          <Switch.Thumb className="size-3 rounded-full bg-text shadow-popup transition-transform duration-100 data-checked:translate-x-3" />
        </Switch.Root>
        <span className={solid ? "text-text" : "text-muted"}>{solid ? t("properties.yes") : t("properties.no")}</span>
      </dd>
    </>
  );
}

/** Brush value of the active grid layer: a terrain, or a collision exception kind. */
function GridBrush({ doc, layer }: { doc: MapDocument; layer: GridLayer }) {
  return (
    <div className="mx-3 mb-3 flex flex-col gap-2 border-b border-line-subtle pb-3">
      <span className="text-xs text-faint">{t(layer.role === "terrain" ? "terrain.brush" : "collision.brush")}</span>
      {layer.role === "terrain" ? <TerrainChoices doc={doc} /> : <CollisionChoices />}
    </div>
  );
}

function TerrainChoices({ doc }: { doc: MapDocument }) {
  const value = useEditorStore((s) => s.gridValue);
  const terrains = allTerrains(doc);
  if (terrains.length === 0) {
    return (
      <div className="flex flex-col">
        <span className="text-sm text-muted">{t("terrain.none")}</span>
        <span className="text-xs text-faint">{t("terrain.noneHint")}</span>
      </div>
    );
  }
  return (
    <div role="radiogroup" aria-label={t("terrain.brush")} className="flex flex-wrap gap-1.5">
      {terrains.map((terrain) => {
        const tileset = doc.getTileset(terrain.tilesetId);
        const on = terrain.id === value;
        return (
          <button
            key={terrain.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => activateTerrain(terrain.id)}
            className={`flex h-7 max-w-full items-center gap-1.5 rounded-md border pr-2 pl-1 text-sm transition-colors ${
              on ? "border-terrain-tint bg-terrain-tint/12 text-text" : "border-line text-muted hover:border-line-strong hover:text-text"
            }`}
          >
            {tileset && <TileSwatch tileset={tileset} tileId={terrainSwatchTile(tileset, terrain)} size={18} className="rounded-xs" />}
            <span className="truncate">{terrain.name}</span>
          </button>
        );
      })}
    </div>
  );
}

const COLLISION_CHOICES: { value: number; label: MessageKey; hint: MessageKey; swatch: string }[] = [
  { value: COLLISION_SOLID, label: "collision.forceSolid", hint: "collision.forceSolidHint", swatch: "bg-collision-solid" },
  { value: COLLISION_PASSABLE, label: "collision.forcePass", hint: "collision.forcePassHint", swatch: "bg-collision-pass" },
];

function CollisionChoices() {
  const value = useEditorStore((s) => s.gridValue);
  const tool = useEditorStore((s) => s.tool);
  const setValue = useEditorStore((s) => s.setGridValue);
  const setTool = useEditorStore((s) => s.setTool);
  const current = COLLISION_CHOICES.find((c) => c.value === value);
  return (
    <>
      <div role="radiogroup" aria-label={t("collision.brush")} className="grid grid-cols-2 gap-1.5">
        {COLLISION_CHOICES.map((choice) => {
          const on = choice.value === value && tool !== "eraser";
          return (
            <button
              key={choice.value}
              type="button"
              role="radio"
              aria-checked={on}
              title={t(choice.hint)}
              onClick={() => {
                setValue(choice.value);
                if (tool === "eraser" || tool === "select" || tool === "eyedropper") setTool("brush");
              }}
              className={`flex h-7 min-w-0 items-center gap-2 rounded-md border px-2 text-sm transition-colors ${
                on ? "border-accent bg-accent-soft text-text" : "border-line text-muted hover:border-line-strong hover:text-text"
              }`}
            >
              <span aria-hidden className={`size-2.5 shrink-0 rounded-xs ${choice.swatch}`} />
              <span className="truncate">{t(choice.label)}</span>
            </button>
          );
        })}
      </div>
      <span className="text-xs leading-4 text-faint">
        {tool === "eraser" ? t("collision.eraserHint") : current ? t(current.hint) : null}
      </span>
    </>
  );
}
