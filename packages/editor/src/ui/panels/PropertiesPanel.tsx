import { Switch } from "@base-ui/react/switch";
import {
  COLLISION_PASSABLE,
  COLLISION_SOLID,
  isEntityLayer,
  isGridLayer,
  SPAWN_TYPE_ID,
  isTileSolid,
  terrainTemplateInfo,
  tilePosition,
  type GridLayer,
  type MapDocument,
  type TileClip,
  type Tileset,
} from "@smap/core";
import { useSyncExternalStore, type ReactNode } from "react";

import { runCommand } from "../../commands/registry";
import { activeStampId } from "../../commands/stampActions";
import { setTilesSolid } from "../../commands/terrainActions";
import { t, type MessageKey } from "../../i18n";
import { useProjectLibrary } from "../../io/projectLibrary";
import { useEditorStore } from "../../state/editorStore";
import { useStructureVersion } from "../hooks";
import { BrushPreview } from "../layout/inspector/BrushPreview";
import {
  inspectorSectionsFor,
  inspectorVersion,
  registerInspectorSection,
  subscribeInspector,
  type InspectorContext,
} from "../layout/inspector/registry";
import { Button } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { Kbd } from "../primitives/Kbd";
import { TileSwatch } from "../primitives/TileSwatch";
import { templateShortName } from "../terrain/TemplatePicker";
import { terrainSwatchTile } from "../terrain/TerrainList";
import { chooseEntityType } from "../../commands/entityActions";
import { EntityProperties } from "../entities/EntityProperties";
import type { SectionPanelProps } from "../layout/RightColumn";
import { PanelSection } from "./PanelSection";
import { RandomBrushChip } from "./RandomBrushChip";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-faint">{label}</dt>
      <dd className="min-w-0 truncate text-text">{children}</dd>
    </>
  );
}

/** A sub-heading inside the inspector ("FIRÇA", "HARİTA"). */
function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="px-3 pt-3 pb-1.5 text-2xs font-semibold tracking-wider text-faint uppercase">{children}</h3>;
}

/**
 * Inspector (right column): what is selected or on the brush (entity,
 * stamp, random brush, tile, terrain / collision kind) and the map. Built
 * from inspector sections (`layout/inspector/registry.ts`); later features
 * add theirs with `registerInspectorSection`.
 */
export function PropertiesPanel({ collapsed = false, onToggleCollapsed, extra }: Partial<SectionPanelProps> = {}) {
  const store = useEditorStore((s) => s.project?.store);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const selectedEntityId = useEditorStore((s) => s.selectedEntityId);
  useStructureVersion(store);
  useSyncExternalStore(subscribeInspector, inspectorVersion);
  const doc = store?.document;
  if (!doc) return null;
  const found = selectedEntityId ? doc.findEntity(selectedEntityId) : undefined;
  const ctx: InspectorContext = {
    doc,
    layer: activeLayerId ? doc.getLayer(activeLayerId) : undefined,
    entity: found ? { entity: found.entity, layer: found.layer } : undefined,
  };
  const sections = inspectorSectionsFor(ctx);
  return (
    <PanelSection
      title={t("panels.properties")}
      className="min-h-0 flex-auto"
      collapsed={collapsed}
      extra={extra}
      {...(onToggleCollapsed ? { onToggleCollapsed } : {})}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-2" data-inspector>
        {sections.map(({ id, Component }) => (
          <div key={id} data-inspector-section={id} className="first:[&>h3]:pt-0.5">
            <Component ctx={ctx} />
          </div>
        ))}
      </div>
    </PanelSection>
  );
}

// ---- Built-in sections

function EntitySection({ ctx }: { ctx: InspectorContext }) {
  if (!ctx.entity) {
    return (
      <div className="flex flex-col px-3 pt-1 pb-2">
        <span className="text-sm text-muted">{t("properties.noEntity")}</span>
        <span className="text-xs text-faint">{t("properties.noEntityHint")}</span>
      </div>
    );
  }
  return <EntityProperties doc={ctx.doc} entity={ctx.entity.entity} />;
}

