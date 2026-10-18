import type { Stamp } from "@smap/core";
import { SmartStampProperties } from "../stamps/SmartStampProperties";
/**
 * Built-in Denetçi cards, one per inspector mode (see `mode.ts`):
 * entity, marquee region, brush (FIRÇA), terrain brush (ARAZİ, from
 * `ui/terrain/TerrainCard`), collision kind and the map summary.
 */
import {
  COLLISION_PASSABLE,
  COLLISION_SOLID,
  entityCell,
  isEntityLayer,
  isTileSolid,
  SPAWN_TYPE_ID,
  tilePosition,
  type MapDocument,
  type TileClip,
  type Tileset,
} from "@smap/core";
import { useState, type FormEvent, type ReactNode } from "react";

import { openTilesetImport } from "../../commands/tilesetActions";
import { chooseEntityType } from "../../commands/entityActions";
import {
  clearRandomSet,
  MAX_WEIGHT,
  MIN_WEIGHT,
  removeRandomTile,
  setRandomWeight,
  useRandomBrush,
  useIsRandomBrush,
} from "../../commands/randomBrush";
import { getCommand, isEnabled, runCommand } from "../../commands/registry";
import { activeStampId, defaultStampName } from "../../commands/stampActions";
import { setTilesSolid } from "../../commands/terrainActions";
import { formatNumber, t, type MessageKey } from "../../i18n";
import { useProjectLibrary } from "../../io/projectLibrary";
import type { CommandId } from "../../shortcuts/shortcuts";
import { useEditorStore, type CellRegion } from "../../state/editorStore";
import { getCanvasHandle } from "../canvas/canvasHandle";
import { EntityProperties } from "../entities/EntityProperties";
import { openMapSettings } from "../mapSettings/mapSettingsStore";
import { Button, IconButton } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { PropRow as FieldRow, PropField } from "../primitives/PropRow";
import { TextField } from "../primitives/TextField";
import { Tooltip } from "../primitives/Tooltip";
import { TileSwatch } from "../primitives/TileSwatch";
import { Toggle } from "../primitives/Toggle";
import { useCanSaveSelectionStamp } from "../stamps/useCanSaveSelectionStamp";
import { useUiStore } from "../uiStore";
import { TerrainCard } from "../terrain/TerrainCard";
import { resolveTerrain } from "../terrain/terrainModel";
import { RandomSetControls, RandomSetPicker } from "../tileset/RandomSetControls";
import { saveClipAsStamp } from "../tileset/SelectionSection";
import { SelectionScopeSection } from "./SelectionScopeSection";
import { BrushPreview } from "./BrushPreview";
import { fillBlocker } from "./fillCheck";
import {
  ActionButton,
  CardTitle,
  CommandAction,
  IntField,
  PropGrid,
  PropRow,
  ReadField,
  SectionHeader,
  SquareAction,
} from "./parts";
import { registerInspectorSection, type InspectorContext } from "./registry";
import { selectAll } from "../primitives/selectAll";

const PREVIEW = 80;

// ------------------------------------------------------------------ entity

function EntitySection({ ctx }: { ctx: InspectorContext }) {
  if (!ctx.entity) return null;
  return <EntityProperties doc={ctx.doc} entity={ctx.entity.entity} />;
}

// ------------------------------------------------------------------ marquee region

/** The marquee region (select tool): its rectangle (editable) and what can be done with it. */
function RegionCommand({ command, icon, label }: { command: CommandId; icon: "copy" | "scissors" | "trash-2"; label: string }) {
  const cmd = getCommand(command);
  return <SquareAction command={command} label={label} disabled={!cmd || !isEnabled(cmd)} onClick={() => runCommand(command)}><Icon name={icon} size={16} /></SquareAction>;
}

