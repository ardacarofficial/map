/**
 * One palette's interactive grid, shown in the tileset dock like a
 * tileset: the slots (filled and empty) with the same selection model
 * (click, drag = rectangle, Ctrl = toggle, Shift = from the anchor, arrows),
 * Alt + drag adds to the random brush, a press on the selection drags the
 * tiles (into this or another palette: copy, Shift = move), Delete empties
 * the selected slots, Ctrl+C / Ctrl+V copy and paste tiles.
 */
import { ContextMenu } from "@base-ui/react/context-menu";
import type { Collection } from "@smap/core";
import { useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { onTilesetImage } from "../../state/tilesetImages";
import { useStructureVersion } from "../hooks";
import { Icon } from "../primitives/Icon";
import { menuItemClass, menuPopupClass, menuPositionerClass, menuSeparatorClass } from "../primitives/menuStyles";
import { GridHostContext } from "../tileset/view/gridHost";
import { CellLabel, SelectionOverlay } from "../tileset/TilesetOverlays";
import {
  arrowDelta,
  arrowSelect,
  boundsOf,
  clampCell,
  gestureIds,
  idOf,
  insideGrid,
  startGesture,
  type Cell,
  type GridSize,
  type SelectGesture,
} from "../tileset/selectionModel";
import {
  addPaletteSlotsToRandom,
  clearPaletteSlots,
  commitPaletteSelection,
  copyPaletteSlots,
  deletePalette,
  pasteIntoPalette,
  renamePalette,
} from "./paletteActions";
import { drawPalette } from "./paletteDraw";
import { itemsOfSlots, paletteRows, slotAt, slotIndex } from "./paletteModel";
import { usePaletteStore } from "./paletteStore";
import { PendingTileDrag } from "./tileDrag";

/** Key the host routes this palette's keyboard under. */
export const paletteKey = (id: string) => `palette:${id}`;

type Drag = { pointerId: number; gesture: SelectGesture; cell: Cell; alt: boolean; carry: PendingTileDrag | null; over: boolean };

const NO_EMPTY: ReadonlySet<number> = new Set();

export function PaletteGrid({ palette, scale }: { palette: Collection; scale: number }) {
  const host = useContext(GridHostContext)!;
  const store = useEditorStore((s) => s.project?.store);
  useStructureVersion(store);
  const doc = store?.document;
  const stamp = useEditorStore((s) => s.stamp);
  const randomCount = useEditorStore((s) => s.randomSet.length);
  const selection = usePaletteStore((s) => s.selection);
  const drop = usePaletteStore((s) => (s.drag?.target?.paletteId === palette.id ? s.drag : null));

  const tileW = doc?.map.tileWidth ?? 32;
  const tileH = doc?.map.tileHeight ?? 32;
  const rows = paletteRows(palette);
  const grid: GridSize = useMemo(() => ({ columns: palette.columns, rows }), [palette.columns, rows]);
  const cellW = tileW * scale;
  const cellH = tileH * scale;
  const cssW = Math.round(palette.columns * cellW);
  const cssH = Math.round(rows * cellH);

  const gridRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<Cell | null>(null);
  const [drag, setDragState] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [menuCell, setMenuCell] = useState<Cell | null>(null);
  const [imageVersion, setImageVersion] = useState(0);
  useEffect(() => onTilesetImage(() => setImageVersion((v) => v + 1)), []);

  const updateDrag = (next: Drag | null) => {
    dragRef.current = next;
    setDragState(next);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && doc) drawPalette(canvas, palette, rows, tileW, tileH, (id) => doc.getTileset(id));
  }, [palette, rows, tileW, tileH, doc, imageVersion]);

  // ---- selection

  const mine = selection?.paletteId === palette.id ? selection : null;
  // The highlight shows while the brush is still what this selection made (or it is only empty slots: a paste target).
  const live = mine !== null && (mine.clip ? mine.clip === stamp : !stamp && randomCount < 2);
  const highlighted = live ? mine.ids : [];

  const commit = (ids: readonly number[], anchor: Cell, focus: Cell) => {
    if (ids.length === 0) {
      usePaletteStore.getState().setSelection(null);
      return;
    }
    // Only empty slots: kept as a paste target, the brush stays.
    commitPaletteSelection(palette, ids, { anchor, focus });
  };

  // ---- keyboard (routed by the host)

  const keysRef = useRef<(event: KeyboardEvent) => boolean>(() => false);
  keysRef.current = (event) => {
    const ctrl = event.ctrlKey || event.metaKey;
    if (event.key === "Escape" && dragRef.current) {
      dragRef.current.carry?.cancel();
      updateDrag(null);
      return true;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && mine && mine.ids.length > 0) {
      clearPaletteSlots(palette.id, mine.ids);
      return true;
    }
    if (ctrl && event.key.toLowerCase() === "c" && !event.shiftKey && !event.altKey) {
      return mine ? copyPaletteSlots(palette, mine.ids) : false;
    }
    if (ctrl && event.key.toLowerCase() === "v" && !event.shiftKey && !event.altKey) {
      const b = mine ? boundsOf(grid, mine.ids) : null;
      pasteIntoPalette(palette.id, b ? { col: b.col, row: b.row } : null);
      return true;
    }
    const d = arrowDelta(event.key);
    if (!d || ctrl || event.altKey) return false;
    const next = arrowSelect(grid, mine ? { anchor: mine.anchor, focus: mine.focus } : null, d, event.shiftKey);
    commit(next.ids, next.anchor, next.focus);
    return true;
  };
  useEffect(() => {
    host.registerKeys(paletteKey(palette.id), (e) => keysRef.current(e));
    return () => host.registerKeys(paletteKey(palette.id), null);
  }, [host, palette.id]);

  // ---- pointer

  const rawCellAt = (x: number, y: number): Cell => {
    const r = gridRef.current?.getBoundingClientRect();
    if (!r) return { col: -1, row: -1 };
    return { col: Math.floor((x - r.left) / cellW), row: Math.floor((y - r.top) / cellH) };
  };
  const cellAt = (x: number, y: number): Cell | null => {
    const c = rawCellAt(x, y);
    return insideGrid(grid, c) ? c : null;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button === 2) {
      const c = cellAt(e.clientX, e.clientY);
      if (c) setMenuCell(c);
      return;
    }
    if (e.button !== 0 || host.panning()) return;
    const cell = cellAt(e.clientX, e.clientY);
    if (!cell) return;
    host.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    const ctrl = e.ctrlKey || e.metaKey;
    const id = idOf(grid, cell);
    let carry: PendingTileDrag | null = null;
    if (!ctrl && !e.shiftKey && !e.altKey && highlighted.includes(id) && slotAt(palette, cell.col, cell.row)) {
      const items = itemsOfSlots(palette, highlighted);
      const b = boundsOf(grid, highlighted.filter((i) => slotAt(palette, i % grid.columns, Math.floor(i / grid.columns))));
      if (items.length > 0 && b) {
        carry = new PendingTileDrag({ kind: "palette", paletteId: palette.id, ids: highlighted }, items, { col: cell.col - b.col, row: cell.row - b.row }, e.clientX, e.clientY);
      }
    }
    const gesture = e.altKey
      ? startGesture(grid, cell, { ctrl: false, shift: false }, null)
      : startGesture(grid, cell, { ctrl, shift: e.shiftKey }, mine ? { ids: mine.ids, anchor: mine.anchor } : null);
    updateDrag({ pointerId: e.pointerId, gesture, cell, alt: e.altKey, carry, over: false });
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = dragRef.current;
    if (g && g.pointerId === e.pointerId) {
      if (g.carry) {
        const over = g.carry.move(e.clientX, e.clientY, e.shiftKey);
        if (over !== g.over) updateDrag({ ...g, over });
        if (g.carry.active) return;
      }
      const c = clampCell(grid, rawCellAt(e.clientX, e.clientY));
      if (c.col !== g.cell.col || c.row !== g.cell.row) updateDrag({ ...dragRef.current!, cell: c });
    }
    const cell = cellAt(e.clientX, e.clientY);
    setHover((h) => (h?.col === cell?.col && h?.row === cell?.row ? h : cell));
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const g = dragRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    updateDrag(null);
    if (g.carry?.active) {
      g.carry.finish(e.shiftKey);
      return;
    }
    g.carry?.cancel();
    const ids = gestureIds(grid, g.gesture, g.cell);
    if (g.alt) addPaletteSlotsToRandom(palette, ids);
    else commit(ids, g.gesture.anchor, g.cell);
  };

  const onPointerCancel = () => {
    dragRef.current?.carry?.cancel();
    if (dragRef.current) updateDrag(null);
  };

  // ---- render

  const preview = useMemo(() => (drag && !drag.carry?.active ? gestureIds(grid, drag.gesture, drag.cell) : null), [drag, grid]);
  const shown = preview ?? highlighted;
  const shownBounds = preview ? boundsOf(grid, preview) : null;
  const hoverSlot = hover ? slotAt(palette, hover.col, hover.row) : undefined;
  const hoverTileset = hoverSlot ? doc?.getTileset(hoverSlot.tilesetId) : undefined;

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        render={
          <div
            ref={gridRef}
            className="relative cursor-pointer touch-none select-none"
            style={{ width: cssW, height: cssH }}
            data-palette-grid={palette.id}
            data-cell-w={cellW}
            data-cell-h={cellH}
            data-columns={palette.columns}
            data-tileset-grid={paletteKey(palette.id)}
            data-tileset-scale={scale}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onPointerLeave={() => setHover(null)}
            onContextMenu={(e) => e.preventDefault()}
          />
        }
      >
        {/* Empty slots: a faint frame each. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-xs"
          style={{
            backgroundImage:
              "linear-gradient(to right, var(--color-line) 1px, transparent 1px), linear-gradient(to bottom, var(--color-line) 1px, transparent 1px)",
            backgroundSize: `${cellW}px ${cellH}px`,
            boxShadow: "inset -1px -1px 0 var(--color-line)",
          }}
        />
        {palette.cells.map((c) => (
          <div key={`${c.x},${c.y}`} aria-hidden className="checker pointer-events-none absolute" style={{ left: c.x * cellW, top: c.y * cellH, width: cellW, height: cellH }} />
        ))}
        <canvas ref={canvasRef} aria-label={palette.name} role="img" className={`pointer-events-none absolute inset-0 block size-full ${scale >= 1 ? "pixelated" : ""}`} />
        {hover && !drag && !shown.includes(idOf(grid, hover)) && (
          <div
            aria-hidden
            className="pointer-events-none absolute outline outline-1 outline-(--color-hover-tile) shadow-[0_0_0_2px_rgb(0_0_0_/_0.6)]"
            style={{ left: hover.col * cellW, top: hover.row * cellH, width: cellW, height: cellH }}
          />
        )}
        {shown.length > 0 && (
          <SelectionOverlay tileset={grid} ids={shown} empty={NO_EMPTY} cellW={cellW} cellH={cellH} width={cssW} height={cssH} live={preview !== null} />
        )}
        {drop?.target?.slot &&
          drop.items.map((it) => {
            const col = drop.target!.slot!.col + it.dx;
            const row = drop.target!.slot!.row + it.dy;
            const out = col >= palette.columns;
            return (
              <div
                key={`${it.dx},${it.dy}`}
                aria-hidden
                data-palette-drop-preview
                className={`pointer-events-none absolute ${out ? "bg-danger/20 outline-danger" : "bg-accent-soft/30 outline-accent"}`}
                style={{
                  left: Math.min(col, palette.columns) * cellW,
                  top: row * cellH,
                  width: out ? 4 : cellW,
                  height: cellH,
                  outlineWidth: 1,
                  outlineStyle: "dashed",
                  outlineOffset: -1,
                }}
              />
            );
          })}
        {(shownBounds ? shownBounds.width * shownBounds.height > 1 : hover !== null) && !drop && (
          <CellLabel
            cell={shownBounds && drag ? drag.cell : hover!}
            cellW={cellW}
            cellH={cellH}
            width={cssW}
            rows={rows}
            text={
              shownBounds
                ? t("tilesetPanel.dragSize", { width: shownBounds.width, height: shownBounds.height })
                : hoverSlot
                  ? t("palettes.hoverSlot", { id: hoverSlot.tileId, tileset: hoverTileset?.name ?? "?" })
                  : t("palettes.hoverEmpty")
            }
          />
        )}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner className={menuPositionerClass}>
          <ContextMenu.Popup className={menuPopupClass} data-palette-menu>
            {menuCell && <SlotMenuItems palette={palette} cell={menuCell} selected={mine?.ids ?? []} />}
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function SlotMenuItems({ palette, cell, selected }: { palette: Collection; cell: Cell; selected: readonly number[] }) {
  const id = slotIndex(palette.columns, cell.col, cell.row);
  const ids = selected.includes(id) ? selected : [id];
  const filled = ids.some((i) => slotAt(palette, i % palette.columns, Math.floor(i / palette.columns)));
  const canPaste = (usePaletteStore.getState().clipboard?.length ?? 0) > 0;
  return (
    <>
      <ContextMenu.Item className={menuItemClass} disabled={!filled} data-palette-menu-item="copy" onClick={() => copyPaletteSlots(palette, ids)}>
        <Icon name="copy" size={16} className="text-muted" />
        {t("palettes.copy")}
      </ContextMenu.Item>
      <ContextMenu.Item className={menuItemClass} disabled={!canPaste} data-palette-menu-item="paste" onClick={() => pasteIntoPalette(palette.id, cell)}>
        <Icon name="clipboard" size={16} className="text-muted" />
        {t("palettes.paste")}
      </ContextMenu.Item>
      <ContextMenu.Item className={menuItemClass} disabled={!filled} data-palette-menu-item="clear" onClick={() => clearPaletteSlots(palette.id, ids)}>
        <Icon name="eraser" size={16} className="text-muted" />
        {t("palettes.clearSlots")}
      </ContextMenu.Item>
      <div role="separator" className={menuSeparatorClass} />
      <PaletteMenuItems palette={palette} />
    </>
  );
}

/** "Yeniden adlandır…" and "Paleti sil" (the palette's own menu; shared with the switcher and the library list). */
export function PaletteMenuItems({ palette }: { palette: Collection }) {
  const Item = ContextMenu.Item; // = Menu.Item: works in both menus
  return (
    <>
      <Item className={menuItemClass} data-palette-menu-item="rename" onClick={() => void renamePalette(palette.id)}>
        <Icon name="pencilLine" size={16} className="text-muted" />
        {t("palettes.renameMenu")}
      </Item>
      <Item className={`${menuItemClass} text-danger`} data-palette-menu-item="delete" onClick={() => deletePalette(palette.id)}>
        <Icon name="trash" size={16} />
        {t("palettes.delete")}
      </Item>
    </>
  );
}