/** What the brush paints: a stamp / clip, the random set, or one tile. */
function BrushSection({ ctx }: { ctx: InspectorContext }) {
  const stamp = useEditorStore((s) => s.stamp);
  const selection = useEditorStore((s) => s.selection);
  const randomCount = useEditorStore((s) => s.randomSet.length);
  const doc = ctx.doc;
  let body: ReactNode;
  if (stamp) body = <ClipCard clip={stamp} doc={doc} />;
  else if (randomCount >= 2) body = <RandomBrushChip doc={doc} />;
  else if (selection && doc.getTileset(selection.tilesetId)) {
    body = <TileCard tileset={doc.getTileset(selection.tilesetId)!} tileId={selection.tileId} />;
  } else {
    body = (
      <div className="flex flex-col px-3">
        <span className="text-sm text-muted">{t("properties.noSelection")}</span>
        <span className="text-xs text-faint">{t("properties.noSelectionHint")}</span>
      </div>
    );
  }
  return (
    <>
      <SubHeading>{t("inspector.brush")}</SubHeading>
      {body}
    </>
  );
}

/** A clip on the brush: preview + "3 × 2 tile · 2 katman", with the stamp's name when it is a saved one. */
function ClipCard({ clip, doc }: { clip: TileClip; doc: MapDocument }) {
  const stampId = activeStampId(clip);
  const saved = useProjectLibrary((s) => (stampId ? s.stamps.find((st) => st.id === stampId) : undefined));
  const tileLayers = clip.layers.filter((l) => !l.grid).length;
  const gridLayers = clip.layers.length - tileLayers;
  return (
    <div className="flex gap-3 px-3" data-brush-clip>
      <BrushPreview clip={clip} doc={doc} width={72} height={72} />
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <span className="truncate text-md font-medium text-text">{saved?.name ?? t("inspector.clip")}</span>
        <span className="font-mono text-sm text-muted tabular">{t("inspector.clipSize", { width: clip.width, height: clip.height })}</span>
        <span className="text-xs text-faint">
          {t("stamps.layers", { count: clip.layers.length })}
          {gridLayers > 0 && <Icon name="shield" size={11} className="ml-1 inline text-collision-solid/80" />}
        </span>
        <span className="mt-1 flex items-center gap-1 text-2xs text-faint">
          <Kbd keys="Escape" />
          {t("inspector.dropClip")}
        </span>
      </div>
    </div>
  );
}

function TileCard({ tileset, tileId }: { tileset: Tileset; tileId: number }) {
  const pos = tilePosition(tileset, tileId);
  return (
    <div className="flex gap-3 px-3">
      <TileSwatch tileset={tileset} tileId={tileId} size={56} className="rounded-md border border-line" />
      <dl className="grid min-w-0 flex-1 grid-cols-[auto_1fr] content-start items-center gap-x-3 gap-y-1 text-sm">
        <Row label={t("properties.tileset")}>{tileset.name}</Row>
        <Row label={t("properties.tileId")}>
          <span className="font-mono tabular">{tileId}</span>
          <span className="ml-2 font-mono text-faint tabular">
            ({pos.col}, {pos.row})
          </span>
        </Row>
        <Row label={t("properties.size")}>
          <span className="font-mono tabular">
            {tileset.tileWidth} × {tileset.tileHeight}
          </span>
        </Row>
        <SolidRow tileset={tileset} tileId={tileId} />
      </dl>
    </div>
  );
}

/** Terrain layer: the terrain being painted. Collision layer: the exception kind. (Picked in the tool options bar.) */
function GridLayerSection({ ctx }: { ctx: InspectorContext }) {
  const layer = ctx.layer as GridLayer;
  return (
    <>
      <SubHeading>{t(layer.role === "terrain" ? "terrain.brush" : "collision.brush")}</SubHeading>
      {layer.role === "terrain" ? <TerrainCard doc={ctx.doc} /> : <CollisionCard />}
    </>
  );
}