function RegionSection({ ctx }: { ctx: InspectorContext }) {
  useEditorStore(s => s.selectionScope);
  useCanSaveSelectionStamp();
  const region = ctx.region!;
  const setRegion = useEditorStore((s) => s.setRegion);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const gridValue = useEditorStore((s) => s.gridValue);
  const stamp = useEditorStore((s) => s.stamp);
  const selection = useEditorStore((s) => s.selection);
  const randomSet = useEditorStore((s) => s.randomSet);
  const random = useIsRandomBrush();
  const terrain = useEditorStore((s) => s.terrainActive && resolveTerrain(ctx.doc, s.terrain) !== null);
  const blocker = fillBlocker(ctx.doc, { activeLayerId, gridValue, stamp, selection, randomSet, random, terrain });
  const map = ctx.doc.map;
  const move = (next: Partial<CellRegion>) => setRegion(clampRegionTo({ ...region, ...next }, map.width, map.height));
  return (
    <div data-inspector-region>
      <CardTitle
        leading={<Icon name="square-dashed" size={16} />}
        title={t("inspector.region")}
        subtitle={ctx.layer?.name}
      />
      <SelectionScopeSection />
      <SectionHeader>{t("inspector.transform")}</SectionHeader>
      <PropGrid>
        <PropRow label={t("properties.position")}>
          <IntField label={t("inspector.x")} prefix="X" value={region.x} min={0} max={map.width - 1} onPreview={(x) => move({ x })} onCommit={(x) => move({ x })} />
          <IntField label={t("inspector.y")} prefix="Y" value={region.y} min={0} max={map.height - 1} onPreview={(y) => move({ y })} onCommit={(y) => move({ y })} />
        </PropRow>
        <PropRow label={t("inspector.size")}>
          <IntField label={t("inspector.width")} prefix={<Icon name="move-horizontal" size={12} />} value={region.width} min={1} max={map.width - region.x} onPreview={(width) => move({ width })} onCommit={(width) => move({ width })} />
          <IntField label={t("inspector.height")} prefix={<Icon name="move-vertical" size={12} />} value={region.height} min={1} max={map.height - region.y} onPreview={(height) => move({ height })} onCommit={(height) => move({ height })} />
        </PropRow>
      </PropGrid>
      <div className="flex flex-wrap items-center gap-1 px-3 py-2" onPointerDown={(e) => e.preventDefault()}>
        <RegionCommand command="edit.copy" icon="copy" label={t("selectionBar.copy")} />
        <RegionCommand command="edit.cut" icon="scissors" label={t("selectionBar.cut")} />
        <Tooltip label={blocker ? t(blocker) : t("selectionBar.fill")}>
          <IconButton size="sm" aria-label={t("selectionBar.fill")} data-action="fill" aria-disabled={!!blocker || undefined} className={blocker ? "opacity-40" : ""} onClick={() => { if (!blocker) getCanvasHandle()?.fillRegion(region); }}><Icon name="paint-bucket" size={16} /></IconButton>
        </Tooltip>
        <RegionCommand command="edit.delete" icon="trash-2" label={t("selectionBar.erase")} />
        <CommandAction command="stamp.saveSelection" icon="stamp" label={t("selectionBar.saveStamp")} disabledReason={t("toast.emptySelection")} />
      </div>
    </div>
  );
}

/** `r` clipped to the map (x / y first, then width / height to what is left). */
export function clampRegionTo(r: CellRegion, width: number, height: number): CellRegion {
  const x = Math.min(width - 1, Math.max(0, Math.round(r.x)));
  const y = Math.min(height - 1, Math.max(0, Math.round(r.y)));
  return {
    x,
    y,
    width: Math.min(width - x, Math.max(1, Math.round(r.width))),
    height: Math.min(height - y, Math.max(1, Math.round(r.height))),
  };
}

// ------------------------------------------------------------------ brush

