import { Menu } from "@base-ui/react/menu";
import { Slider } from "@base-ui/react/slider";
import { isGridLayer, isTileLayer, type MapDocument, type TileLayer } from "@smap/core";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { addLayer, opacityDrag, moveLayer, removeLayer, renameLayer, setLayerProps } from "../../commands/layerActions";
import { addCollisionLayer } from "../../commands/terrainActions";
import { formatNumber, t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { useStructureVersion } from "../hooks";
import { IconButton } from "../primitives/Button";
import { Icon, type IconName } from "../primitives/Icon";
import { CommandKbd } from "../primitives/Kbd";
import { menuItemClass, menuPopupClass, menuPositionerClass } from "../primitives/menuStyles";
import { RenameInput } from "../primitives/RenameInput";
import { Tooltip } from "../primitives/Tooltip";
import { displayToCore, dropIndex, rowShift } from "./layerOrder";
import { PanelSection } from "./PanelSection";

/** Row height in px (keep in sync with `h-8`). */
const ROW = 32;
/** Pointer travel before a press turns into a drag. */
const DRAG_THRESHOLD = 4;

interface Drag {
  layerId: string;
  from: number;
  startY: number;
  dy: number;
  active: boolean;
}

/**
 * Layers, top layer first: select, rename (double-click), show/hide, lock,
 * drag to reorder, opacity. Every change is a core op, so all are undoable.
 */
export function LayersPanel() {
  const store = useEditorStore((s) => s.project?.store);
  const activeId = useEditorStore((s) => s.activeLayerId);
  const setActive = useEditorStore((s) => s.setActiveLayer);
  useStructureVersion(store);
  const layers = [...(store?.document.layers ?? [])].reverse(); // top layer first
  const count = layers.length;

  const [drag, setDrag] = useState<Drag | null>(null);
  const [settling, setSettling] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const dragRef = useRef<Drag | null>(null);

  // After a drop the DOM order changes; skip the slide-back animation for one frame.
  useEffect(() => {
    if (!settling) return;
    const frame = requestAnimationFrame(() => setSettling(false));
    return () => cancelAnimationFrame(frame);
  }, [settling]);

  const to = drag?.active ? dropIndex(drag.from, drag.dy, ROW, count) : null;
  const active = layers.find((l) => l.id === activeId);

  const onPointerDown = (event: ReactPointerEvent<HTMLLIElement>, layer: TileLayer, index: number) => {
    if (event.button !== 0 || editingId === layer.id) return;
    if ((event.target as HTMLElement).closest("button, input")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const next = { layerId: layer.id, from: index, startY: event.clientY, dy: 0, active: false };
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
  const onPointerUp = (layer: TileLayer) => {
    const current = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!current) return;
    if (!current.active) {
      setActive(layer.id);
      return;
    }
    const target = dropIndex(current.from, current.dy, ROW, count);
    if (target !== current.from) {
      setSettling(true);
      moveLayer(current.layerId, displayToCore(target, count));
    }
    setActive(current.layerId);
  };
  const onPointerCancel = () => {
    dragRef.current = null;
    setDrag(null);
  };

  return (
    <PanelSection
      title={t("panels.layers")}
      className="shrink-0"
      actions={
        <>
          <AddLayerMenu />
          <Tooltip label={t("layers.remove")}>
            <IconButton
              aria-label={t("layers.remove")}
              className="size-7"
              disabled={count <= 1 || !active}
              onClick={() => active && removeLayer(active.id)}
            >
              <Icon name="trash" size={14} />
            </IconButton>
          </Tooltip>
        </>
      }
    >
      <ul
        role="listbox"
        aria-label={t("panels.layers")}
        className="relative flex max-h-[232px] flex-col overflow-y-auto px-1.5 pb-1.5"
      >
        {layers.map((layer, index) => {
          const isActive = layer.id === activeId;
          const dragged = drag?.active && drag.layerId === layer.id;
          const shift = drag?.active && to !== null ? rowShift(index, drag.from, to, ROW) : 0;
          const y = dragged ? drag.dy : shift;
          return (
            <li
              key={layer.id}
              role="option"
              aria-selected={isActive}
              data-layer-id={layer.id}
              onPointerDown={(e) => onPointerDown(e, layer, index)}
              onPointerMove={onPointerMove}
              onPointerUp={() => onPointerUp(layer)}
              onPointerCancel={onPointerCancel}
              onDoubleClick={(e) => {
                if (!(e.target as HTMLElement).closest("button")) setEditingId(layer.id);
              }}
              style={{ transform: y ? `translateY(${y}px)` : undefined }}
              className={`group relative flex h-8 shrink-0 items-center gap-1.5 rounded-md pr-1 pl-2 text-md ${
                dragged
                  ? "z-10 cursor-grabbing bg-active shadow-popup"
                  : settling
                    ? ""
                    : "transition-transform duration-150 ease-(--ease-out)"
              } ${isActive ? "bg-active text-text" : "text-muted hover:bg-hover hover:text-text"}`}
            >
              {isActive && <span aria-hidden className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-accent" />}
              <Icon
                name={layerIcon(layer)}
                size={14}
                className={`shrink-0 ${isActive ? (isGridLayer(layer) ? roleTint(layer) : "text-accent") : "text-faint"}`}
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
              ) : (
                <span
                  title={t("layers.renameHint")}
                  className={`flex min-w-0 flex-1 items-baseline gap-1.5 ${layer.visible ? "" : "text-faint line-through decoration-line-strong"}`}
                >
                  <span className="min-w-0 shrink truncate">{layer.name}</span>
                  <LayerLink doc={store!.document} layer={layer} />
                </span>
              )}
              {layer.opacity < 1 && editingId !== layer.id && (
                <span className="font-mono text-2xs text-faint tabular">{Math.round(layer.opacity * 100)}%</span>
              )}
              <RowToggle
                on={layer.locked}
                label={layer.locked ? t("layers.unlock") : t("layers.lock")}
                icon={layer.locked ? "lock" : "unlock"}
                onClick={() => setLayerProps(layer.id, { locked: !layer.locked })}
                persistent={layer.locked}
              />
              <RowToggle
                on={!layer.visible}
                label={layer.visible ? t("layers.hide") : t("layers.show")}
                icon={layer.visible ? "eye" : "eyeOff"}
                onClick={() => setLayerProps(layer.id, { visible: !layer.visible })}
                persistent={!layer.visible}
              />
            </li>
          );
        })}
      </ul>
      {active && <OpacityRow layer={active} />}
    </PanelSection>
  );
}

function layerIcon(layer: TileLayer): IconName {
  if (!isGridLayer(layer)) return "layers";
  return layer.role === "terrain" ? "terrain" : "shield";
}

function roleTint(layer: TileLayer): string {
  return isGridLayer(layer) && layer.role === "collision" ? "text-collision-solid" : "text-terrain-tint";
}

/**
 * The terrain ↔ tile layer link, as a faint note after the name:
 * a terrain layer shows "→ Çimen" (the tile layer it writes into); that tile
 * layer shows a small terrain mark ("derived").
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
