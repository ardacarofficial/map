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
import { KbdText } from "../primitives/Kbd";
import { keysFor } from "../../shortcuts/shortcuts";
import { SectionHeader } from "../primitives/SectionHeader";
import { menuItemClass, menuPopupClass, menuPositionerClass, menuShortcutClass } from "../primitives/menuStyles";
import { RenameInput } from "../primitives/RenameInput";
import { Tooltip } from "../primitives/Tooltip";
import { PointMenu, RowContextMenu, type MenuPoint } from "../contextMenus/RowContextMenu";
import { SEPARATOR, type ContextEntry } from "../contextMenus/contextItems";
import type { SectionPanelProps } from "../layout/RightColumn";
import { dropIndex, rowShift } from "./layerOrder";

/** Row height in px (keep in sync with `h-layerrow`). */
const ROW = 28;
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

  useEffect(() => {
    if (activeId) listRef.current?.querySelector(`[data-layer-id="${CSS.escape(activeId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

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
    <section aria-label={t("layers.title")} className="flex min-h-0 flex-auto flex-col">
      <SectionHeader
        title={t("layers.title")}
        collapsible={!!onToggleCollapsed}
        collapsed={collapsed}
        {...(onToggleCollapsed ? { onToggleCollapsed } : {})}
        actions={<>
          <AddLayerMenu />
          <Tooltip label={t("layers.remove")}>
            <IconButton size="sm" aria-label={t("layers.remove")} disabled={removeDisabled} onClick={removeActive}>
              <Icon name="trash-2" size={16} />
            </IconButton>
          </Tooltip>
          {extra}
        </>}
      />
      {!collapsed && <>
      {opacityLayer && <OpacityRow layer={opacityLayer} />}
      <ul
        ref={listRef}
        role="listbox"
        tabIndex={0}
        aria-activedescendant={activeId ? `layer-option-${activeId}` : undefined}
        onKeyDown={(event) => {
          if ((event.target as HTMLElement).closest("input, button")) return;
          const index = rows.findIndex(row => row.layer.id === activeId);
          const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : event.key === "ArrowUp" ? Math.max(0, index - 1) : event.key === "ArrowDown" ? Math.min(rows.length - 1, index + 1) : null;
          if (next !== null) {
            event.preventDefault();
            if (rows[next]) setActive(rows[next].layer.id);
          } else if (event.key === "Enter" && activeId) {
            event.preventDefault();
            startLayerRename(activeId);
          }
        }}
        aria-label={t("layers.title")}
        onContextMenu={onListContextMenu}
        data-layers-list=""
        className="relative flex min-h-0 flex-auto flex-col overflow-y-auto outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--color-accent)] px-1 pb-1"
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
              id={`layer-option-${layer.id}`}
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
              className={`group relative flex h-layerrow shrink-0 items-center gap-1.5 rounded-sm pr-1 pl-1 text-sm ${
                dragged
                  ? "z-10 cursor-grabbing bg-active"
                  : settling
                    ? ""
                    : "transition-[transform,background-color] duration-150 ease-(--ease-out)"
              } ${
                flashed
                  ? "bg-accent-soft text-text ring-1 ring-inset ring-accent-line"
                  : isActive
                    ? "bg-accent-soft text-title ring-1 ring-inset ring-accent-line"
                    : "text-text hover:bg-hover"
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
                persistent={true}
              />
              <span aria-hidden className="grid size-4 shrink-0 place-items-center">{(isEntityLayer(layer) || isGridLayer(layer)) && <Icon name={layerIcon(layer)} size={16} className="text-muted" />}</span>
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
                  className={`flex min-w-0 flex-1 items-baseline gap-1.5 ${visible ? "" : "text-muted"}`}
                >
                  <span className={`min-w-0 shrink truncate ${isActive ? "font-medium" : ""}`}>{layer.name}</span>
                </span>
              )}
              {layer.opacity < 1 && editingId !== layer.id && (
                <span className="text-xs text-faint tabular">{Math.round(layer.opacity * 100)}%</span>
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
        {drag?.active && to !== null && to !== drag.from && (
          <li aria-hidden data-layer-drop-line className="pointer-events-none absolute right-1 left-1 z-20 h-px bg-accent" style={{ top: (to > drag.from ? to + 1 : to) * ROW }} />
        )}
      </ul>
      <PointMenu at={emptyMenu} items={layersEmptyItems} onClose={() => setEmptyMenu(null)} />
    </>}
    </section>
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
  return isGridLayer(layer) ? "brick-wall" : "layers";
}

/** "+" in the layers header: tile layer or collision (exceptions) layer. */
function AddLayerMenu() {
  return (
    <Menu.Root>
      <Tooltip label={t("layers.addTile")} command="layer.add">
        <Menu.Trigger
          render={
            <IconButton aria-label={t("layers.add")} size="sm" className="data-popup-open:bg-hover data-popup-open:text-text">
              <Icon name="plus" size={16} />
            </IconButton>
          }
        />
      </Tooltip>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={4} className={menuPositionerClass}>
          <Menu.Popup className={`${menuPopupClass} min-w-64`}>
            <Menu.Item className={menuItemClass} aria-label={t("layers.addTile")} title={t("layers.addTileHint")} onClick={() => void addLayer()}>
              <Icon name="layers" size={16} className="text-muted" />
              <span className="flex-1">{t("layers.addTile")}</span>
              <KbdText keys={keysFor("layer.add")[0] ?? ""} className={menuShortcutClass} />
            </Menu.Item>
            <Menu.Item className={menuItemClass} aria-label={t("layers.addCollision")} title={t("layers.addCollisionHint")} onClick={() => void addCollisionLayer()}>
              <Icon name="brick-wall" size={16} className="text-muted" />
              <span className="flex-1">{t("layers.addCollision")}</span>
            </Menu.Item>
            <Menu.Item className={menuItemClass} aria-label={t("layers.addEntity")} title={t("layers.addEntityHint")} onClick={() => void addEntityLayer()}>
              <Icon name="box" size={16} className="text-muted" />
              <span className="flex-1">{t("layers.addEntity")}</span>
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
    <IconButton
      size="sm"
      aria-label={label}
      title={title ?? label}
      aria-pressed={on}
      onClick={onClick}
      className={persistent ? "" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}
    >
      <Icon name={icon} size={16} />
    </IconButton>
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
    <div ref={rowRef} data-layer-opacity="" className="flex h-control-md shrink-0 items-center gap-2 px-2">
      <span className="w-proplabel shrink-0 text-sm text-muted">{t("layers.opacity")}</span>
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
          <Slider.Track className="h-0.5 w-full rounded-xs bg-line-strong select-none">
            <Slider.Indicator className="bg-accent select-none" />
            <Slider.Thumb
              aria-label={t("layers.opacity")}
              className="size-3 rounded-full bg-text select-none has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
            />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
      <span className="w-9 shrink-0 text-right text-sm text-faint tabular">{t("layers.percent", { value: formatNumber(percent) })}</span>
    </div>
  );
}
