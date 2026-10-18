import { ContextMenu } from "@base-ui/react/context-menu";
import { type Tileset } from "@smap/core";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { addTilesToRandom, inRandomSet, toggleRandomTile } from "../../commands/randomBrush";
import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { onTilesetImage } from "../../state/tilesetImages";
import { useTilesetImage } from "../hooks";
import { Icon } from "../primitives/Icon";
import { AddToPaletteMenu } from "../palettes/AddToPaletteMenu";
import { copyTilesetTiles } from "../palettes/paletteActions";
import { itemsOfTiles } from "../palettes/paletteModel";
import { PendingTileDrag } from "../palettes/tileDrag";
import { menuItemClass, menuPopupClass, menuPositionerClass, menuSeparatorClass } from "../primitives/menuStyles";
import { toast } from "../toast/toastStore";
import { useUiStore } from "../uiStore";
import { useEmptyTiles } from "./emptyTiles";
import {
  arrowDelta,
  arrowSelect,
  boundsOf,
  cellOf,
  clampCell,
  gestureIds,
  idOf,
  insideGrid,
  startGesture,
  type Cell,
  type SelectGesture,
} from "./selectionModel";
import { CellLabel, drawMarks, drawTiles, SelectionOverlay } from "./TilesetOverlays";
import { commitTilesetSelection, highlightedIds } from "./tilesetSelect";
import { useTilesetView } from "./tilesetViewStore";
import { GridHostContext } from "./view/gridHost";

/** What a grid needs from the viewport around it. */
export { GridHostContext, type GridHost } from "./view/gridHost";

type Drag =
  /** `alt`: add the rectangle to the random brush; `carry`: snapshot at press, activated only outside the grid. */
  | { kind: "select"; pointerId: number; gesture: SelectGesture; cell: Cell; press: { x: number; y: number }; alt: boolean; carry: PendingTileDrag | null };

