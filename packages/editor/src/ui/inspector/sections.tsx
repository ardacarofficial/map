/**
 * Built-in Denetçi cards, one per inspector mode (see `mode.ts`):
 * entity, marquee region, brush (FIRÇA), terrain brush (ARAZİ, from
 * `ui/terrain/TerrainCard`), collision kind and the map summary.
 */
import { Menu } from "@base-ui/react/menu";
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

import { chooseEntityType } from "../../commands/entityActions";
import {
  candidatesFromClip,
  clearRandomSet,
  makeRandomFromStamp,
  MAX_WEIGHT,
  MIN_WEIGHT,
  randomChances,
  randomSetOf,
  removeRandomTile,
  setRandomWeight,
  useRandomBrush,
} from "../../commands/randomBrush";
import { getCommand, isEnabled, runCommand } from "../../commands/registry";
import { activeStampId, defaultStampName } from "../../commands/stampActions";
import { setTilesSolid } from "../../commands/terrainActions";
import { formatNumber, t, type MessageKey } from "../../i18n";
import { useProjectLibrary } from "../../io/projectLibrary";
import type { CommandId } from "../../shortcuts/shortcuts";
import { useEditorStore, type CellRegion, type ToolId } from "../../state/editorStore";
import { getCanvasHandle } from "../canvas/canvasHandle";
import { EntityProperties } from "../entities/EntityProperties";
import { openMapSettings } from "../mapSettings/mapSettingsStore";
import { Button } from "../primitives/Button";
import { Icon, type IconName } from "../primitives/Icon";
import { Kbd } from "../primitives/Kbd";
import { menuItemClass, menuPopupClass, menuPositionerClass } from "../primitives/menuStyles";
import { TileSwatch } from "../primitives/TileSwatch";
import { Toggle } from "../primitives/Toggle";
import { TerrainCard } from "../terrain/TerrainCard";
import { RandomSetControls, RandomSetPicker } from "../tileset/RandomSetControls";
import { saveClipAsStamp } from "../tileset/SelectionSection";
import { keysFor } from "../../shortcuts/shortcuts";
import { BrushPreview } from "./BrushPreview";
import { BrushShapeChoice, BrushSizeChip, showsSizeControls } from "./BrushSizeChip";
import { fillBlocker } from "./fillCheck";
import {
  ActionButton,
  CardDivider,
  CardTitle,
  CommandAction,
  IntField,
  PropGrid,
  PropRow,
  ReadField,
  SectionHeader,
  SquareAction,
  TransformGlyph,
} from "./parts";
import { registerInspectorSection, type InspectorContext } from "./registry";

const PREVIEW = 80;

// ------------------------------------------------------------------ entity

function EntitySection({ ctx }: { ctx: InspectorContext }) {
  if (!ctx.entity) return null;
  return <EntityProperties doc={ctx.doc} entity={ctx.entity.entity} />;
}

// ------------------------------------------------------------------ marquee region