/** FIRÇA: what the brush paints and how (concept 11). */
function BrushSection({ ctx }: { ctx: InspectorContext }) {
  const tool = useEditorStore((s) => s.tool);
  const stamp = useEditorStore((s) => s.stamp);
  const selection = useEditorStore((s) => s.selection);
  const randomSet = useEditorStore((s) => s.randomSet);
  const randomStamps = useRandomBrush((s) => s.stamps);
  const randomActive = useIsRandomBrush();
  const doc = ctx.doc;
  const tileset = selection ? doc.getTileset(selection.tilesetId) : undefined;
  // Same rule as the canvas (`currentRandomSet`): 2+ candidates, or one with scatter.
  const random = randomActive && !stamp;
  const eraser = tool === "eraser";
  if (!eraser && !stamp && !random && !(selection && tileset)) {
    return (
      <div data-inspector-brush>
        <SectionHeader>{t("inspector.brushContent")}</SectionHeader>
        <p className="px-3 text-sm text-muted" data-inspector-title>{t(doc.tilesets.length === 0 ? "tilesetDock.empty" : "inspector.noBrush")}</p>
        {doc.tilesets.length === 0 && <div className="px-3 pt-2"><Button size="sm" onClick={() => void openTilesetImport()}><Icon name="image-up" />{t("tilesetPanel.add")}</Button></div>}
        {doc.randomSets.length > 0 && <PropGrid><PropRow label={t("inspector.random")}><RandomSetPicker /></PropRow></PropGrid>}
      </div>
    );
  }

  if (eraser) return <MapSection ctx={ctx} />;

  let preview: ReactNode;
  let title: ReactNode;
  let subtitle: ReactNode;
  if (stamp) {
    preview = <BrushPreview clip={stamp} doc={doc} width={PREVIEW} height={PREVIEW} />;
    title = <ClipName clip={stamp} />;
    subtitle = null;
  } else if (random) {
    preview = <RandomPreview doc={doc} />;
    title = t("inspector.random");
    subtitle = t("inspector.randomCount", { count: randomSet.length + randomStamps.length });
  } else if (selection && tileset) {
    preview = <TileSwatch tileset={tileset} tileId={selection.tileId} size={PREVIEW} className="checker rounded-sm border border-line" />;
    title = `${t("inspector.tile")} #${selection.tileId}`;
    subtitle = null;
  } else {
    preview = <PreviewBox><Icon name="pencil" size={16} className="text-faint" /></PreviewBox>;
    title = t("inspector.noBrush");
    subtitle = null;
  }

  return (
    <div data-inspector-brush>
      <SectionHeader>{t("inspector.brushContent")}</SectionHeader>
      <div className="flex items-center gap-3 px-3 py-1.5">
        {preview}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-md font-semibold text-title" data-inspector-title>
            {title}
          </span>
          {subtitle && <span className="truncate text-sm text-faint">{subtitle}</span>}
        </div>
      </div>
      {stamp && <StampDetails clip={stamp} doc={doc} />}
      {stamp && activeStampId(stamp) && <PropGrid><SmartStampProperties stamp={stamp as Stamp} /></PropGrid>}
      {!stamp && random && <RandomDetails doc={doc} />}
      {!stamp && !random && selection && tileset && <TileDetails tileset={tileset} tileId={selection.tileId} />}
      {!stamp && !random && doc.randomSets.length > 0 && (
        <PropGrid>
          <PropRow label={t("inspector.random")}>
            <RandomSetPicker />
          </PropRow>
        </PropGrid>
      )}
    </div>
  );
}

function PreviewBox({ children }: { children: ReactNode }) {
  return (
    <span style={{ width: PREVIEW, height: PREVIEW }} className="grid shrink-0 place-items-center rounded-sm border border-line checker">
      {children}
    </span>
  );
}

function ClipName({ clip }: { clip: TileClip }) {
  const stampId = activeStampId(clip);
  const saved = useProjectLibrary((s) => (stampId ? s.stamps.find((st) => st.id === stampId) : undefined));
  return <>{saved?.name ?? t("inspector.clip")}</>;
}

