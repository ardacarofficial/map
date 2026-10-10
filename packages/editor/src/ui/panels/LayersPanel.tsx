import { Menu } from "@base-ui/react/menu";
import { Slider } from "@base-ui/react/slider";
import { isEntityLayer, isGridLayer, type TileLayer } from "@smap/core";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  addLayer,
  applyLayerOrder,
  canRemoveUnit,
  isSolo,
  moveUnitOrder,
  opacityDrag,
  removeUnit,
  renameLayer,
  requestOpacityFocus,
  selectLayerContent,
  setUnitProps,
  soloLayer,
  startLayerRename,
  unitOf,
  useLayerUi,
} from "../../commands/layerActions";
import { addCollisionLayer } from "../../commands/terrainActions";
import { addEntityLayer } from "../../commands/entityActions";
import { formatNumber, t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { useLayerFlash } from "../feedback/layerFlash";
import { useStructureVersion } from "../hooks";
import { IconButton } from "../primitives/Button";
import { Icon, type IconName } from "../primitives/Icon";
import { CommandKbd } from "../primitives/Kbd";
import { menuItemClass, menuPopupClass, menuPositionerClass } from "../primitives/menuStyles";
import { RenameInput } from "../primitives/RenameInput";
import { Tooltip } from "../primitives/Tooltip";
import { PointMenu, RowContextMenu, type MenuPoint } from "../contextMenus/RowContextMenu";
import { SEPARATOR, type ContextEntry } from "../contextMenus/contextItems";
import type { SectionPanelProps } from "../layout/RightColumn";
import { dropIndex, rowShift } from "./layerOrder";
import { PanelSection } from "./PanelSection";

/** Row height in px (keep in sync with `h-8`). */
const ROW = 29;
/** Pointer travel before a press turns into a drag. */
const DRAG_THRESHOLD = 4;

/** One row of the list: a layer and its top-first index. */
interface LayerRow {
  readonly layer: TileLayer;
  readonly unit: number;
}

interface Drag {
  layerId: string;
  /** Top-first index of the dragged layer. */
  from: number;
  startY: number;
  dy: number;
  active: boolean;
}

/**
 * Layers, top layer first: select, rename (double-click), show/hide, lock,
 * drag to reorder, opacity. Every change is a core op, so all are undoable. Right-click a row for its menu (rename,
 * duplicate, solo, move, merge, opacity, select content, delete), the empty
 * list area for "new layer"; Alt+click an eye shows only that layer.
 */
export function LayersPanel({ collapsed = false, onToggleCollapsed, extra }: Partial<SectionPanelProps> = {}) {
  const store = useEditorStore((s) => s.project?.store);
  const activeId = useEditorStore((s) => s.activeLayerId);
  const setActive = useEditorStore((s) => s.setActiveLayer);
  useStructureVersion(store);
  const doc = store?.document;
  const units = doc ? unitOf(doc, null).units : [];
  const count = units.length;
  const layerCount = doc?.layers.length ?? 0;

  const [drag, setDrag] = useState<Drag | null>(null);
  const [settling, setSettling] = useState(false);
  const editingId = useLayerUi((s) => s.renamingId);
  const setEditingId = startLayerRename;
  const [emptyMenu, setEmptyMenu] = useState<MenuPoint | null>(null);
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

  const rows = units.map((u, unit) => ({ layer: u.head, unit }));
  const to = drag?.active ? dropIndex(drag.from, drag.dy, ROW, count) : null;
  const active = activeId ? doc?.getLayer(activeId) : undefined;
  const opacityLayer = active;

  const onPointerDown = (event: ReactPointerEvent<HTMLLIElement>, row: LayerRow) => {
    if (event.button !== 0 || editingId === row.layer.id) return;
    if ((event.target as HTMLElement).closest("button, input")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const next = { layerId: row.layer.id, from: row.unit, startY: event.clientY, dy: 0, active: false };
    dragRef.current = next;
    setDrag(next);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLLIElement>) => {
    const current = dragRef.current;
    if (!current) return;
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
      setActive(row.layer.id);
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
    if (active) removeUnit(active.id);
  };
  const removeDisabled = !active || !canRemoveUnit(doc, active.id) || layerCount <= 1;

  const onListContextMenu = (event: ReactMouseEvent<HTMLUListElement>) => {
    // Rows have their own menu.
    if ((event.target as HTMLElement).closest("[data-layer-id]")) return;
    event.preventDefault();
    setEmptyMenu({ x: event.clientX, y: event.clientY });
  };

  return (
    <PanelSection
      title={t("panels.layers")}
      className="flex-auto"
      collapsed={collapsed}
      extra={extra}
      {...(onToggleCollapsed ? { onToggleCollapsed } : {})}
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
      {opacityLayer && <OpacityRow layer={opacityLayer} />}
      <ul
        ref={listRef}
        role="listbox"
        aria-label={t("panels.layers")}
        onContextMenu={onListContextMenu}
        data-layers-list=""
        className="relative flex min-h-[40px] flex-auto flex-col overflow-y-auto px-1.5 pb-1.5"
      >
        {rows.map((row) => {
          const { layer } = row;
          const isActive = layer.id === activeId;
          const dragged = drag?.active && drag.from === row.unit;
          const shift = drag?.active && to !== null ? rowShift(row.unit, drag.from, to, ROW) : 0;
          const y = dragged ? drag.dy : shift;
          const flashed = flash.layerId !== null && flash.layerId === layer.id;
          const visible = layer.visible;
          const locked = layer.locked;
          const rowElement = (
            <li
              key={layer.id}
              role="option"
              aria-selected={isActive}
              data-layer-id={layer.id}
              data-layer-row="layer"
              data-flash={flashed ? "" : undefined}
              onPointerDown={(e) => onPointerDown(e, row)}
              onPointerMove={(e) => onPointerMove(e)}
              onPointerUp={() => onPointerUp(row)}
              onPointerCancel={onPointerCancel}
              onDoubleClick={(e) => {
                if (!(e.target as HTMLElement).closest("button")) setEditingId(layer.id);
              }}
              style={{ transform: y ? `translateY(${y}px)` : undefined }}
              className={`group relative flex h-layerrow shrink-0 items-center gap-1.5 rounded-sm pr-1 pl-1 text-md ${
                dragged
                  ? "z-10 cursor-grabbing bg-active shadow-popup"
                  : settling
                    ? ""
                    : "transition-[transform,background-color,box-shadow] duration-150 ease-(--ease-out)"
              } ${
                flashed
                  ? "bg-accent-soft text-text shadow-[inset_0_0_0_1px_var(--color-accent-line)]"
                  : isActive
                    ? "bg-accent-soft text-title shadow-[inset_0_0_0_1px_var(--color-accent-line)]"
                    : "text-muted hover:bg-hover hover:text-text"
              }`}
            />
          );
          const rowChildren = (
            <>
              <RowToggle
                on={!visible}
                label={visible ? t("layers.hide") : t("layers.show")}
                title={t("layers.eyeHint", { label: visible ? t("layers.hide") : t("layers.show") })}
                icon={visible ? "eye" : "eyeOff"}
                onClick={(event) => {
                  if (event.altKey) soloLayer(layer.id);
                  else setUnitProps(layer.id, { visible: !visible });
                }}
                persistent={!visible}
              />
              <Icon name={layerIcon(layer)} size={14} className={`shrink-0 ${layerTint(layer, isActive)}`} />
              {editingId === layer.id ? (
                <RenameInput
                  initial={layer.name}
                  label={t("layers.rename")}
                  onDone={(name) => {
                    setEditingId(null);
                    if (name !== null) renameLayer(layer.id, name);
                  }}
                />
              ) : (
                <span
                  title={t("layers.renameHint")}
                  className={`flex min-w-0 flex-1 items-baseline gap-1.5 ${visible ? "" : "text-faint line-through decoration-line-strong"}`}
                >
                  <span className="min-w-0 shrink truncate">{layer.name}</span>
                </span>
              )}
              {layer.opacity < 1 && editingId !== layer.id && (
                <span className="font-mono text-2xs text-faint tabular">{Math.round(layer.opacity * 100)}%</span>
              )}
              <RowToggle
                on={locked}
                label={locked ? t("layers.unlock") : t("layers.lock")}
                icon={locked ? "lock" : "unlock"}
                onClick={() => setUnitProps(layer.id, { locked: !locked })}
                persistent={locked}
              />
            </>
          );
          return (
            <RowContextMenu
              key={layer.id}
              render={rowElement}
              onOpen={() => setActive(layer.id)}
              items={() => layerRowItems(layer.id, [layer])}
              disabled={drag?.active === true || editingId === layer.id}
            >
              {rowChildren}
            </RowContextMenu>
          );
        })}
      </ul>
      <PointMenu at={emptyMenu} items={layersEmptyItems} onClose={() => setEmptyMenu(null)} />
    </PanelSection>
  );
}

/** Right-click menu of a layer row (the row's layer is made active first, so registry commands act on it). */
function layerRowItems(layerId: string, groupLayers: readonly TileLayer[]): ContextEntry[] {
  const doc = useEditorStore.getState().project?.store.document;
  const visible = groupLayers.some((l) => l.visible);
  const locked = groupLayers.every((l) => l.locked);
  const solo = doc ? isSolo(doc, layerId) : false;
  return [
    { type: "item", id: "rename", label: t("layers.renameMenu"), icon: "pencilLine", command: "layer.rename" },
    { type: "item", id: "duplicate", label: t("layers.duplicate"), icon: "copy", command: "layer.duplicate" },
    SEPARATOR,
    { type: "item", id: "visible", label: visible ? t("layers.hide") : t("layers.show"), icon: visible ? "eyeOff" : "eye", run: () => setUnitProps(layerId, { visible: !visible }) },
    { type: "item", id: "lock", label: locked ? t("layers.unlock") : t("layers.lock"), icon: locked ? "unlock" : "lock", run: () => setUnitProps(layerId, { locked: !locked }) },
    { type: "item", id: "solo", label: solo ? t("layers.soloOff") : t("layers.solo"), icon: "eye", run: () => soloLayer(layerId), disabled: (doc?.layers.length ?? 0) <= groupLayers.length },
    SEPARATOR,
    { type: "item", id: "moveUp", label: t("layers.moveUp"), icon: "arrowUp", command: "layer.moveUp" },
    { type: "item", id: "moveDown", label: t("layers.moveDown"), icon: "arrowDown", command: "layer.moveDown" },
    { type: "item", id: "mergeDown", label: t("layers.mergeDown"), icon: "merge", command: "layer.mergeDown" },
    SEPARATOR,
    { type: "item", id: "opacity", label: t("layers.opacityMenu"), icon: "sliders", run: requestOpacityFocus },
    { type: "item", id: "selectContent", label: t("layers.selectContent"), icon: "select", run: () => void selectLayerContent(layerId) },
    SEPARATOR,
    { type: "item", id: "delete", label: t("layers.deleteMenu"), icon: "trash", danger: true, run: () => void removeUnit(layerId), disabled: !canRemoveUnit(doc, layerId) },
  ];
}

/** Right-click on the empty part of the list: new layers. */
function layersEmptyItems(): ContextEntry[] {
  return [
    { type: "item", id: "newTile", label: t("layers.newTile"), icon: "layers", command: "layer.add", run: () => void addLayer() },
    { type: "item", id: "newCollision", label: t("layers.newCollision"), icon: "shield", command: "layer.addCollision", run: () => void addCollisionLayer() },
    { type: "item", id: "newEntity", label: t("layers.newEntity"), icon: "box", command: "layer.addEntity", run: () => void addEntityLayer() },
  ];
}

function layerIcon(layer: TileLayer): IconName {
  if (isEntityLayer(layer)) return "box";
  return isGridLayer(layer) ? "shield" : "layers";
}

/** Role colour of the row icon: full when active, dimmed otherwise; plain tile layers stay neutral until active. */
function layerTint(layer: TileLayer, active: boolean): string {
  if (isGridLayer(layer)) return active ? "text-collision-solid" : "text-collision-solid opacity-70";
  if (isEntityLayer(layer)) return active ? "text-warning" : "text-warning opacity-70";
  return active ? "text-accent" : "text-faint";
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

/** Lock / eye button: always shown (quiet), brighter when its state is "on". */
function RowToggle({
  on,
  label,
  title,
  icon,
  onClick,
  persistent,
}: {
  on: boolean;
  label: string;
  title?: string;
  icon: "lock" | "unlock" | "eye" | "eyeOff";
  onClick(event: ReactMouseEvent<HTMLButtonElement>): void;
  persistent: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      aria-pressed={on}
      onClick={onClick}
      className={`grid size-6 shrink-0 place-items-center rounded-sm transition-colors duration-100 hover:bg-hover hover:text-text ${
        persistent ? "text-text" : "text-faint group-hover:text-muted group-aria-selected:text-muted"
      }`}
    >
      <Icon name={icon} size={14} />
    </button>
  );
}

function OpacityRow({ layer }: { layer: TileLayer }) {
  const percent = Math.round(layer.opacity * 100);
  const focusToken = useLayerUi((s) => s.opacityFocus);
  const rowRef = useRef<HTMLDivElement>(null);
  // "Opaklık…" from a row menu: focus the slider (arrow keys / drag change it).
  useEffect(() => {
    if (focusToken === 0) return;
    const frame = requestAnimationFrame(() => rowRef.current?.querySelector<HTMLElement>("input, [role=slider]")?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focusToken]);
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
    <div ref={rowRef} data-layer-opacity="" className="flex h-8 shrink-0 items-center gap-3 pr-3 pl-3">
      <span className="text-sm text-muted">{t("layers.opacity")}</span>
      <span className="w-9 font-mono text-sm text-text tabular">{formatNumber(percent)}%</span>
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
    </div>
  );
}