/** The marquee region (select tool): its rectangle (editable) and what can be done with it. */
function RegionSection({ ctx }: { ctx: InspectorContext }) {
  const region = ctx.region!;
  const setRegion = useEditorStore((s) => s.setRegion);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const gridValue = useEditorStore((s) => s.gridValue);
  const stamp = useEditorStore((s) => s.stamp);
  const selection = useEditorStore((s) => s.selection);
  const randomSet = useEditorStore((s) => s.randomSet);
  const random = useIsRandomBrush();
  const blocker = fillBlocker(ctx.doc, { activeLayerId, gridValue, stamp, selection, randomSet, random });
  const map = ctx.doc.map;
  const move = (next: Partial<CellRegion>) => setRegion(clampRegionTo({ ...region, ...next }, map.width, map.height));
  return (
    <div data-inspector-region>
      <CardTitle
        leading={
          <span className="grid size-10 shrink-0 place-items-center rounded-md border border-accent-line bg-accent-soft text-accent">
            <Icon name="select" size={18} />
          </span>
        }
        title={t("inspector.region")}
        subtitle={ctx.layer ? t("inspector.regionOn", { layer: ctx.layer.name }) : undefined}
      />
      <SectionHeader>{t("inspector.transform")}</SectionHeader>
      <PropGrid>
        <PropRow label={t("properties.position")}>
          <IntField label={t("inspector.x")} prefix="X" value={region.x} min={0} max={map.width - 1} onCommit={(x) => move({ x })} />
          <IntField label={t("inspector.y")} prefix="Y" value={region.y} min={0} max={map.height - 1} onCommit={(y) => move({ y })} />
        </PropRow>
        <PropRow label={t("inspector.size")}>
          <IntField label={t("inspector.width")} value={region.width} min={1} max={map.width - region.x} onCommit={(width) => move({ width })} />
          <span className="shrink-0 text-faint">×</span>
          <IntField label={t("inspector.height")} value={region.height} min={1} max={map.height - region.y} onCommit={(height) => move({ height })} />
        </PropRow>
      </PropGrid>
      <SectionHeader>{t("inspector.actions")}</SectionHeader>
      <div className="grid grid-cols-2 gap-2 px-3 py-1.5" onPointerDown={(e) => e.preventDefault()}>
        <CommandAction command="edit.copy" icon="copy" label={t("selectionBar.copy")} />
        <CommandAction command="edit.cut" icon="scissors" label={t("selectionBar.cut")} />
        <ActionButton icon="fill" label={t("selectionBar.fill")} dataAction="fill" disabledReason={blocker ? t(blocker) : null} onClick={() => getCanvasHandle()?.fillRegion(region)} />
        <CommandAction command="edit.delete" icon="trash" label={t("selectionBar.erase")} tone="danger" />
        <div className="col-span-2">
          <CommandAction command="stamp.saveSelection" icon="stamp" label={t("selectionBar.saveStamp")} tone="primary" />
        </div>
      </div>
      <div className="px-3 pt-1">
        <button
          type="button"
          onClick={() => runCommand("edit.deselect")}
          className="flex h-7 items-center gap-1.5 rounded-sm px-1 text-sm text-muted transition-colors hover:text-text"
        >
          <Icon name="x" size={13} />
          {t("inspector.deselect")}
          <Kbd keys="Escape" className="ml-1" />
        </button>
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

const PAINT_TOOLS: { id: ToolId; icon: IconName; command: CommandId }[] = [
  { id: "brush", icon: "pencil", command: "tool.brush" },
  { id: "eraser", icon: "eraser", command: "tool.eraser" },
  { id: "fill", icon: "fill", command: "tool.fill" },
  { id: "rect", icon: "rect", command: "tool.rect" },
];

function ToolMenu() {
  const tool = useEditorStore((s) => s.tool);
  const current = PAINT_TOOLS.find((p) => p.id === tool) ?? PAINT_TOOLS[0]!;
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={t("inspector.tool")}
        data-inspector-tool={tool}
        className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-raised px-2 text-md text-text outline-none transition-colors hover:border-line-strong data-popup-open:border-line-strong focus-visible:border-accent"
      >
        <Icon name={current.icon} size={14} className="shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate text-left">{t(`tools.${current.id}` as MessageKey)}</span>
        <Icon name="chevronDown" size={12} className="shrink-0 text-faint" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={4} className={menuPositionerClass}>
          <Menu.Popup className={`${menuPopupClass} min-w-[180px]`}>
            {PAINT_TOOLS.map((p) => {
              const keys = keysFor(p.command)[0];
              return (
                <Menu.Item key={p.id} className={menuItemClass} onClick={() => runCommand(p.command)}>
                  <Icon name={p.icon} size={14} className={p.id === tool ? "text-accent" : "text-muted"} />
                  <span className="flex-1">{t(`tools.${p.id}` as MessageKey)}</span>
                  {keys && <Kbd keys={keys} />}
                </Menu.Item>
              );
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** FIRÇA: what the brush paints and how (concept 11). */
function BrushSection({ ctx }: { ctx: InspectorContext }) {
  const tool = useEditorStore((s) => s.tool);
  const stamp = useEditorStore((s) => s.stamp);
  const selection = useEditorStore((s) => s.selection);
  const randomSet = useEditorStore((s) => s.randomSet);
  const randomStamps = useRandomBrush((s) => s.stamps);
  const randomActive = useIsRandomBrush();
  const size = useEditorStore((s) => s.brushSize);
  const doc = ctx.doc;
  const tileset = selection ? doc.getTileset(selection.tilesetId) : undefined;
  // Same rule as the canvas (`currentRandomSet`): 2+ candidates, or one with scatter.
  const random = randomActive && !stamp;
  const eraser = tool === "eraser";
  // A clip on the brush is placed as it is: the brush size only matters for the eraser then.
  const sized = eraser || (tool === "brush" && !stamp);

  let preview: ReactNode;
  let title: ReactNode;
  let subtitle: ReactNode;
  if (eraser) {
    preview = <PreviewBox><Icon name="eraser" size={28} className="text-muted" /></PreviewBox>;
    title = t("inspector.eraser");
    subtitle = t("inspector.eraserHint");
  } else if (stamp) {
    preview = <BrushPreview clip={stamp} doc={doc} width={PREVIEW} height={PREVIEW} />;
    title = <ClipName clip={stamp} />;
    subtitle = t("inspector.clipSize", { width: stamp.width, height: stamp.height });
  } else if (random) {
    preview = <RandomPreview doc={doc} />;
    title = t("inspector.random");
    subtitle = t("inspector.randomCount", { count: randomSet.length + randomStamps.length });
  } else if (selection && tileset) {
    preview = <TileSwatch tileset={tileset} tileId={selection.tileId} size={PREVIEW} className="checker rounded-md border border-line" />;
    title = `${t("inspector.tile")} #${selection.tileId}`;
    subtitle = tileset.name;
  } else {
    preview = <PreviewBox><Icon name="pencil" size={26} className="text-faint" /></PreviewBox>;
    title = t("inspector.noBrush");
    subtitle = t("inspector.noBrushHint");
  }

  return (
    <div data-inspector-brush>
      <SectionHeader>{t("inspector.brush")}</SectionHeader>
      <div className="flex items-center gap-3 px-3 py-1.5">
        {preview}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[16px] leading-[22px] font-semibold text-text" data-inspector-title>
            {title}
          </span>
          {subtitle && <span className="line-clamp-2 text-sm leading-4 text-muted">{subtitle}</span>}
          {stamp && !eraser && (
            <span className="mt-1 flex items-center gap-1 text-2xs text-faint">
              <Kbd keys="Escape" />
              {t("inspector.dropClip")}
            </span>
          )}
        </div>
      </div>
      <PropGrid>
        <PropRow label={t("inspector.tool")}>
          <ToolMenu />
        </PropRow>
        {sized && (
          <PropRow label={t("toolOptions.size")}>
            <BrushSizeChip withShape={false} showLabel={false} />
          </PropRow>
        )}
        {sized && showsSizeControls(size) && (
          <PropRow label={t("toolOptions.shape")}>
            <BrushShapeChoice />
          </PropRow>
        )}
      </PropGrid>
      {!eraser && stamp && <StampDetails clip={stamp} doc={doc} />}
      {!eraser && !stamp && random && <RandomDetails doc={doc} />}
      {!eraser && !stamp && !random && selection && tileset && <TileDetails tileset={tileset} tileId={selection.tileId} />}
      {!eraser && !stamp && !random && doc.randomSets.length > 0 && (
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
    <span style={{ width: PREVIEW, height: PREVIEW }} className="grid shrink-0 place-items-center rounded-md border border-dashed border-line-strong bg-raised">
      {children}
    </span>
  );
}

function ClipName({ clip }: { clip: TileClip }) {
  const stampId = activeStampId(clip);
  const saved = useProjectLibrary((s) => (stampId ? s.stamps.find((st) => st.id === stampId) : undefined));
  return <>{saved?.name ?? t("inspector.clip")}</>;
}

/** True when the editor's random brush (tiles + `useRandomBrush` options) is a random brush. */
function useIsRandomBrush(): boolean {
  const tiles = useEditorStore((s) => s.randomSet);
  const options = useRandomBrush();
  return randomSetOf(tiles, options) !== null;
}

/** Up to 4 candidates of the random brush (tiles, then stamps) in a 2 × 2 grid. */
function RandomPreview({ doc }: { doc: MapDocument }) {
  const set = useEditorStore((s) => s.randomSet);
  const stamps = useRandomBrush((s) => s.stamps);
  const library = useProjectLibrary((s) => s.stamps);
  const cell = PREVIEW / 2 - 2;
  return (
    <span style={{ width: PREVIEW, height: PREVIEW }} className="checker grid shrink-0 grid-cols-2 place-items-center gap-0.5 rounded-md border border-accent-line p-0.5">
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

function OrientationRow() {
  const rotate = !!getCommand("edit.rotateCW");
  const enabled = (id: CommandId) => {
    const c = getCommand(id);
    return !!c && isEnabled(c);
  };
  return (
    <PropRow label={t("inspector.transform")}>
      <SquareAction label={t("inspector.flipX")} command="edit.flipX" disabled={!enabled("edit.flipX")} onClick={() => runCommand("edit.flipX")}>
        <TransformGlyph kind="flipX" />
      </SquareAction>
      <SquareAction label={t("inspector.flipY")} command="edit.flipY" disabled={!enabled("edit.flipY")} onClick={() => runCommand("edit.flipY")}>
        <TransformGlyph kind="flipY" />
      </SquareAction>
      <span aria-hidden className="mx-0.5 h-5 w-px bg-line" />
      <SquareAction
        label={rotate ? t("inspector.rotateCCW") : t("inspector.rotateUnavailable")}
        command="edit.rotateCCW"
        disabled={!enabled("edit.rotateCCW")}
        onClick={() => runCommand("edit.rotateCCW")}
      >
        <TransformGlyph kind="rotateCCW" />
      </SquareAction>
      <SquareAction
        label={rotate ? t("inspector.rotateCW") : t("inspector.rotateUnavailable")}
        command="edit.rotateCW"
        disabled={!enabled("edit.rotateCW")}
        onClick={() => runCommand("edit.rotateCW")}
      >
        <TransformGlyph kind="rotateCW" />
      </SquareAction>
    </PropRow>
  );
}

function TileDetails({ tileset, tileId }: { tileset: Tileset; tileId: number }) {
  const pos = tilePosition(tileset, tileId);
  const solid = isTileSolid(tileset, tileId);
  return (
    <>
      <CardDivider />
      <PropGrid>
        <PropRow label={t("properties.tileset")}>
          <ReadField mono={false}>{tileset.name}</ReadField>
        </PropRow>
        <PropRow label={t("properties.tileId")}>
          <ReadField>
            {tileId}
            <span className="ml-2 text-faint">
              ({pos.col}, {pos.row}) · {tileset.tileWidth}×{tileset.tileHeight}
            </span>
          </ReadField>
        </PropRow>
        <PropRow label={t("properties.solid")}>
          <Toggle checked={solid} onChange={(checked) => setTilesSolid(tileset.id, [tileId], checked)} label={t("properties.solid")} />
          <span className={`text-sm ${solid ? "text-text" : "text-muted"}`}>{solid ? t("properties.yes") : t("properties.no")}</span>
        </PropRow>
        <OrientationRow />
      </PropGrid>
    </>
  );
}

/** A clip / stamp on the brush: size, layers, flip / rotate, save as stamp, make random. */
function StampDetails({ clip, doc }: { clip: TileClip; doc: MapDocument }) {
  const stampId = activeStampId(clip);
  const [naming, setNaming] = useState<TileClip | null>(null);
  const gridLayers = clip.layers.filter((l) => l.grid).length;
  const canRandom = !stampId && gridLayers === 0 && candidatesFromClip(clip).length >= 2;
  return (
    <>
      <CardDivider />
      <PropGrid>
        <PropRow label={t("inspector.size")}>
          <ReadField>{t("inspector.clipSize", { width: clip.width, height: clip.height })}</ReadField>
        </PropRow>
        <PropRow label={t("inspector.layers")}>
          <ReadField mono={false}>
            {t("inspector.layersCount", { count: clip.layers.length })}
            {gridLayers > 0 && <Icon name="shield" size={12} className="ml-1.5 text-collision-solid/80" />}
          </ReadField>
        </PropRow>
        <OrientationRow />
      </PropGrid>
      <div className="flex flex-col gap-2 px-3 pt-1.5">
        {stampId ? (
          <span className="flex items-center gap-1.5 text-sm text-muted" data-saved-stamp={stampId}>
            <Icon name="check" size={13} className="text-accent" />
            {t("inspector.savedStamp")}
          </span>
        ) : naming === clip ? (
          <StampNameForm doc={doc} clip={clip} onDone={() => setNaming(null)} />
        ) : (
          <ActionButton icon="stamp" label={t("inspector.saveStamp")} dataAction="saveClipStamp" onClick={() => setNaming(clip)} />
        )}
        {canRandom && (
          <ActionButton icon="dice" label={t("inspector.makeRandom")} dataAction="makeRandom" onClick={() => void makeRandomFromStamp()} />
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
      <input
        autoFocus
        value={name}
        aria-label={t("inspector.stampName")}
        onChange={(e) => setName(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
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
        className="h-8 min-w-0 flex-1 rounded-md border border-line bg-raised px-2 text-md text-text focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:outline-none"
      />
      <Button type="submit" variant="primary" className="h-8 px-2.5 text-sm" disabled={name.trim().length === 0}>
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
  const stamps = useRandomBrush((s) => s.stamps);
  const chances = randomChances([...set, ...stamps]);
  return (
    <div data-random-brush>
      <SectionHeader
        extra={
          <button type="button" onClick={clearRandomSet} className="h-6 rounded-sm px-1.5 text-xs text-muted transition-colors hover:bg-hover hover:text-text">
            {t("random.clear")}
          </button>
        }
      >
        {t("inspector.random")}
      </SectionHeader>
      {set.length > 0 && (
        <ul className="mx-3 mb-2 flex max-h-[188px] flex-col gap-0.5 overflow-y-auto rounded-md border border-line bg-raised p-1">
          {set.map((tile, i) => {
            const tileset = doc.getTileset(tile.tilesetId);
            return (
              <WeightRow
                key={`t:${tile.tilesetId}:${tile.tileId}`}
                visual={tileset ? <TileSwatch tileset={tileset} tileId={tile.tileId} size={20} className="rounded-xs" /> : <span className="size-5 rounded-xs bg-line" />}
                label={
                  <>
                    <span className="font-mono tabular">#{tile.tileId}</span>
                    {doc.tilesets.length > 1 && <span className="ml-1.5">{tileset?.name ?? tile.tilesetId}</span>}
                  </>
                }
                chance={chances[i] ?? 0}
                weight={tile.weight ?? 1}
                onWeight={(d) => setRandomWeight(tile, d)}
                onRemove={() => removeRandomTile(tile)}
              />
            );
          })}
        </ul>
      )}
      <div className="px-3">
        <RandomSetControls />
      </div>
      <p className="px-3 pt-2 text-xs leading-4 text-faint">{t("random.hint")}</p>
    </div>
  );
}

function WeightRow({
  visual,
  label,
  chance,
  weight,
  onWeight,
  onRemove,
}: {
  visual: ReactNode;
  label: ReactNode;
  chance: number;
  weight: number;
  onWeight(delta: number): void;
  onRemove(): void;
}) {
  return (
    <li className="group flex h-7 items-center gap-2 rounded-sm pr-1 pl-1 hover:bg-hover">
      {visual}
      <span className="min-w-0 flex-1 truncate text-sm text-muted">{label}</span>
      <span className="w-9 shrink-0 text-right font-mono text-xs text-faint tabular">{t("random.chance", { percent: chance })}</span>
      <span className="flex shrink-0 items-center rounded-sm border border-line bg-panel">
        <StepGlyph icon="minus" label={t("random.dec")} disabled={weight <= MIN_WEIGHT} onClick={() => onWeight(-1)} />
        <span className="w-4 text-center font-mono text-xs text-text tabular">{weight}</span>
        <StepGlyph icon="plus" label={t("random.inc")} disabled={weight >= MAX_WEIGHT} onClick={() => onWeight(1)} />
      </span>
      <button
        type="button"
        aria-label={t("random.remove")}
        title={t("random.remove")}
        onClick={onRemove}
        className="grid size-5 shrink-0 place-items-center rounded-sm text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:bg-active hover:text-text focus-visible:opacity-100"
      >
        <Icon name="x" size={12} />
      </button>
    </li>
  );
}

function StepGlyph({ icon, label, disabled, onClick }: { icon: "plus" | "minus"; label: string; disabled: boolean; onClick(): void }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="grid size-5 place-items-center text-muted transition-colors hover:text-text disabled:opacity-30">
      <Icon name={icon} size={11} strokeWidth={2.25} />
    </button>
  );
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
      <div role="radiogroup" aria-label={t("collision.brush")} className="flex flex-col gap-1.5 px-3 py-1.5">
        {COLLISION_KINDS.map((kind) => {
          const on = kind.value === value && tool !== "eraser";
          return (
            <button
              key={kind.value}
              type="button"
              role="radio"
              aria-checked={on}
              data-collision-kind={kind.value}
              onClick={() => {
                setValue(kind.value);
                if (tool === "eraser") runCommand("tool.brush");
              }}
              className={`flex items-start gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors ${
                on ? "border-accent-line bg-accent-soft" : "border-line bg-raised hover:border-line-strong hover:bg-hover"
              }`}
            >
              <span aria-hidden className={`mt-1 size-3 shrink-0 rounded-xs ${kind.swatch}`} />
              <span className="flex min-w-0 flex-col">
                <span className="text-md text-text">{t(kind.label)}</span>
                <span className="text-xs leading-4 text-faint">{t(kind.hint)}</span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="px-3 pt-1 text-xs leading-4 text-faint">{tool === "eraser" ? t("collision.eraserHint") : t("inspector.collisionHint")}</p>
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
        leading={
          <span className="grid size-10 shrink-0 place-items-center rounded-md border border-line bg-raised text-muted" style={doc.background ? { background: doc.background } : undefined}>
            <Icon name="map" size={18} />
          </span>
        }
        title={levelName ?? project?.name ?? ""}
        subtitle={t("inspector.map")}
      />
      {isEntityLayer(ctx.layer) && <p className="px-3 pt-1 text-sm leading-5 text-muted">{t("inspector.entityHint")}</p>}
      <SectionHeader>{t("properties.map")}</SectionHeader>
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
        <PropRow label={t("inspector.layers")}>
          <ReadField>{doc.layers.length}</ReadField>
        </PropRow>
        <PropRow label={t("inspector.spawn")}>
          <ReadField className={spawnCell ? "" : "text-warning"}>{spawnCell ? t("inspector.spawnAt", { x: spawnCell.x, y: spawnCell.y }) : t("inspector.spawnNone")}</ReadField>
        </PropRow>
      </PropGrid>
      <div className="flex flex-col gap-2 px-3 pt-1.5">
        <ActionButton icon="sliders" label={t("inspector.mapSettings")} command="map.settings" dataAction="map.settings" onClick={() => openMapSettings("name")} />
        {!spawnCell && <SpawnHint />}
      </div>
    </div>
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
  registerInspectorSection({ id: "builtin.collision", order: 20, when: (c) => c.mode === "collision", Component: CollisionSection });
  registerInspectorSection({ id: "builtin.map", order: 90, when: (c) => c.mode === "map", Component: MapSection });
}