/** Up to 4 candidates of the random brush (tiles, then stamps) in a 2 × 2 grid. */
function RandomPreview({ doc }: { doc: MapDocument }) {
  const set = useEditorStore((s) => s.randomSet);
  const stamps = useRandomBrush((s) => s.stamps);
  const library = useProjectLibrary((s) => s.stamps);
  const cell = PREVIEW / 2 - 2;
  return (
    <span style={{ width: PREVIEW, height: PREVIEW }} className="checker grid shrink-0 grid-cols-2 place-items-center gap-0.5 rounded-sm border border-line p-0.5">
      {set.slice(0, 4).map((tile) => {
        const ts = doc.getTileset(tile.tilesetId);
        return ts ? <TileSwatch key={`${tile.tilesetId}:${tile.tileId}`} tileset={ts} tileId={tile.tileId} size={cell} /> : <span key={`${tile.tilesetId}:${tile.tileId}`} />;
      })}
      {stamps.slice(0, Math.max(0, 4 - set.length)).map((c) => {
        const stamp = library.find((s) => s.id === c.stampId);
        return stamp ? <BrushPreview key={`s:${c.stampId}`} clip={stamp} doc={doc} width={cell} height={cell} /> : <Icon key={`s:${c.stampId}`} name="stamp" size={16} className="text-faint" />;
      })}
    </span>
  );
}

function TileDetails({ tileset, tileId }: { tileset: Tileset; tileId: number }) {
  const pos = tilePosition(tileset, tileId);
  const solid = isTileSolid(tileset, tileId);
  return (
    <>
      <PropGrid>
        <PropRow label={t("properties.tileset")}>
          <ReadField mono={false}>{tileset.name}</ReadField>
        </PropRow>
        <PropRow label={t("properties.tileId")}>
          <ReadField mono>
            {tileId}
            <span className="ml-2 text-faint">
              ({pos.col}, {pos.row})
            </span>
          </ReadField>
        </PropRow>
        <PropRow label={t("properties.solid")}>
          <Toggle checked={solid} onChange={(checked) => setTilesSolid(tileset.id, [tileId], checked)} label={t("properties.solid")} />
        </PropRow>
      </PropGrid>
    </>
  );
}

/** A clip / stamp on the brush: size, layers and save as stamp. */
function StampDetails({ clip, doc }: { clip: TileClip; doc: MapDocument }) {
  const stampId = activeStampId(clip);
  const [naming, setNaming] = useState<TileClip | null>(null);
  const gridLayers = clip.layers.filter((l) => l.grid).length;
  return (
    <>
      <PropGrid>
        <PropRow label={t("inspector.size")}>
          <ReadField>{t("inspector.clipSize", { width: clip.width, height: clip.height })}</ReadField>
        </PropRow>
        <PropRow label={t("inspector.layers")}>
          <ReadField mono={false}>
            {t("inspector.layersCount", { count: clip.layers.length })}
            {gridLayers > 0 && <Icon name="shield" size={12} className="ml-1.5 text-muted" />}
          </ReadField>
        </PropRow>
      </PropGrid>
      <div className="flex flex-col gap-2 px-3 pt-1.5">
        {stampId ? (
          <span className="flex items-center gap-1.5 text-sm text-muted" data-saved-stamp={stampId}>
            <Icon name="tick" size={12} />
            {t("inspector.savedStamp")}
          </span>
        ) : naming === clip ? (
          <StampNameForm doc={doc} clip={clip} onDone={() => setNaming(null)} />
        ) : (
          <ActionButton icon="stamp" label={t("inspector.saveStamp")} dataAction="saveClipStamp" onClick={() => setNaming(clip)} />
        )}
      </div>
    </>
  );
}

function StampNameForm({ doc, clip, onDone }: { doc: MapDocument; clip: TileClip; onDone(): void }) {
  const [name, setName] = useState(() => defaultStampName(useProjectLibrary.getState().stamps));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (saveClipAsStamp(doc, clip, name)) onDone();
  };
  return (
    <form onSubmit={submit} className="flex items-center gap-1.5">
      <TextField size="sm"
        autoFocus
        value={name}
        aria-label={t("inspector.stampName")}
        onChange={(e) => setName(e.target.value)}
        {...selectAll}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onDone();
          }
        }}
        spellCheck={false}
        autoComplete="off"
        maxLength={64}
        className="flex-1"
      />
      <Button size="sm" type="submit" disabled={name.trim().length === 0}>
        {t("common.save")}
      </Button>
    </form>
  );
}

/**
 * The random brush: tile candidates with weights and chances, then the
 * shared random set controls (saved sets, save, stamp candidates, scatter,
 * random flip — `RandomSetControls`).
 */
