/**
 * One tileset's interactive grid: the image, its marks and overlays, and
 * what the mouse does in each mode (see `modeModel.ts`: left adds /
 * selects, right removes). In Seç, Alt + drag adds a rectangle to the
 * random brush, and a press on the selection drags its tiles into a
 * palette (copy; Shift = move only applies between palettes); Ctrl+C copies
 * the selection for a paste into a palette. Shared by the single view and the "Tümü" stack;
 * the host (the scroll viewport) owns zoom, panning and keyboard routing,
 * and hands them down through {@link GridHostContext}.
 *
 * Arazi mode: a drag is a ROUGH rectangle over a terrain block; the
 * program finds the template and origin (`terrainDraft.startDraft`) and the
 * Denetçi's ARAZİ card takes it from there. The found block is outlined and
 * the tags of the set in focus are drawn on the tiles; with "Düzelt" a click
 * tags the corner / zone under the pointer.
 *
 * In the stack, a grid far outside the viewport keeps its size but draws
 * nothing (IntersectionObserver), so a long library stays cheap.
 */
import { ContextMenu } from "@base-ui/react/context-menu";
import { getTerrainSet, isTileSolid, terrainTemplateInfo, type TerrainSet, type Tileset } from "@smap/core";
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
import { SolidStroke } from "../../commands/solidStroke";
import { setTilesSolid, toggleTerrainTag } from "../../commands/terrainActions";
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
import { clearTerrainDraft, roughRect, startDraft, useTerrainDraft } from "../terrain/terrainDraft";
import { resolveTerrain, zoneAt, type TagZone } from "../terrain/terrainModel";
import { TagZoneHover, TerrainTagOverlay } from "../terrain/TerrainTagOverlay";
import { toast } from "../toast/toastStore";
import { useUiStore } from "../uiStore";
import { useEmptyTiles } from "./emptyTiles";
import { contextMenuEnabled, isStroke, tilePointerAction } from "./modeModel";
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
import { BlockGhost, CellLabel, drawMarks, drawTiles, SelectionOverlay } from "./TilesetOverlays";
import { commitTilesetSelection, highlightedIds } from "./tilesetSelect";
import { useTilesetView } from "./tilesetViewStore";
import { GridHostContext } from "./view/gridHost";

/** What a grid needs from the viewport around it. */
export { GridHostContext, type GridHost } from "./view/gridHost";

/** "Arazi başlat buradan": Arazi mode with the block around `cell` found (or why nothing was found). */
export function startTerrainAt(tileset: Tileset, cell: Cell): void {
  useUiStore.getState().setTilesetMode("terrain");
  if (!startDraft(tileset, { col: cell.col, row: cell.row, columns: 1, rows: 1 })) toast.warning(t("terrain.noCandidate"));
}

/** The terrain set whose tags the grid shows in Arazi mode: the fix target's, the draft's, the brush's, else the tileset's first. */
function focusSet(tileset: Tileset, fixSet: string | null, draftSet: string | null, brushSet: string | null): TerrainSet | undefined {
  for (const id of [fixSet, draftSet, brushSet]) {
    const set = id ? getTerrainSet(tileset, id) : undefined;
    if (set) return set;
  }
  return tileset.terrainSets?.[0];
}

type Drag =
  /** `alt`: the rectangle goes to the random brush; `carry`: a press on the selection that may drag its tiles into a palette. */
  | { kind: "select"; pointerId: number; gesture: SelectGesture; cell: Cell; alt: boolean; carry: PendingTileDrag | null }
  | { kind: "solid"; pointerId: number }
  /** Arazi: a rough rectangle over a terrain block. */
  | { kind: "rough"; pointerId: number; start: Cell; cell: Cell };

