import { Menu } from "@base-ui/react/menu";
import { Slider } from "@base-ui/react/slider";
import { isEntityLayer, isGridLayer, isTileLayer, type MapDocument, type TileLayer } from "@smap/core";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { addLayer, opacityDrag, removeLayer, renameLayer } from "../../commands/layerActions";
import { addCollisionLayer, applyLayerOrder, removeTerrainGroup, setLayersProps } from "../../commands/terrainActions";
import { addEntityLayer } from "../../commands/entityActions";
import { formatNumber, t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { flashLayer, useLayerFlash } from "../feedback/layerFlash";
import { useStructureVersion } from "../hooks";
import { IconButton } from "../primitives/Button";
import { Icon, type IconName } from "../primitives/Icon";
import { CommandKbd } from "../primitives/Kbd";
import { menuItemClass, menuPopupClass, menuPositionerClass } from "../primitives/menuStyles";
import { RenameInput } from "../primitives/RenameInput";
import { Tooltip } from "../primitives/Tooltip";
import { layerRows, layerUnits, moveUnitOrder, unitIndexOf, type LayerRow } from "../terrain/layerGroups";
import { toast } from "../toast/toastStore";
import { dropIndex, rowShift } from "./layerOrder";
import { PanelSection } from "./PanelSection";

/** Row height in px (keep in sync with `h-8`). */
const ROW = 32;
/** Pointer travel before a press turns into a drag. */
const DRAG_THRESHOLD = 4;

interface Drag {
  layerId: string;
  /** Top-first index of the dragged unit (a layer, or a terrain group as a whole). */
  from: number;
  startY: number;
  dy: number;
  active: boolean;
}

const NO_EXPANDED: ReadonlySet<string> = new Set();

/**
 * Layers, top layer first: select, rename (double-click), show/hide, lock,
 * drag to reorder, opacity. A terrain layer and the tile layer it writes
 * into show as one group ("Çimen (arazi)", derived tiles nested and
 * collapsed); the group moves, hides and locks as a whole. Every change is
 * a core op, so all are undoable.
 */
export function LayersPanel() {
  const store = useEditorStore((s) => s.project?.store);
  const activeId = useEditorStore((s) => s.activeLayerId);
  const setActive = useEditorStore((s) => s.setActiveLayer);
  useStructureVersion(store);
  const doc = store?.document;
  const units = doc ? layerUnits(doc) : [];
  const count = units.length;
  const layerCount = doc?.layers.length ?? 0;

  const [drag, setDrag] = useState<Drag | null>(null);
  const [settling, setSettling] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(NO_EXPANDED);
  const dragRef = useRef<Drag | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const flash = useLayerFlash();

  // After a drop the DOM order changes; skip the slide-back animation for one frame.
  useEffect(() => {
    if (!settling) return;
    const frame = requestAnimationFrame(() => setSettling(false));
    return () => cancelAnimationFrame(frame);
  }, [settling]);

  // A flashed row (layer switched / created for the user) scrolls into view.
  useEffect(() => {
    if (!flash.layerId) return;
    const row = listRef.current?.querySelector(`[data-layer-id="${CSS.escape(flash.layerId)}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [flash.layerId, flash.token]);

  // While dragging, groups render collapsed so every unit is one row.
  const rows = layerRows(units, drag?.active ? NO_EXPANDED : expanded);
  const to = drag?.active ? dropIndex(drag.from, drag.dy, ROW, count) : null;
  const activeUnit = units[unitIndexOf(units, activeId)];
  const active = activeId ? doc?.getLayer(activeId) : undefined;
  // The opacity row follows what is visible: a terrain group's tiles.
  const opacityLayer = activeUnit?.child && activeUnit.head.id === activeId ? activeUnit.child : active;

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onPointerDown = (event: ReactPointerEvent<HTMLLIElement>, row: LayerRow) => {
    if (event.button !== 0 || editingId === row.layer.id) return;
    if ((event.target as HTMLElement).closest("button, input")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const next = { layerId: row.layer.id, from: row.unit, startY: event.clientY, dy: 0, active: false };
    dragRef.current = next;
    setDrag(next);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLLIElement>, row: LayerRow) => {
    const current = dragRef.current;
    if (!current || row.kind === "derived") return; // derived tiles move with their group
    const raw = event.clientY - current.startY;
    if (!current.active && Math.abs(raw) < DRAG_THRESHOLD) return;
    // Keep the row inside the list.
    const dy = Math.max(-current.from * ROW, Math.min((count - 1 - current.from) * ROW, raw));
    const next = { ...current, dy, active: true };
    dragRef.current = next;
    setDrag(next);
  };
  const onPointerUp = (row: LayerRow) => {
    const current = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!current) return;
    if (!current.active) {
      if (row.kind === "derived") {
        // Auto-generated tiles cannot be painted by hand: select the terrain that makes them, and say why.
        setActive(row.parent.id);
        flashLayer(row.parent.id);
        toast.info(t("layers.derivedPicked", { name: row.parent.name }));
      } else {
        setActive(row.layer.id);
      }
      return;
    }
    const target = dropIndex(current.from, current.dy, ROW, count);
    if (target !== current.from) {
      setSettling(true);
      applyLayerOrder(moveUnitOrder(units, current.from, target));
    }
    setActive(current.layerId);
  };
  const onPointerCancel = () => {
    dragRef.current = null;
    setDrag(null);
  };

  const removeActive = () => {
    if (!active) return;
    if (activeUnit?.child && activeUnit.head.id === active.id) removeTerrainGroup(active.id);
    else removeLayer(active.id);
  };
  const removeDisabled = !active || layerCount <= (activeUnit?.child && activeUnit.head.id === active.id ? 2 : 1);

  return (
    <PanelSection
      title={t("panels.layers")}
      className="shrink-0"
      actions={
        <>
          <AddLayerMenu />
          <Tooltip label={t("layers.remove")}>
            <IconButton aria-label={t("layers.remove")} className="size-7" disabled={removeDisabled} onClick={removeActive}>
              <Icon name="trash" size={14} />
            </IconButton>
          </Tooltip>
        </>
      }
    >
      <ul
        ref={listRef}
        role="listbox"
        aria-label={t("panels.layers")}
        className="relative flex max-h-[232px] flex-col overflow-y-auto px-1.5 pb-1.5"
      >
        {rows.map((row) => {
          const { layer } = row;
          const isActive =
            layer.id === activeId || (row.kind === "group" && row.child.id === activeId);
          const dragged = drag?.active && drag.from === row.unit;
          const shift = drag?.active && to !== null ? rowShift(row.unit, drag.from, to, ROW) : 0;
          const y = dragged ? drag.dy : shift;
          const flashed =
            flash.layerId !== null && (flash.layerId === layer.id || (row.kind === "group" && flash.layerId === row.child.id));
          const groupLayers = row.kind === "group" ? [layer, row.child] : [layer];
          const visible = groupLayers.some((l) => l.visible);
          const locked = groupLayers.every((l) => l.locked);
          const item = (
            <li
              key={layer.id}
              role="option"
              aria-selected={isActive}
              aria-expanded={row.kind === "group" ? row.expanded : undefined}
              data-layer-id={layer.id}
              data-layer-row={row.kind}
              data-flash={flashed ? "" : undefined}
              onPointerDown={(e) => onPointerDown(e, row)}
              onPointerMove={(e) => onPointerMove(e, row)}
              onPointerUp={() => onPointerUp(row)}
              onPointerCancel={onPointerCancel}
              onDoubleClick={(e) => {
                if (row.kind !== "derived" && !(e.target as HTMLElement).closest("button")) setEditingId(layer.id);
              }}
              style={{ transform: y ? `translateY(${y}px)` : undefined }}
              className={`group relative flex h-8 shrink-0 items-center gap-1.5 rounded-md pr-1 text-md ${
                row.kind === "derived" ? "pl-7" : row.kind === "group" ? "pl-0.5" : "pl-2"
              } ${
                dragged
                  ? "z-10 cursor-grabbing bg-active shadow-popup"
                  : settling
                    ? ""
                    : "transition-[transform,background-color,box-shadow] duration-150 ease-(--ease-out)"
              } ${
                flashed
                  ? "bg-accent-soft text-text shadow-[inset_0_0_0_1px_var(--color-accent-line)]"
                  : isActive && row.kind !== "derived"
                    ? "bg-active text-text"
                    : "text-muted hover:bg-hover hover:text-text"
              }`}
            >
              {isActive && row.kind !== "derived" && (
                <span aria-hidden className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-accent" />
              )}
              {row.kind === "derived" && (
                <span aria-hidden className="absolute top-0 bottom-1/2 left-[13px] w-2.5 rounded-bl-[4px] border-b border-l border-line-strong" />
              )}
              {row.kind === "group" && (
                <button
                  type="button"
                  aria-label={row.expanded ? t("layers.collapseGroup") : t("layers.expandGroup")}
                  title={row.expanded ? t("layers.collapseGroup") : t("layers.expandGroup")}
                  onClick={() => toggleExpanded(layer.id)}
                  className="grid size-5 shrink-0 place-items-center rounded-sm text-faint hover:bg-hover hover:text-text"
                >
                  <Icon name="chevronRight" size={12} className={`transition-transform duration-100 ${row.expanded ? "rotate-90" : ""}`} />
                </button>
              )}
              <Icon
                name={row.kind === "derived" ? "layers" : layerIcon(layer)}
                size={14}
                className={`shrink-0 ${row.kind === "derived" ? "text-faint" : layerTint(layer, isActive)}`}
              />
              {editingId === layer.id ? (
                <RenameInput
                  initial={layer.name}
                  label={t("layers.rename")}
                  onDone={(name) => {
                    setEditingId(null);
                    if (name !== null) renameLayer(layer.id, name);
                  }}
                />
              ) : row.kind === "derived" ? (
                <span className={`flex min-w-0 flex-1 flex-col leading-tight ${layer.visible ? "" : "text-faint line-through decoration-line-strong"}`}>
                  <span className="truncate text-sm">{layer.name}</span>
                  <span className="truncate text-2xs text-faint no-underline">{t("layers.derivedNote")}</span>
                </span>
              ) : (
                <span
                  title={t("layers.renameHint")}
                  className={`flex min-w-0 flex-1 items-baseline gap-1.5 ${visible ? "" : "text-faint line-through decoration-line-strong"}`}
                >
                  <span className="min-w-0 shrink truncate">{layer.name}</span>
                  {row.kind === "layer" && doc && <LayerLink doc={doc} layer={layer} />}
                </span>
              )}
              {(row.kind === "group" ? row.child : layer).opacity < 1 && editingId !== layer.id && (
                <span className="font-mono text-2xs text-faint tabular">
                  {Math.round((row.kind === "group" ? row.child : layer).opacity * 100)}%
                </span>
              )}
              {row.kind !== "derived" && (
                <RowToggle
                  on={locked}
                  label={locked ? t("layers.unlock") : t("layers.lock")}
                  icon={locked ? "lock" : "unlock"}
                  onClick={() => setLayersProps(groupLayers.map((l) => l.id), { locked: !locked })}
                  persistent={locked}
                />
              )}
              <RowToggle
                on={!visible}
                label={visible ? t("layers.hide") : t("layers.show")}
                icon={visible ? "eye" : "eyeOff"}
                onClick={() => setLayersProps(groupLayers.map((l) => l.id), { visible: !visible })}
                persistent={!visible}
              />
            </li>
          );
          return row.kind === "derived" ? (
            <Tooltip key={layer.id} side="left" label={t("layers.derivedTooltip", { name: row.parent.name })}>
              {item}
            </Tooltip>
          ) : (
            item
          );
        })}
      </ul>
      {opacityLayer && <OpacityRow layer={opacityLayer} />}
    </PanelSection>
  );
}

function layerIcon(layer: TileLayer): IconName {
  if (isEntityLayer(layer)) return "box";
  if (!isGridLayer(layer)) return "layers";
  return layer.role === "terrain" ? "terrain" : "shield";
}

/** Role colour of the row icon: full when active, dimmed otherwise; plain tile layers stay neutral until active. */
function layerTint(layer: TileLayer, active: boolean): string {
  if (isGridLayer(layer)) {
    const tint = layer.role === "collision" ? "text-collision-solid" : "text-terrain-tint";
    return active ? tint : `${tint} opacity-70`;
  }
  if (isEntityLayer(layer)) return active ? "text-warning" : "text-warning opacity-70";
  return active ? "text-accent" : "text-faint";
}

/**
 * The terrain ↔ tile layer link of a pair that is NOT grouped (pulled
 * apart), as a faint note after the name: a terrain layer shows "→ Çimen"
 * (the tile layer it writes into); that tile layer shows a small terrain mark.
 */
function LayerLink({ doc, layer }: { doc: MapDocument; layer: TileLayer }) {
  if (isGridLayer(layer)) {
    if (layer.role !== "terrain") return null;
    const target = layer.targetLayerId ? doc.getLayer(layer.targetLayerId) : undefined;
    return (
      <span
        title={target ? t("layers.terrainTarget", { name: target.name }) : t("layers.terrainNoTarget")}
        className="flex min-w-0 shrink-[2] items-center gap-0.5 truncate text-xs text-faint no-underline"
      >
        <Icon name="cornerDownRight" size={11} className="shrink-0" />
        <span className="truncate">{target?.name ?? "—"}</span>
      </span>
    );
  }
  if (!isTileLayer(layer)) return null;
  const source = doc.layers.find((l) => isGridLayer(l) && l.role === "terrain" && l.targetLayerId === layer.id);
  if (!source) return null;
  return (
    <span title={t("layers.derived", { name: source.name })} className="flex shrink-0 items-center self-center text-terrain-tint/80">
      <Icon name="terrain" size={11} />
    </span>
  );
}

/** "+" in the layers header: tile layer or collision (exceptions) layer. */
function AddLayerMenu() {
  return (
    <Menu.Root>
      <Tooltip label={t("layers.add")} command="layer.add">
        <Menu.Trigger
          render={
            <IconButton aria-label={t("layers.add")} className="size-7 data-popup-open:bg-hover data-popup-open:text-text">
              <Icon name="plus" size={15} />
            </IconButton>
          }
        />
      </Tooltip>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={4} className={menuPositionerClass}>
          <Menu.Popup className={`${menuPopupClass} w-[260px]`}>
            <Menu.Item className={`${menuItemClass} items-start`} onClick={() => void addLayer()}>
              <Icon name="layers" size={15} className="mt-0.5 shrink-0 text-muted" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span>{t("layers.addTile")}</span>
                <span className="text-xs text-faint">{t("layers.addTileHint")}</span>
              </span>
              <CommandKbd command="layer.add" className="mt-0.5" />
            </Menu.Item>
            <Menu.Item className={`${menuItemClass} items-start`} onClick={() => void addCollisionLayer()}>
              <Icon name="shield" size={15} className="mt-0.5 shrink-0 text-collision-solid" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span>{t("layers.addCollision")}</span>
                <span className="text-xs text-faint">{t("layers.addCollisionHint")}</span>
              </span>
            </Menu.Item>
            <Menu.Item className={`${menuItemClass} items-start`} onClick={() => void addEntityLayer()}>
              <Icon name="box" size={15} className="mt-0.5 shrink-0 text-warning" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span>{t("layers.addEntity")}</span>
                <span className="text-xs text-faint">{t("layers.addEntityHint")}</span>
              </span>
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Lock / eye button: hidden until row hover unless its state is "on". */
function RowToggle({
  on,
  label,
  icon,
  onClick,
  persistent,
}: {
  on: boolean;
  label: string;
  icon: "lock" | "unlock" | "eye" | "eyeOff";
  onClick(): void;
  persistent: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={on}
      onClick={onClick}
      className={`grid size-6 shrink-0 place-items-center rounded-sm transition-[opacity,color] duration-100 hover:bg-hover hover:text-text focus-visible:opacity-100 ${
        persistent ? "text-muted opacity-100" : "text-faint opacity-0 group-hover:opacity-100 group-aria-selected:opacity-100"
      }`}
    >
      <Icon name={icon} size={14} />
    </button>
  );
}

function OpacityRow({ layer }: { layer: TileLayer }) {
  const percent = Math.round(layer.opacity * 100);
  // Safety net: a drag that ends outside the slider still closes its undo step.
  useEffect(() => {
    const end = () => setTimeout(() => opacityDrag.end(), 0);
    window.addEventListener("pointerup", end);
    return () => {
      window.removeEventListener("pointerup", end);
      opacityDrag.end();
    };
  }, []);
  return (
    <div className="flex h-9 items-center gap-3 border-t border-line-subtle pr-3 pl-3">
      <span className="text-xs text-faint">{t("layers.opacity")}</span>
      <Slider.Root
        value={percent}
        min={0}
        max={100}
        step={1}
        onValueChange={(value) => opacityDrag.change(layer.id, value / 100)}
        onValueCommitted={() => opacityDrag.end()}
        className="flex-1"
      >
        <Slider.Control className="flex h-5 w-full touch-none items-center select-none">
          <Slider.Track className="h-1 w-full rounded-full bg-line select-none">
            <Slider.Indicator className="rounded-full bg-accent select-none" />
            <Slider.Thumb
              aria-label={t("layers.opacity")}
              className="size-3 rounded-full bg-text shadow-popup transition-transform select-none hover:scale-110 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
            />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
      <span className="w-9 text-right font-mono text-xs text-muted tabular">{formatNumber(percent)}%</span>
    </div>
  );
}