function RandomDetails({ doc }: { doc: MapDocument }) {
  const set = useEditorStore((s) => s.randomSet);
  const groups = [...new Set(set.map((tile) => tile.tilesetId))];
  return (
    <div data-random-brush>
      <SectionHeader
        extra={
          <Button size="sm" variant="ghost" onClick={clearRandomSet}>
            {t("random.clear")}
          </Button>
        }
      >
        {t("inspector.random")}
      </SectionHeader>
      {set.length > 0 && (
        <div className="mx-3 mb-2 flex flex-col">
          {groups.map((tilesetId) => {
            const tileset = doc.getTileset(tilesetId);
            return <div key={tilesetId}>
              <div className="flex h-row items-center truncate text-xs font-medium text-muted" title={tileset?.name ?? tilesetId}>{tileset?.name ?? tilesetId}</div>
              <ul className="flex flex-col">
                {set.filter((tile) => tile.tilesetId === tilesetId).map((tile) => <WeightRow
                  key={tile.tileId}
                  visual={tileset ? <TileSwatch tileset={tileset} tileId={tile.tileId} size={16} className="rounded-xs" /> : <span className="size-4 rounded-xs bg-line" />}
                  label={<span className="font-mono text-text tabular">#{tile.tileId}</span>}
                  weight={tile.weight ?? 1}
                  onWeight={(delta) => setRandomWeight(tile, delta)}
                  onRemove={() => removeRandomTile(tile)}
                />)}
              </ul>
            </div>;
          })}
        </div>
      )}
      <div className="px-3">
        <RandomSetControls />
      </div>
    </div>
  );
}

function WeightRow({ visual, label, weight, onWeight, onRemove }: {
  visual: ReactNode;
  label: ReactNode;
  weight: number;
  onWeight(delta: number): void;
  onRemove(): void;
}) {
  return <li className="group rounded-sm px-1 hover:bg-hover">
    <FieldRow label={<span className="flex items-center gap-2">{visual}{label}</span>}>
      <PropField value={weight} aria-label={t("random.weight")} min={MIN_WEIGHT} max={MAX_WEIGHT} scrub onCommit={(next) => onWeight(Math.round(next) - weight)} />
      <IconButton size="sm" aria-label={t("random.remove")} title={t("random.remove")} onClick={onRemove} className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
        <Icon name="x" size={16} />
      </IconButton>
    </FieldRow>
  </li>;
}

// ------------------------------------------------------------------ collision layer

const COLLISION_KINDS: { value: number; label: MessageKey; hint: MessageKey; swatch: string }[] = [
  { value: COLLISION_SOLID, label: "collision.forceSolid", hint: "collision.forceSolidHint", swatch: "bg-collision-solid" },
  { value: COLLISION_PASSABLE, label: "collision.forcePass", hint: "collision.forcePassHint", swatch: "bg-collision-pass" },
];

function CollisionSection() {
  const value = useEditorStore((s) => s.gridValue);
  const setValue = useEditorStore((s) => s.setGridValue);
  const tool = useEditorStore((s) => s.tool);
  return (
    <div data-inspector-collision>
      <SectionHeader>{t("collision.brush")}</SectionHeader>
      <div role="radiogroup" aria-label={t("collision.brush")} className="flex flex-col px-3">
        {COLLISION_KINDS.map((kind) => {
          const on = kind.value === value && tool !== "eraser";
          return (
            <button
              key={kind.value}
              type="button"
              role="radio"
              aria-checked={on}
              data-collision-kind={kind.value}
              title={t(kind.hint)}
              onClick={() => {
                setValue(kind.value);
                if (tool === "eraser") runCommand("tool.brush");
              }}
              className={`flex h-control-md items-center gap-2 rounded-sm px-2 text-left text-sm ${on ? "bg-accent-soft ring-1 ring-inset ring-accent-line" : "hover:bg-hover"}`}
            >
              <span aria-hidden className={`size-3 shrink-0 rounded-xs ${kind.swatch}`} />
              <span className="text-sm text-text">{t(kind.label)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ dock solid flags

function SolidSection({ ctx }: { ctx: InspectorContext }) {
  const activeId = useUiStore((s) => s.activeTilesetId);
  const tileset = ctx.doc.tilesets.find((tileset) => tileset.id === activeId) ?? ctx.doc.tilesets[0];
  const count = tileset?.solidTiles?.length ?? 0;
  return (
    <div data-inspector-solid="">
      <SectionHeader>{t("inspector.solidTiles")}</SectionHeader>
      <PropGrid><PropRow label={t("inspector.thisTileset")}>
        <span className="text-sm text-text tabular" data-solid-count={count}>{t("inspector.solidCount", { count: formatNumber(count) })}</span>
      </PropRow></PropGrid>
    </div>
  );
}

// ------------------------------------------------------------------ map (nothing selected)

function MapSection({ ctx }: { ctx: InspectorContext }) {
  const doc = ctx.doc;
  const map = doc.map;
  const project = useEditorStore((s) => s.project);
  const levelName = useProjectLibrary((s) => (project?.levelId ? s.levels.find((l) => l.id === project.levelId)?.name : undefined));
  const spawn = doc.spawn();
  const spawnCell = spawn ? entityCell(spawn, map) : null;
  return (
    <div data-inspector-map>
      <CardTitle
        leading={<Icon name="map" size={16} />}
        title={levelName ?? project?.name ?? ""}
      />
      {isEntityLayer(ctx.layer) && <p className="truncate px-3 pt-1 text-sm text-muted" title={t("inspector.entityHint")}>{t("inspector.entityHint")}</p>}
      <PropGrid>
        <PropRow label={t("properties.mapSize")}>
          <ReadField>{t("common.cells", { width: map.width, height: map.height })}</ReadField>
        </PropRow>
        <PropRow label={t("inspector.mapPixels")}>
          <ReadField>
            {formatNumber(map.width * map.tileWidth)} × {formatNumber(map.height * map.tileHeight)}
          </ReadField>
        </PropRow>
        <PropRow label={t("properties.tileSize")}>
          <ReadField>
            {map.tileWidth} × {map.tileHeight} px
          </ReadField>
        </PropRow>
        <PropRow label={t("inspector.spawn")}>
          <span className="flex min-w-0 flex-1 items-center gap-2" {...(!spawnCell ? { "data-spawn-hint": "" } : {})}>
            <ReadField className={spawnCell ? "" : "text-muted!"}>{spawnCell ? t("inspector.spawnAt", { x: spawnCell.x, y: spawnCell.y }) : t("inspector.spawnNone")}</ReadField>
            {!spawnCell && <Button size="sm" variant="ghost" onClick={() => chooseEntityType(SPAWN_TYPE_ID)}>{t("properties.addSpawn")}</Button>}
          </span>
        </PropRow>
      </PropGrid>
      <div className="flex flex-col gap-2 px-3 pt-1.5">
        <ActionButton icon="settings-2" label={t("inspector.mapSettings")} command="map.settings" dataAction="map.settings" onClick={() => openMapSettings("name")} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ registration

let registered = false;

/** Registers the built-in cards (idempotent). */
export function registerBuiltinInspectorSections(): void {
  if (registered) return;
  registered = true;
  registerInspectorSection({ id: "builtin.entity", order: 10, when: (c) => c.mode === "entity", Component: EntitySection });
  registerInspectorSection({ id: "builtin.region", order: 10, when: (c) => c.mode === "region" && c.region !== null, Component: RegionSection });
  registerInspectorSection({ id: "builtin.brush", order: 20, when: (c) => c.mode === "brush", Component: BrushSection });
  registerInspectorSection({ id: "builtin.terrain", order: 20, when: (c) => c.mode === "terrain", Component: TerrainCard });
  registerInspectorSection({ id: "builtin.solid", order: 20, when: (c) => c.mode === "solid", Component: SolidSection });
  registerInspectorSection({ id: "builtin.collision", order: 20, when: (c) => c.mode === "collision", Component: CollisionSection });
  registerInspectorSection({ id: "builtin.map", order: 90, when: (c) => c.mode === "map", Component: MapSection });
}