export function TilesetGrid({ tileset, scale }: { tileset: Tileset; scale: number }) {
  const host = useContext(GridHostContext)!;
  const image = useTilesetImage(tileset.id);
  const stamp = useEditorStore((s) => s.stamp);
  const selection = useEditorStore((s) => s.selection);
  const randomSet = useEditorStore((s) => s.randomSet);
  const panelSelection = useTilesetView((s) => s.selection);
  const reveal = useTilesetView((s) => s.reveal);
  const empty = useEmptyTiles(tileset, image?.bitmap);
  const [imageVersion, setImageVersion] = useState(0);
  useEffect(() => onTilesetImage((id) => id === tileset.id && setImageVersion((v) => v + 1)), [tileset.id]);

  const gridRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const marksRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<Cell | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [menuCell, setMenuCell] = useState<Cell | null>(null);
  const [visible, setVisible] = useState(!host.lazy);

  const cellW = tileset.tileWidth * scale;
  const cellH = tileset.tileHeight * scale;
  const cssW = Math.round(tileset.columns * cellW);
  const cssH = Math.round(tileset.rows * cellH);

  const updateDrag = (next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  // Stack: draw only near the viewport.
  useEffect(() => {
    const el = gridRef.current;
    if (!host.lazy || !el) return;
    const root = el.closest<HTMLElement>("[data-tileset-scroll]");
    const observer = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false), { root, rootMargin: "400px 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [host.lazy]);

  // ---- drawing

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && image && visible) drawTiles(canvas, tileset, image.bitmap);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- redraw only when the image or the grid changes
  }, [visible, image, imageVersion, tileset.tileWidth, tileset.tileHeight, tileset.margin, tileset.spacing, tileset.columns, tileset.rows]);

  useEffect(() => {
    if (marksRef.current && visible) drawMarks(marksRef.current, tileset, empty, cellW, cellH, cssW, cssH);
  }, [visible, tileset, empty, cellW, cellH, cssW, cssH, image, imageVersion]);

  // ---- hit testing

  const rawCellAt = (clientX: number, clientY: number): Cell => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return { col: -1, row: -1 };
    return { col: Math.floor((clientX - rect.left) / cellW), row: Math.floor((clientY - rect.top) / cellH) };
  };
  const cellAt = (clientX: number, clientY: number): Cell | null => {
    const c = rawCellAt(clientX, clientY);
    return insideGrid(tileset, c) ? c : null;
  };

  // The pointer stays put across a mode switch / zoom (no pointermove): re-derive the hovered tile.
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const p = pointerRef.current;
    if (!p) return;
    const next = cellAt(p.x, p.y);
    setHover((h) => (h?.col === next?.col && h?.row === next?.row ? h : next));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `cellAt` only reads the grid and scale
  }, [cellW, cellH, cssW, tileset.columns, tileset.rows]);

  // ---- selection

  const highlighted = useMemo(
    () => highlightedIds({ stamp, selection, randomSet }, panelSelection, tileset.id),
    [stamp, selection, randomSet, panelSelection, tileset.id],
  );
  const corners = useMemo((): { anchor: Cell; focus: Cell } | null => {
    if (highlighted.length === 0) return null;
    if (
      panelSelection &&
      panelSelection.tilesetId === tileset.id &&
      panelSelection.ids.length === highlighted.length &&
      panelSelection.ids.every((id, i) => id === highlighted[i])
    ) {
      return { anchor: panelSelection.anchor, focus: panelSelection.focus };
    }
    return { anchor: cellOf(tileset, highlighted[0]!), focus: cellOf(tileset, highlighted[highlighted.length - 1]!) };
  }, [highlighted, panelSelection, tileset]);

  const commit = (ids: readonly number[], anchor: Cell, focus: Cell) => {
    if (ids.length === 0) {
      const s = useEditorStore.getState();
      s.setStamp(null);
      s.setSelection(null);
      useTilesetView.getState().setSelection(null);
      return;
    }
    if (useUiStore.getState().activeTilesetId !== tileset.id) useUiStore.getState().setActiveTileset(tileset.id);
    commitTilesetSelection(tileset, ids, { anchor, focus }, empty);
  };

  const revealIds = useCallback(
    (ids: readonly number[], center: boolean) => {
      const el = gridRef.current;
      const b = boundsOf(tileset, ids);
      if (!el || !b) return;
      host.reveal(el, { left: b.col * cellW, top: b.row * cellH, right: (b.col + b.width) * cellW, bottom: (b.row + b.height) * cellH }, center);
    },
    [host, tileset, cellW, cellH],
  );

  // Map picks: scroll the picked tiles into view.
  const revealedNonce = useRef(0);
  useLayoutEffect(() => {
    if (!reveal || reveal.tilesetId !== tileset.id || revealedNonce.current === reveal.nonce || cssW === 0) return;
    revealedNonce.current = reveal.nonce;
    revealIds(reveal.ids, true);
  }, [reveal, tileset.id, cssW, revealIds]);

  // ---- random brush

  /** Alt + drag released: one cell toggles that tile (from the selected one); a rectangle adds its non-transparent tiles. */
  const finishRandomRect = (ids: readonly number[]) => {
    if (ids.length === 1) {
      toggleRandomTile({ tilesetId: tileset.id, tileId: ids[0]! });
      return;
    }
    addTilesToRandom(ids.filter((id) => !empty.has(id)).map((tileId) => ({ tilesetId: tileset.id, tileId })));
  };

  // ---- keyboard (routed here by the host)

  const keysRef = useRef<(event: KeyboardEvent) => boolean>(() => false);
  keysRef.current = (event) => {
    if (event.key === "Escape" && dragRef.current) {
      if (dragRef.current.kind === "select") dragRef.current.carry?.cancel();
      updateDrag(null);
      return true;
    }
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "c") {
      return highlighted.length > 0 && copyTilesetTiles(tileset, highlighted, empty);
    }
    const d = arrowDelta(event.key);
    if (!d || event.ctrlKey || event.metaKey || event.altKey) return false;
    const next = arrowSelect(tileset, corners, d, event.shiftKey);
    commit(next.ids, next.anchor, next.focus);
    revealIds([idOf(tileset, next.focus)], false);
    return true;
  };
  useEffect(() => {
    host.registerKeys(tileset.id, (e) => keysRef.current(e));
    return () => host.registerKeys(tileset.id, null);
  }, [host, tileset.id]);

  // ---- pointer

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.button !== 0 && e.button !== 2) || host.panning()) return;
    const cell = cellAt(e.clientX, e.clientY);
    if (!cell) return;
    if (e.button === 2) setMenuCell(cell);
    host.focus();
    const tile = { tilesetId: tileset.id, tileId: idOf(tileset, cell) };
    const action = e.button === 0 ? e.altKey ? "randomRect" : "select" : "none";
    switch (action) {
      case "none":
        return;
      case "select": {
        e.currentTarget.setPointerCapture(e.pointerId);
        const ctrl = e.ctrlKey || e.metaKey;
        const gesture = startGesture(tileset, cell, { ctrl, shift: e.shiftKey }, corners ? { ids: highlighted, anchor: corners.anchor } : null);
        let carry: PendingTileDrag | null = null;
        if (!ctrl && !e.shiftKey && highlighted.includes(tile.tileId)) {
          const items = itemsOfTiles(tileset.id, tileset.columns, highlighted, empty);
          const kept = highlighted.length > 1 ? highlighted.filter((id) => !empty.has(id)) : highlighted;
          const b = boundsOf(tileset, kept);
          if (items.length > 0 && b) carry = new PendingTileDrag({ kind: "tileset", tilesetId: tileset.id }, items, { col: cell.col - b.col, row: cell.row - b.row }, e.clientX, e.clientY);
        }
        updateDrag({ kind: "select", pointerId: e.pointerId, gesture, cell, press: { x: e.clientX, y: e.clientY }, alt: false, carry });
        return;
      }
      case "randomRect": {
        e.currentTarget.setPointerCapture(e.pointerId);
        updateDrag({ kind: "select", pointerId: e.pointerId, gesture: startGesture(tileset, cell, { ctrl: false, shift: false }, null), cell, press: { x: e.clientX, y: e.clientY }, alt: true, carry: null });
        return;
      }

    }
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    pointerRef.current = { x: e.clientX, y: e.clientY };
    const g = dragRef.current;
    if (g?.kind === "select" && g.pointerId === e.pointerId) {
      const wasActive = g.carry?.active ?? false;
      const outside = cellAt(e.clientX, e.clientY) === null;
      if (!g.alt && outside && !g.carry && g.gesture.kind === "rect") {
        const ids = gestureIds(tileset, g.gesture, g.cell);
        const items = itemsOfTiles(tileset.id, tileset.columns, ids, empty);
        const b = boundsOf(tileset, ids);
        if (items.length > 0 && b) g.carry = new PendingTileDrag(
          { kind: "tileset", tilesetId: tileset.id }, items,
          { col: g.gesture.anchor.col - b.col, row: g.gesture.anchor.row - b.row },
          g.press.x, g.press.y,
        );
      }
      // Inside the grid, even a press on a highlighted tile is a marquee.
      if (outside || wasActive) g.carry?.move(e.clientX, e.clientY, e.shiftKey);
      if (g.carry?.active) {
        // Dragging tiles out: no selection preview here.
        if (!wasActive) updateDrag({ ...g });
      } else {
        const c = clampCell(tileset, rawCellAt(e.clientX, e.clientY));
        if (c.col !== g.cell.col || c.row !== g.cell.row) updateDrag({ ...g, cell: c });
      }
    }
    const cell = cellAt(e.clientX, e.clientY);
    setHover((h) => (h?.col === cell?.col && h?.row === cell?.row ? h : cell));
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const g = dragRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    updateDrag(null);
    if (g.kind !== "select") return;
    if (g.carry?.active) {
      g.carry.finish(e.shiftKey);
      return;
    }
    g.carry?.cancel();
    const ids = gestureIds(tileset, g.gesture, g.cell);
    if (g.alt) finishRandomRect(ids);
    else commit(ids, g.gesture.anchor, g.cell);
  };

  const onPointerCancel = () => {
    const g = dragRef.current;
    if (g?.kind === "select") g.carry?.cancel();
    if (g) updateDrag(null);
  };

  // ---- render

  const preview = useMemo(
    () => (drag?.kind === "select" && !drag.carry?.active ? gestureIds(tileset, drag.gesture, drag.cell) : null),
    [drag, tileset],
  );
  const altPreview = drag?.kind === "select" && drag.alt;
  const shown = useMemo(() => (!altPreview ? (preview ?? highlighted) : []), [altPreview, preview, highlighted]);
  const shownBounds = preview ? boundsOf(tileset, preview) : null;
  const randomHere = randomSet.length >= 2 ? randomSet.filter((r) => r.tilesetId === tileset.id) : [];
  const shownSet = useMemo(() => new Set(shown), [shown]);
  const cursor = "cursor-pointer";
  const hoverId = hover ? idOf(tileset, hover) : null;

  if (!image) {
    return <div className="py-6 text-center text-sm text-faint">{t("tileset.missingImage", { path: tileset.imagePath })}</div>;
  }

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        render={
          <div
            ref={gridRef}
            className={`checker relative touch-none select-none ${cursor}`}
            style={{ width: cssW, height: cssH }}
            data-tileset-grid={tileset.id}
            data-tileset-scale={scale}
            onPointerMove={onPointerMove}
            onPointerLeave={() => {
              pointerRef.current = null;
              setHover(null);
            }}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onLostPointerCapture={(e) => {
              if (dragRef.current?.pointerId !== e.pointerId || dragRef.current.kind === "select" || dragRef.current.kind === "rough") return;
                        updateDrag(null);
            }}
            onAuxClick={(e) => e.preventDefault()}
            onContextMenu={(e) => {
              // Outside a tile (or in a mode where the right button removes): no menu, no browser menu.
              e.preventDefault();
              const c = cellAt(e.clientX, e.clientY);
              if (c) setMenuCell(c);
            }}
          />
        }
      >
        {visible && (
          <>
            <canvas
              ref={canvasRef}
              role="img"
              aria-label={t("tileset.preview")}
              className={`absolute inset-0 block size-full ${scale >= 1 ? "pixelated" : ""}`}
            />
            {cellW >= 12 && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{
                  backgroundImage:
                    "linear-gradient(to right, var(--color-tile-grid) 1px, transparent 1px), linear-gradient(to bottom, var(--color-tile-grid) 1px, transparent 1px)",
                  backgroundSize: `${cellW}px ${cellH}px`,
                }}
              />
            )}
            <canvas ref={marksRef} aria-hidden className="pointer-events-none absolute inset-0 block size-full" />
          </>
        )}
        {randomHere.map((r) => {
          const col = r.tileId % tileset.columns;
          const row = Math.floor(r.tileId / tileset.columns);
          return (
            <div
              key={r.tileId}
              aria-hidden
              data-random-tile={r.tileId}
              className="pointer-events-none absolute rounded-xs bg-accent-soft/30 outline-1 outline-accent"
              style={{ left: col * cellW, top: row * cellH, width: cellW, height: cellH, outlineStyle: "solid", outlineOffset: -1 }}
            />
          );
        })}
        {hover && hoverId !== null && !shownSet.has(hoverId) && !drag && (
          <div
            aria-hidden
            className="pointer-events-none absolute outline outline-1 outline-(--color-hover-tile) shadow-[0_0_0_2px_rgb(0_0_0_/_0.6)]"
            style={{ left: hover.col * cellW, top: hover.row * cellH, width: cellW, height: cellH }}
          />
        )}
        {shown.length > 0 && (
          <SelectionOverlay tileset={tileset} ids={shown} empty={empty} cellW={cellW} cellH={cellH} width={cssW} height={cssH} live={preview !== null} />
        )}
        {altPreview && preview && (
          <div data-random-rect className="contents">
            <SelectionOverlay tileset={tileset} ids={preview} empty={empty} cellW={cellW} cellH={cellH} width={cssW} height={cssH} live />
          </div>
        )}
        {!(drag?.kind === "select" && drag.carry?.active) && (shownBounds ? shownBounds.width * shownBounds.height > 1 : hover !== null) && (
          <CellLabel
            cell={shownBounds && drag?.kind === "select" ? drag.cell : hover!}
            cellW={cellW}
            cellH={cellH}
            width={cssW}
            rows={tileset.rows}
            text={
              shownBounds && altPreview
                ? t("randomSets.rectLabel", { count: preview!.filter((id) => !empty.has(id)).length })
                : shownBounds
                ? t("tilesetPanel.dragSize", { width: shownBounds.width, height: shownBounds.height })
                : t(empty.has(hoverId!) ? "tilesetPanel.hoverEmpty" : "tilesetPanel.hover", { id: hoverId!, col: hover!.col, row: hover!.row })
            }
          />
        )}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner className={menuPositionerClass}>
          <ContextMenu.Popup className={menuPopupClass} data-tile-menu>
            {menuCell && <TileMenuItems tileset={tileset} cell={menuCell} selected={highlighted} empty={empty} />}
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function TileMenuItems({
  tileset,
  cell,
  selected,
  empty,
}: {
  tileset: Tileset;
  cell: Cell;
  selected: readonly number[];
  empty: ReadonlySet<number>;
}) {
  const tileId = idOf(tileset, cell);
  const paletteItems = itemsOfTiles(tileset.id, tileset.columns, selected.includes(tileId) ? selected : [tileId], empty);
  const tile = { tilesetId: tileset.id, tileId };
  const inRandom = inRandomSet(useEditorStore.getState().randomSet, tile);
  const copy = () => {
    const text = String(tileId);
    const done = () => toast.success(t("tilesetLib.tileIdCopied", { id: tileId }));
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => toast.error(t("tilesetLib.copyFailed")));
    else toast.error(t("tilesetLib.copyFailed"));
  };
  return (
    <>
      <div className="px-2 pt-1 pb-1.5 font-mono text-2xs text-faint tabular">{t("tilesetPanel.hover", { id: tileId, col: cell.col, row: cell.row })}</div>
      <AddToPaletteMenu items={paletteItems} />
      <ContextMenu.Item className={menuItemClass} data-tile-menu-item="random" onClick={() => toggleRandomTile(tile)}>
        <Icon name="dice" size={16} className="text-accent" />
        {inRandom ? t("tilesetLib.menuRandomRemove") : t("tilesetLib.menuRandomAdd")}
      </ContextMenu.Item>
      <div role="separator" className={menuSeparatorClass} />

      <div role="separator" className={menuSeparatorClass} />
      <ContextMenu.Item className={menuItemClass} data-tile-menu-item="copy" onClick={copy}>
        <Icon name="copy" size={16} className="text-muted" />
        {t("tilesetLib.menuCopyId")}
      </ContextMenu.Item>
    </>
  );
}