export function TilesetGrid({ tileset, scale }: { tileset: Tileset; scale: number }) {
  const host = useContext(GridHostContext)!;
  const image = useTilesetImage(tileset.id);
  const store = useEditorStore((s) => s.project?.store);
  const stamp = useEditorStore((s) => s.stamp);
  const selection = useEditorStore((s) => s.selection);
  const randomSet = useEditorStore((s) => s.randomSet);
  const panelSelection = useTilesetView((s) => s.selection);
  const reveal = useTilesetView((s) => s.reveal);
  const mode = useUiStore((s) => s.tilesetMode);
  const draft = useTerrainDraft((s) => (s.draft?.tilesetId === tileset.id ? s.draft : null));
  const fixRef = useTerrainDraft((s) => (s.fix?.tilesetId === tileset.id ? s.fix : null));
  const brushTerrain = useEditorStore((s) => (s.terrain?.tilesetId === tileset.id ? s.terrain : null));
  const empty = useEmptyTiles(tileset, image?.bitmap);
  const [imageVersion, setImageVersion] = useState(0);
  useEffect(() => onTilesetImage((id) => id === tileset.id && setImageVersion((v) => v + 1)), [tileset.id]);

  const gridRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const marksRef = useRef<HTMLCanvasElement>(null);
  const strokeRef = useRef<SolidStroke | null>(null);
  const [hover, setHover] = useState<Cell | null>(null);
  const [hoverZone, setHoverZone] = useState<TagZone | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [menuCell, setMenuCell] = useState<Cell | null>(null);
  const [visible, setVisible] = useState(!host.lazy);

  const cellW = tileset.tileWidth * scale;
  const cellH = tileset.tileHeight * scale;
  const cssW = Math.round(tileset.columns * cellW);
  const cssH = Math.round(tileset.rows * cellH);

  const fix = mode === "terrain" && fixRef && resolveTerrain(store?.document, fixRef) ? fixRef : null;
  const tagSet = mode === "terrain" ? focusSet(tileset, fix?.setId ?? null, draft?.setId ?? null, brushTerrain?.setId ?? null) : undefined;

  const updateDrag = (next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  useEffect(() => () => strokeRef.current?.end(), []);

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
    if (marksRef.current && visible) drawMarks(marksRef.current, tileset, empty, cellW, cellH, cssW, cssH, mode === "solid");
  }, [visible, tileset, empty, cellW, cellH, cssW, cssH, mode, image, imageVersion]);

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
  }, [mode, cellW, cellH, cssW, tileset.columns, tileset.rows]);

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
    if (event.key === "Escape" && !dragRef.current && mode === "terrain" && (draft || fix)) {
      clearTerrainDraft();
      return true;
    }
    if (event.key === "Escape" && dragRef.current) {
      strokeRef.current?.end();
      strokeRef.current = null;
      if (dragRef.current.kind === "select") dragRef.current.carry?.cancel();
      updateDrag(null);
      return true;
    }
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "c" && mode === "pick") {
      return highlighted.length > 0 && copyTilesetTiles(tileset, highlighted, empty);
    }
    const d = arrowDelta(event.key);
    if (!d || event.ctrlKey || event.metaKey || event.altKey || mode !== "pick") return false;
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
    const action = tilePointerAction(mode, {
      button: e.button,
      alt: e.altKey,
      draft: draft !== null,
      fixing: fix !== null,
    });
    if (isStroke(action)) e.currentTarget.setPointerCapture(e.pointerId);
    switch (action.kind) {
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
        updateDrag({ kind: "select", pointerId: e.pointerId, gesture, cell, alt: false, carry });
        return;
      }
      case "randomRect": {
        e.currentTarget.setPointerCapture(e.pointerId);
        updateDrag({ kind: "select", pointerId: e.pointerId, gesture: startGesture(tileset, cell, { ctrl: false, shift: false }, null), cell, alt: true, carry: null });
        return;
      }
      case "solid":
        if (!store || store.inTransaction || !store.document.getTileset(tileset.id)) return;
        strokeRef.current = new SolidStroke(store, tileset.id, cell.col, cell.row, action.solid);
        updateDrag({ kind: "solid", pointerId: e.pointerId });
        return;
      case "roughRect":
        e.currentTarget.setPointerCapture(e.pointerId);
        updateDrag({ kind: "rough", pointerId: e.pointerId, start: cell, cell });
        return;
      case "tagTile":
        if (fix) toggleTerrainTag(fix, idOf(tileset, cell), zoneAt(tagSet?.kind ?? "corner", ...fractionIn(e.clientX, e.clientY, cell)));
        return;
      case "cancelDraft":
        clearTerrainDraft();
        return;
    }
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    pointerRef.current = { x: e.clientX, y: e.clientY };
    const g = dragRef.current;
    if (g?.kind === "solid" && g.pointerId === e.pointerId && strokeRef.current) {
      const c = rawCellAt(e.clientX, e.clientY);
      strokeRef.current.moveTo(c.col, c.row);
    } else if (g?.kind === "rough" && g.pointerId === e.pointerId) {
      const c = clampCell(tileset, rawCellAt(e.clientX, e.clientY));
      if (c.col !== g.cell.col || c.row !== g.cell.row) updateDrag({ ...g, cell: c });
    } else if (g?.kind === "select" && g.pointerId === e.pointerId) {
      const wasActive = g.carry?.active ?? false;
      g.carry?.move(e.clientX, e.clientY, e.shiftKey);
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
    if (fix && cell) {
      const z = zoneAt(tagSet?.kind ?? "corner", ...fractionIn(e.clientX, e.clientY, cell));
      setHoverZone((prev) => (prev && JSON.stringify(prev) === JSON.stringify(z) ? prev : z));
    } else setHoverZone(null);
  };

  /** Pointer position inside tile `cell` as fractions (0..1). */
  const fractionIn = (clientX: number, clientY: number, cell: Cell): [number, number] => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return [0.5, 0.5];
    return [(clientX - rect.left) / cellW - cell.col, (clientY - rect.top) / cellH - cell.row];
  };

  const endStroke = () => {
    strokeRef.current?.end();
    strokeRef.current = null;
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const g = dragRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    endStroke();
    updateDrag(null);
    if (g.kind === "rough") {
      if (!startDraft(tileset, roughRect(g.start, g.cell))) toast.warning(t("terrain.noCandidate"));
      return;
    }
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
    endStroke();
    const g = dragRef.current;
    if (g?.kind === "select") g.carry?.cancel();
    if (g) updateDrag(null);
  };

  // ---- render

  const candidate = mode === "terrain" && draft ? (draft.candidates[draft.index] ?? null) : null;
  const candidateInfo = candidate ? terrainTemplateInfo(candidate.template) : null;
  const rough = drag?.kind === "rough" ? roughRect(drag.start, drag.cell) : null;
  const preview = useMemo(
    () => (drag?.kind === "select" && !drag.carry?.active ? gestureIds(tileset, drag.gesture, drag.cell) : null),
    [drag, tileset],
  );
  const picking = mode === "pick" || mode === "random";
  const altPreview = drag?.kind === "select" && drag.alt;
  const shown = useMemo(() => (picking && !altPreview ? (preview ?? highlighted) : []), [picking, altPreview, preview, highlighted]);
  const shownBounds = preview ? boundsOf(tileset, preview) : null;
  const randomHere = randomSet.length >= 2 ? randomSet.filter((r) => r.tilesetId === tileset.id) : [];
  const shownSet = useMemo(() => new Set(shown), [shown]);
  const cursor = picking ? "cursor-pointer" : "cursor-crosshair";
  const hoverId = hover ? idOf(tileset, hover) : null;

  if (!image) {
    return <div className="py-6 text-center text-sm text-faint">{t("tileset.missingImage", { path: tileset.imagePath })}</div>;
  }

  return (
    <ContextMenu.Root disabled={!contextMenuEnabled(mode)}>
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
              endStroke();
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
        {visible && tagSet && (
          <TerrainTagOverlay
            tileset={tileset}
            set={tagSet}
            cellW={cellW}
            cellH={cellH}
            width={cssW}
            height={cssH}
            focusTerrain={fix?.terrainId ?? (brushTerrain?.setId === tagSet.id ? brushTerrain.terrainId : null)}
          />
        )}
        {randomHere.map((r) => {
          const col = r.tileId % tileset.columns;
          const row = Math.floor(r.tileId / tileset.columns);
          return (
            <div
              key={r.tileId}
              aria-hidden
              data-random-tile={r.tileId}
              className="pointer-events-none absolute rounded-xs outline-1 outline-accent"
              style={{ left: col * cellW, top: row * cellH, width: cellW, height: cellH, outlineStyle: "solid", outlineOffset: -1 }}
            >
              {cellW >= 14 && (
                <span className="absolute -top-1 -right-1 grid size-4 place-items-center rounded-sm bg-popup text-accent">
                  <Icon name="dice" size={16} />
                </span>
              )}
            </div>
          );
        })}
        {picking && hover && hoverId !== null && !shownSet.has(hoverId) && !drag && (
          <div
            aria-hidden
            className="pointer-events-none absolute outline outline-1 outline-(--color-hover-tile) shadow-[0_0_0_2px_rgb(0_0_0_/_0.6)]"
            style={{ left: hover.col * cellW, top: hover.row * cellH, width: cellW, height: cellH }}
          />
        )}
        {mode === "solid" && hover && (
          <div
            aria-hidden
            className={`pointer-events-none absolute outline-1 outline-collision-solid ${
              isTileSolid(tileset, hover.row * tileset.columns + hover.col) ? "" : "bg-collision-solid/20"
            }`}
            style={{ left: hover.col * cellW, top: hover.row * cellH, width: cellW, height: cellH, outlineStyle: "solid", outlineOffset: -1 }}
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
        {candidate && candidateInfo && (
          <div data-terrain-candidate={candidate.template} data-terrain-origin={`${candidate.origin.col},${candidate.origin.row}`} className="contents">
            <BlockGhost
              template={candidate.template}
              left={candidate.origin.col * cellW}
              top={candidate.origin.row * cellH}
              cellW={cellW}
              cellH={cellH}
              invalid={false}
              pinned
              columns={candidateInfo.columns}
              rows={candidateInfo.rows}
            />
          </div>
        )}
        {rough && (
          <div
            aria-hidden
            data-terrain-rough=""
            className="pointer-events-none absolute bg-accent-soft/30 outline-1 outline-accent"
            style={{ left: rough.col * cellW, top: rough.row * cellH, width: rough.columns * cellW, height: rough.rows * cellH, outlineStyle: "dashed", outlineOffset: -1 }}
          />
        )}
        {fix && hover && hoverZone && (
          <TagZoneHover zone={hoverZone} col={hover.col} row={hover.row} cellW={cellW} cellH={cellH} color={resolveTerrain(store?.document, fix)?.terrain.color ?? "var(--color-text)"} />
        )}
        {picking && !(drag?.kind === "select" && drag.carry?.active) && (shownBounds ? shownBounds.width * shownBounds.height > 1 : hover !== null) && (
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

/** Context menu of a tile (Seç mode): add to a palette, random brush, solid, terrain from here, copy the tile number. */
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
  const solid = isTileSolid(tileset, tileId);
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
      <ContextMenu.Item className={menuItemClass} data-tile-menu-item="solid" onClick={() => setTilesSolid(tileset.id, [tileId], !solid)}>
        <Icon name="bricks" size={16} className="text-collision-solid" />
        {solid ? t("tilesetLib.menuUnsolid") : t("tilesetLib.menuSolid")}
      </ContextMenu.Item>
      <ContextMenu.Item className={menuItemClass} data-tile-menu-item="terrain" onClick={() => startTerrainAt(tileset, cell)}>
        <Icon name="terrain" size={16} className="text-accent" />
        {t("tilesetLib.menuTerrain")}
      </ContextMenu.Item>
      <div role="separator" className={menuSeparatorClass} />
      <ContextMenu.Item className={menuItemClass} data-tile-menu-item="copy" onClick={copy}>
        <Icon name="copy" size={16} className="text-muted" />
        {t("tilesetLib.menuCopyId")}
      </ContextMenu.Item>
    </>
  );
}