function TerrainCard({ doc }: { doc: MapDocument }) {
  const value = useEditorStore((s) => s.gridValue);
  const terrain = doc.getTerrain(value);
  const tileset = terrain ? doc.getTileset(terrain.tilesetId) : undefined;
  if (!terrain || !tileset) {
    return (
      <div className="flex flex-col px-3">
        <span className="text-sm text-muted">{t("terrain.none")}</span>
        <span className="text-xs text-faint">{t("terrain.noneHint")}</span>
      </div>
    );
  }
  return (
    <div className="flex gap-3 px-3" data-inspector-terrain={terrain.id}>
      <TileSwatch tileset={tileset} tileId={terrainSwatchTile(tileset, terrain)} size={56} className="rounded-md border border-terrain-tint/60" />
      <dl className="grid min-w-0 flex-1 grid-cols-[auto_1fr] content-start items-center gap-x-3 gap-y-1 text-sm">
        <Row label={t("terrain.name")}>{terrain.name}</Row>
        <Row label={t("properties.tileset")}>{tileset.name}</Row>
        <Row label={t("terrain.template")}>{templateShortName(terrainTemplateInfo(terrain.template))}</Row>
      </dl>
    </div>
  );
}

const COLLISION_KINDS: { value: number; label: MessageKey; hint: MessageKey; swatch: string }[] = [
  { value: COLLISION_SOLID, label: "collision.forceSolid", hint: "collision.forceSolidHint", swatch: "bg-collision-solid" },
  { value: COLLISION_PASSABLE, label: "collision.forcePass", hint: "collision.forcePassHint", swatch: "bg-collision-pass" },
];

function CollisionCard() {
  const value = useEditorStore((s) => s.gridValue);
  const tool = useEditorStore((s) => s.tool);
  const kind = COLLISION_KINDS.find((c) => c.value === value);
  return (
    <div className="flex flex-col gap-1 px-3">
      {kind && tool !== "eraser" && (
        <span className="flex items-center gap-2 text-sm text-text">
          <span aria-hidden className={`size-2.5 rounded-xs ${kind.swatch}`} />
          {t(kind.label)}
        </span>
      )}
      <span className="text-xs leading-4 text-faint">{tool === "eraser" ? t("collision.eraserHint") : kind ? t(kind.hint) : null}</span>
    </div>
  );
}

function MapSection({ ctx }: { ctx: InspectorContext }) {
  const map = ctx.doc.map;
  return (
    <>
      <SubHeading>{t("properties.map")}</SubHeading>
      <div className="flex flex-col gap-2.5 px-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <Row label={t("properties.mapSize")}>
            <span className="font-mono tabular">{t("common.cells", { width: map.width, height: map.height })}</span>
          </Row>
          <Row label={t("properties.tileSize")}>
            <span className="font-mono tabular">{t("common.px", { value: map.tileWidth })}</span>
          </Row>
        </dl>
        <Button className="h-7 self-start px-2.5 text-sm" onClick={() => runCommand("map.resize")}>
          <Icon name="resize" size={14} />
          {t("properties.resizeMap")}
        </Button>
        {!ctx.doc.spawn() && <SpawnHint />}
      </div>
    </>
  );
}

/** "Başlangıç noktası yok" with a shortcut to place one (spawn type + entity tool). */
function SpawnHint() {
  return (
    <div className="flex items-center gap-2 rounded-md border border-line bg-raised py-1.5 pr-1.5 pl-2.5" data-spawn-hint>
      <Icon name="flag" size={14} className="shrink-0 text-warning" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-text">{t("properties.noSpawn")}</span>
        <span className="text-2xs leading-[14px] text-faint">{t("properties.noSpawnHint")}</span>
      </div>
      <Button className="h-6 shrink-0 px-2 text-sm" onClick={() => chooseEntityType(SPAWN_TYPE_ID)}>
        {t("properties.addSpawn")}
      </Button>
    </div>
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

const onEntityLayer = (c: InspectorContext) => c.entity !== undefined || isEntityLayer(c.layer);

registerInspectorSection({ id: "builtin.entity", order: 10, when: onEntityLayer, Component: EntitySection });
registerInspectorSection({
  id: "builtin.brush",
  order: 20,
  when: (c) => !onEntityLayer(c) && !isGridLayer(c.layer),
  Component: BrushSection,
});
registerInspectorSection({ id: "builtin.gridLayer", order: 30, when: (c) => !onEntityLayer(c) && isGridLayer(c.layer), Component: GridLayerSection });
registerInspectorSection({ id: "builtin.map", order: 90, when: (c) => c.entity === undefined, Component: MapSection });
