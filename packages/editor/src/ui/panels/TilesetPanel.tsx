import { isTileSolid, terrainTemplateInfo, tileRect, type TerrainTemplate, type Tileset } from "@smap/core";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import { inRandomSet, toggleInSet, toggleRandomTile } from "../../commands/randomBrush";
import { SolidStroke } from "../../commands/solidStroke";
import { terrainBlockProblem } from "../../commands/terrainActions";
import { openTilesetImport } from "../../commands/tilesetActions";
import { t } from "../../i18n";
import { useEditorStore, type TileSelection } from "../../state/editorStore";
import { onTilesetImage } from "../../state/tilesetImages";
import { useStructureVersion, useTilesetImage } from "../hooks";
import { Button, IconButton } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { Tooltip } from "../primitives/Tooltip";
import { TerrainDefineBar } from "../terrain/TerrainDefineBar";
import { TerrainSets, useActiveTerrainId } from "../terrain/TerrainList";
import { templateGlyphs } from "../terrain/templateGlyph";
import { useEmptyTiles } from "../tileset/emptyTiles";
import { ModeTabs } from "../tileset/ModeTabs";
import { registerSelectionSection } from "../tileset/SelectionSection";
import {
  arrowDelta,
  arrowSelect,
  boundsOf,
  cellOf,
  clampCell,
  gestureIds,
  idOf,
  insideGrid,
  outlinePath,
  startGesture,
  type Cell,
  type SelectGesture,
} from "../tileset/selectionModel";
import { commitTilesetSelection, highlightedIds, installTilesetPickSync } from "../tileset/tilesetSelect";
import { TilesetSwitcher } from "../tileset/TilesetSwitcher";
import { useTilesetView } from "../tileset/tilesetViewStore";
import { anchoredScroll, fitScale, stepZoom, wheelIntent, zoomLabel } from "../tileset/zoomModel";
import { useUiStore } from "../uiStore";
import { widenLibraryTarget } from "../layout/columns";
import { useLayoutStore, wantedLibraryWidth } from "../layout/layoutStore";
import { LibraryTabs } from "./LibraryPanel";
import { PanelSection } from "./PanelSection";

// Map picks reveal their tiles here, and the inspector shows the selection, even while another library tab is open.
installTilesetPickSync();
registerSelectionSection();

/** Space around the tileset inside the scroll area (CSS px). */
const PADDING = 10;
/** Wheel delta (px) per zoom step; a mouse notch is ~100, trackpads send many small deltas. */
const WHEEL_STEP = 40;

type TileCell = Cell;

export function TilesetPanel() {
  const store = useEditorStore((s) => s.project?.store);
  const activeId = useUiStore((s) => s.activeTilesetId);
  const setActive = useUiStore((s) => s.setActiveTileset);
  useStructureVersion(store);
  const tilesets = store?.document.tilesets ?? [];
  const active = tilesets.find((ts) => ts.id === activeId) ?? tilesets[0];

  return (
    <PanelSection
      title={t("panels.tileset")}
      heading={<LibraryTabs />}
      className="min-h-0 flex-1"
      actions={
        <Tooltip label={t("tileset.add")}>
          <IconButton aria-label={t("tileset.add")} className="size-7" data-tileset-add onClick={() => void openTilesetImport()}>
            <Icon name="plus" size={15} />
          </IconButton>
        </Tooltip>
      }
    >
      {active ? (
        <>
          <TilesetSwitcher tilesets={tilesets} active={active} onSelect={setActive} />
          <TilesetView key={active.id} tileset={active} />
        </>
      ) : (
        <EmptyTilesets />
      )}
    </PanelSection>
  );
}

function EmptyTilesets() {
  return (
    <button
      type="button"
      onClick={() => void openTilesetImport()}
      className="mx-3 mb-3 flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong px-4 text-center transition-colors hover:border-accent-line hover:bg-accent-soft/40"
    >
      <Icon name="image" size={22} className="text-faint" />
      <span className="text-md text-muted">{t("tileset.empty")}</span>
      <span className="text-xs text-faint">{t("tileset.emptyHint")}</span>
    </button>
  );
}

/** `#rrggbb` CSS variable → `[r, g, b]`. */
function cssColor(name: string, fallback: [number, number, number]): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
  if (!m) return fallback;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Largest overlay canvas side in device px (very large tilesets at high zoom draw the marks at lower resolution). */
const MAX_OVERLAY_PX = 8192;

/**
 * Marks on top of the tileset image: fully transparent tiles dimmed, solid
 * tiles. In "Katı işaretle" mode solid tiles are tinted, hatched and
 * outlined; otherwise a small corner mark keeps the state visible without
 * getting in the way.
 */
function drawMarks(
  canvas: HTMLCanvasElement,
  tileset: Tileset,
  empty: ReadonlySet<number>,
  cellW: number,
  cellH: number,
  cssW: number,
  cssH: number,
  marking: boolean,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const solid = tileset.solidTiles ?? [];
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_OVERLAY_PX / Math.max(1, cssW), MAX_OVERLAY_PX / Math.max(1, cssH));
  const nothing = solid.length === 0 && empty.size === 0;
  canvas.width = nothing ? 1 : Math.max(1, Math.round(cssW * dpr));
  canvas.height = nothing ? 1 : Math.max(1, Math.round(cssH * dpr));
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (nothing) return;
  const cw = cellW * dpr;
  const ch = cellH * dpr;
  const box = (id: number) => {
    const col = id % tileset.columns;
    const row = Math.floor(id / tileset.columns);
    const x0 = Math.round(col * cw);
    const y0 = Math.round(row * ch);
    return { x0, y0, x1: Math.round((col + 1) * cw), y1: Math.round((row + 1) * ch) };
  };
  if (empty.size > 0) {
    const [r, g, b] = cssColor("--color-bg", [20, 20, 22]);
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.62)`;
    for (const id of empty) {
      const { x0, y0, x1, y1 } = box(id);
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
  }
  if (solid.length === 0) return;
  const [r, g, b] = cssColor("--color-collision-solid", [255, 84, 104]);
  const rgba = (a: number) => `rgba(${r}, ${g}, ${b}, ${a})`;
  if (!marking && Math.min(cellW, cellH) < 10) return;
  for (const id of solid) {
    const { x0, y0, x1, y1 } = box(id);
    const w = x1 - x0;
    const h = y1 - y0;
    if (marking) {
      ctx.fillStyle = rgba(0.24);
      ctx.fillRect(x0, y0, w, h);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, w, h);
      ctx.clip();
      ctx.strokeStyle = rgba(0.75);
      ctx.lineWidth = Math.max(1, Math.round(dpr));
      const step = Math.max(4, Math.round(6 * dpr));
      ctx.beginPath();
      for (let d = -h; d < w; d += step) {
        ctx.moveTo(x0 + d, y1);
        ctx.lineTo(x0 + d + h, y0);
      }
      ctx.stroke();
      ctx.restore();
      const line = Math.max(1, Math.round(1.5 * dpr));
      ctx.strokeStyle = rgba(1);
      ctx.lineWidth = line;
      ctx.strokeRect(x0 + line / 2, y0 + line / 2, w - line, h - line);
    } else {
      const s = Math.round(Math.max(4, Math.min(cellW, cellH) * 0.26) * dpr);
      ctx.beginPath();
      ctx.moveTo(x1 - s, y0);
      ctx.lineTo(x1, y0);
      ctx.lineTo(x1, y0 + s);
      ctx.closePath();
      ctx.fillStyle = rgba(1);
      ctx.fill();
      ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
      ctx.lineWidth = Math.max(1, Math.round(dpr));
      ctx.beginPath();
      ctx.moveTo(x1 - s, y0);
      ctx.lineTo(x1, y0 + s);
      ctx.stroke();
    }
  }
}

/** The tileset's tiles side by side at 1 tile pixel = 1 canvas pixel (margin and spacing cut away); CSS scales it up crisply. */
function drawTiles(canvas: HTMLCanvasElement, tileset: Tileset, bitmap: ImageBitmap): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { tileWidth: tw, tileHeight: th, columns, rows } = tileset;
  canvas.width = Math.max(1, columns * tw);
  canvas.height = Math.max(1, rows * th);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (tileset.margin === 0 && tileset.spacing === 0) {
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    return;
  }
  for (let id = 0; id < columns * rows; id++) {
    const r = tileRect(tileset, id);
    ctx.drawImage(bitmap, r.x, r.y, r.width, r.height, (id % columns) * tw, Math.floor(id / columns) * th, tw, th);
  }
}

/** An in-progress drag in the tileset. */
type Drag =
  | { kind: "select"; pointerId: number; gesture: SelectGesture; cell: TileCell }
  | { kind: "random"; pointerId: number; adding: boolean; visited: Set<number> }
  | { kind: "pan"; pointerId: number; x: number; y: number; left: number; top: number };

function TilesetView({ tileset }: { tileset: Tileset }) {
  const image = useTilesetImage(tileset.id);
  const store = useEditorStore((s) => s.project?.store);
  const stamp = useEditorStore((s) => s.stamp);
  const selection = useEditorStore((s) => s.selection);
  const randomSet = useEditorStore((s) => s.randomSet);
  const panelSelection = useTilesetView((s) => s.selection);
  const storedZoom = useTilesetView((s) => s.zoom[tileset.id] ?? null);
  const setStoredZoom = useTilesetView((s) => s.setZoom);
  const reveal = useTilesetView((s) => s.reveal);
  const mode = useUiStore((s) => s.tilesetMode);
  const setMode = useUiStore((s) => s.setTilesetMode);
  const template = useUiStore((s) => s.terrainTemplate);
  const activeTerrainId = useActiveTerrainId();
  const empty = useEmptyTiles(tileset, image?.bitmap);
  // Redraw when the image is re-registered or its grid is re-cut (`notifyTilesetImage` after a settings change).
  const [imageVersion, setImageVersion] = useState(0);
  useEffect(() => onTilesetImage((id) => id === tileset.id && setImageVersion((v) => v + 1)), [tileset.id]);

  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const marksRef = useRef<HTMLCanvasElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const strokeRef = useRef<SolidStroke | null>(null);
  const [availWidth, setAvailWidth] = useState(0);
  const [hover, setHover] = useState<TileCell | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  /** Terrain block placed with a click, waiting for its name. */
  const [pending, setPending] = useState<TileCell | null>(null);
  /** A tile was picked in this "Rastgele" session (the first click starts a fresh set, without the old selection). */
  const randomSessionRef = useRef(false);

  const contentW = tileset.columns * tileset.tileWidth;
  const fit = fitScale(availWidth, contentW, tileset.tileWidth);
  const scale = storedZoom ?? fit;
  const cellW = tileset.tileWidth * scale;
  const cellH = tileset.tileHeight * scale;
  const cssW = Math.round(tileset.columns * cellW);
  const cssH = Math.round(tileset.rows * cellH);
  const offsetX = Math.max(0, Math.floor((availWidth - cssW) / 2));

  const updateDrag = (next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  // A placed block belongs to one mode / template; a random session to one visit of the mode.
  useEffect(() => setPending(null), [mode, template]);
  useEffect(() => {
    randomSessionRef.current = false;
  }, [mode]);
  // A stroke never outlives the view.
  useEffect(() => () => strokeRef.current?.end(), []);

  // Track the panel width for zoom-to-fit.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setAvailWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ---- smart widen: a tileset wider than the panel at 1× (e.g. 12 columns) would show shrunk and blurry.
  // Once per tileset, grow the library so it fits at 1× (never after the user resized the panel by hand);
  // otherwise the footer offers it.
  const widenExtra = storedZoom === null && availWidth > 0 && contentW > availWidth ? contentW - availWidth : 0;
  useEffect(() => {
    if (widenExtra > 0) useLayoutStore.getState().widenLibrary(widenExtra, tileset.id);
  }, [tileset.id, widenExtra]);
  const canWiden = useLayoutStore(
    (s) => widenExtra > 0 && widenLibraryTarget(window.innerWidth, { library: wantedLibraryWidth(s, window.innerWidth), right: s.rightWidth }, widenExtra) !== null,
  );

  // ---- zoom

  const layoutRef = useRef({ scale, cssW, availWidth });
  layoutRef.current = { scale, cssW, availWidth };
  /** Scroll position to apply once the new zoom is laid out. */
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);

  /** Zooms to `next` keeping the content point under (`clientX`, `clientY`) in place (default: viewport centre). */
  const zoomTo = useCallback(
    (next: number | null, clientX?: number, clientY?: number) => {
      const vp = viewportRef.current;
      const grid = gridRef.current;
      const cur = layoutRef.current;
      const nextScale = next ?? fitScale(cur.availWidth, contentW, tileset.tileWidth);
      if (vp && grid && Math.abs(nextScale - cur.scale) > 1e-6) {
        const v = vp.getBoundingClientRect();
        const g = grid.getBoundingClientRect();
        const px = (clientX ?? v.left + v.width / 2) - v.left;
        const py = (clientY ?? v.top + v.height / 2) - v.top;
        const nextW = Math.round(tileset.columns * tileset.tileWidth * nextScale);
        const baseX = PADDING + Math.max(0, Math.floor((cur.availWidth - nextW) / 2));
        pendingScroll.current = {
          left: anchoredScroll(px, g.left - v.left, cur.scale, nextScale, baseX),
          top: anchoredScroll(py, g.top - v.top, cur.scale, nextScale, PADDING),
        };
      }
      setStoredZoom(tileset.id, next);
    },
    [contentW, setStoredZoom, tileset.columns, tileset.id, tileset.tileWidth],
  );

  useLayoutEffect(() => {
    const p = pendingScroll.current;
    const vp = viewportRef.current;
    if (!p || !vp) return;
    pendingScroll.current = null;
    vp.scrollLeft = p.left;
    vp.scrollTop = p.top;
  }, [scale]);

  // Wheel scrolls (tall tilesets), Shift + wheel scrolls sideways, Ctrl / Cmd + wheel zooms at
  // the cursor (trackpad pinch arrives as Ctrl + wheel). Native listener: React wheel handlers are passive.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    let acc = 0;
    const onWheel = (event: WheelEvent) => {
      const intent = wheelIntent(event);
      if (intent === "native") return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      if (intent === "scroll-x") {
        el.scrollLeft += (event.deltaY || event.deltaX) * unit;
        return;
      }
      acc += event.deltaY * unit;
      if (Math.abs(acc) < WHEEL_STEP) return;
      const direction = acc < 0 ? 1 : -1;
      acc = 0;
      const next = stepZoom(layoutRef.current.scale, direction);
      if (Math.abs(next - layoutRef.current.scale) > 1e-6) zoomTo(next, event.clientX, event.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomTo]);

  // ---- drawing

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && image) drawTiles(canvas, tileset, image.bitmap);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- redraw only when the image or the grid changes
  }, [image, imageVersion, tileset.tileWidth, tileset.tileHeight, tileset.margin, tileset.spacing, tileset.columns, tileset.rows]);

  useEffect(() => {
    if (marksRef.current) drawMarks(marksRef.current, tileset, empty, cellW, cellH, cssW, cssH, mode === "solid");
  }, [tileset, empty, cellW, cellH, cssW, cssH, mode, image, imageVersion]);

  // ---- hit testing

  /** Tile under the pointer, not clamped (may be outside the tileset). */
  const rawCellAt = (clientX: number, clientY: number): TileCell => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return { col: -1, row: -1 };
    return { col: Math.floor((clientX - rect.left) / cellW), row: Math.floor((clientY - rect.top) / cellH) };
  };
  const cellAt = (clientX: number, clientY: number): TileCell | null => {
    const c = rawCellAt(clientX, clientY);
    return insideGrid(tileset, c) ? c : null;
  };

  // The pointer stays over the canvas across a mode switch / zoom (no pointermove arrives):
  // re-derive the hovered tile from the last known pointer position.
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const p = pointerRef.current;
    if (!p) return;
    const next = cellAt(p.x, p.y);
    setHover((h) => (h?.col === next?.col && h?.row === next?.row ? h : next));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `cellAt` only reads the grid and scale
  }, [mode, template, cellW, cellH, cssW, tileset.columns, tileset.rows]);

  // ---- selection

  const highlighted = useMemo(
    () => highlightedIds({ stamp, selection, randomSet }, panelSelection, tileset.id),
    [stamp, selection, randomSet, panelSelection, tileset.id],
  );
  /** Anchor / focus of what is highlighted (for Shift + click and the arrow keys). */
  const corners = useMemo((): { anchor: Cell; focus: Cell } | null => {
    if (highlighted.length === 0) return null;
    if (panelSelection && panelSelection.tilesetId === tileset.id && panelSelection.ids.length === highlighted.length && panelSelection.ids.every((id, i) => id === highlighted[i])) {
      return { anchor: panelSelection.anchor, focus: panelSelection.focus };
    }
    const first = cellOf(tileset, highlighted[0]!);
    const last = cellOf(tileset, highlighted[highlighted.length - 1]!);
    return { anchor: first, focus: last };
  }, [highlighted, panelSelection, tileset]);

  const commit = (ids: readonly number[], anchor: Cell, focus: Cell) => {
    if (ids.length === 0) {
      // Ctrl-toggled the last cell away: nothing selected.
      const s = useEditorStore.getState();
      s.setStamp(null);
      s.setSelection(null);
      useTilesetView.getState().setSelection(null);
      return;
    }
    commitTilesetSelection(tileset, ids, { anchor, focus }, empty);
  };

  /** Scrolls the viewport so the cells' bounding box is visible (centred when it was out of view). */
  const revealIds = useCallback(
    (ids: readonly number[], center: boolean) => {
      const vp = viewportRef.current;
      const b = boundsOf(tileset, ids);
      if (!vp || !b) return;
      const left = PADDING + offsetX + b.col * cellW;
      const top = PADDING + b.row * cellH;
      const right = left + b.width * cellW;
      const bottom = top + b.height * cellH;
      const viewW = vp.clientWidth;
      const viewH = vp.clientHeight;
      const visible = left >= vp.scrollLeft && right <= vp.scrollLeft + viewW && top >= vp.scrollTop && bottom <= vp.scrollTop + viewH;
      if (visible) return;
      if (center) {
        vp.scrollLeft = Math.max(0, Math.round((left + right) / 2 - viewW / 2));
        vp.scrollTop = Math.max(0, Math.round((top + bottom) / 2 - viewH / 2));
        return;
      }
      if (left < vp.scrollLeft) vp.scrollLeft = left - PADDING;
      else if (right > vp.scrollLeft + viewW) vp.scrollLeft = right - viewW + PADDING;
      if (top < vp.scrollTop) vp.scrollTop = top - PADDING;
      else if (bottom > vp.scrollTop + viewH) vp.scrollTop = bottom - viewH + PADDING;
    },
    [tileset, offsetX, cellW, cellH],
  );

  // Map picks: scroll the picked tiles into view (once the width is known, so the zoom is final).
  const revealedNonce = useRef(0);
  useLayoutEffect(() => {
    if (!reveal || reveal.tilesetId !== tileset.id || availWidth === 0 || revealedNonce.current === reveal.nonce) return;
    revealedNonce.current = reveal.nonce;
    revealIds(reveal.ids, true);
  }, [reveal, tileset.id, availWidth, revealIds]);

  // ---- random brush

  const toggleRandom = (tile: TileSelection, alt: boolean) => {
    if (alt && mode !== "random") {
      toggleRandomTile(tile);
      return;
    }
    const s = useEditorStore.getState();
    // Entering "Rastgele" does not silently add the tile that happened to be selected.
    const fresh = s.randomSet.length === 0 && !randomSessionRef.current;
    const result = toggleInSet(s.randomSet, fresh ? null : s.selection, tile);
    randomSessionRef.current = true;
    s.setRandomSet(result.randomSet);
    s.setSelection(result.selection);
    s.setStamp(null);
    if (s.tool !== "brush" && s.tool !== "fill" && s.tool !== "rect") s.setTool("brush");
  };

  // ---- terrain placement

  const info = terrainTemplateInfo(template);
  const blockAt = mode === "terrain" ? (pending ?? hover) : null;
  const tooSmall = mode === "terrain" ? terrainBlockProblem(tileset, template, 0, 0) : null;
  const blockProblem = blockAt ? terrainBlockProblem(tileset, template, blockAt.col, blockAt.row) : null;

  // ---- keyboard

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && (pending || mode !== "pick" || dragRef.current)) {
      event.preventDefault();
      event.stopPropagation();
      if (dragRef.current) updateDrag(null);
      else if (pending) setPending(null);
      else setMode("pick");
      return;
    }
    const d = arrowDelta(event.key);
    if (!d || event.ctrlKey || event.metaKey || event.altKey || mode !== "pick" || (event.target as HTMLElement).closest("input")) return;
    event.preventDefault();
    const next = arrowSelect(tileset, corners, d, event.shiftKey);
    commit(next.ids, next.anchor, next.focus);
    revealIds([idOf(tileset, next.focus)], false);
  };

  // ---- pointer

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button === 1) {
      // Middle drag pans the tileset (as on the map).
      const vp = viewportRef.current;
      if (!vp) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      updateDrag({ kind: "pan", pointerId: e.pointerId, x: e.clientX, y: e.clientY, left: vp.scrollLeft, top: vp.scrollTop });
      return;
    }
    if (e.button !== 0) return;
    const cell = cellAt(e.clientX, e.clientY);
    if (!cell) return;
    viewportRef.current?.focus({ preventScroll: true });
    const tile = { tilesetId: tileset.id, tileId: idOf(tileset, cell) };
    if (mode === "random" || (e.altKey && mode === "pick")) {
      const adding = !inRandomSet(useEditorStore.getState().randomSet, tile);
      toggleRandom(tile, e.altKey);
      if (mode === "random") {
        e.currentTarget.setPointerCapture(e.pointerId);
        updateDrag({ kind: "random", pointerId: e.pointerId, adding, visited: new Set([tile.tileId]) });
      }
    } else if (mode === "pick") {
      e.currentTarget.setPointerCapture(e.pointerId);
      const gesture = startGesture(tileset, cell, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }, corners ? { ids: highlighted, anchor: corners.anchor } : null);
      updateDrag({ kind: "select", pointerId: e.pointerId, gesture, cell });
    } else if (mode === "solid") {
      if (!store || store.inTransaction || !store.document.getTileset(tileset.id)) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      strokeRef.current = new SolidStroke(store, tileset.id, cell.col, cell.row);
    } else if (terrainBlockProblem(tileset, template, cell.col, cell.row) === null) {
      setPending(cell);
    }
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    pointerRef.current = { x: e.clientX, y: e.clientY };
    const g = dragRef.current;
    if (g?.kind === "pan" && g.pointerId === e.pointerId) {
      const vp = viewportRef.current;
      if (vp) {
        vp.scrollLeft = g.left - (e.clientX - g.x);
        vp.scrollTop = g.top - (e.clientY - g.y);
      }
      return;
    }
    if (strokeRef.current) {
      const c = rawCellAt(e.clientX, e.clientY);
      strokeRef.current.moveTo(c.col, c.row);
    }
    if (g?.kind === "select" && g.pointerId === e.pointerId) {
      const c = clampCell(tileset, rawCellAt(e.clientX, e.clientY));
      if (c.col !== g.cell.col || c.row !== g.cell.row) updateDrag({ ...g, cell: c });
    } else if (g?.kind === "random" && g.pointerId === e.pointerId) {
      const c = cellAt(e.clientX, e.clientY);
      if (c) {
        const id = idOf(tileset, c);
        if (!g.visited.has(id)) {
          g.visited.add(id);
          const tile = { tilesetId: tileset.id, tileId: id };
          if (inRandomSet(useEditorStore.getState().randomSet, tile) !== g.adding) toggleRandom(tile, false);
        }
      }
    }
    const cell = cellAt(e.clientX, e.clientY);
    setHover((h) => (h?.col === cell?.col && h?.row === cell?.row ? h : cell));
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    strokeRef.current?.end();
    strokeRef.current = null;
    const g = dragRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    updateDrag(null);
    if (g.kind === "select") commit(gestureIds(tileset, g.gesture, g.cell), g.gesture.anchor, g.cell);
  };

  const onPointerCancel = () => {
    strokeRef.current?.end();
    strokeRef.current = null;
    if (dragRef.current) updateDrag(null);
  };

  // ---- render

  const preview = useMemo(() => (drag?.kind === "select" ? gestureIds(tileset, drag.gesture, drag.cell) : null), [drag, tileset]);
  const shown = useMemo(() => (mode === "pick" ? (preview ?? highlighted) : []), [mode, preview, highlighted]);
  const shownBounds = preview ? boundsOf(tileset, preview) : null;
  const randomHere = randomSet.length >= 2 ? randomSet.filter((r) => r.tilesetId === tileset.id) : [];
  const shownSet = useMemo(() => new Set(shown), [shown]);
  const solidCount = tileset.solidTiles?.length ?? 0;
  const cursor =
    drag?.kind === "pan"
      ? "cursor-grabbing"
      : mode === "pick" || mode === "random"
        ? "cursor-pointer"
        : mode === "terrain" && blockProblem
          ? "cursor-not-allowed"
          : "cursor-crosshair";
  const hoverId = hover ? idOf(tileset, hover) : null;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
      <ModeTabs mode={mode} onChange={setMode} />
      {mode === "pick" && (
        <div className="mx-3 mb-1 shrink-0 truncate text-2xs leading-4 text-faint" title={t("tilesetPanel.hintSelect")} data-tileset-hint>
          {t("tilesetPanel.hintSelect")}
        </div>
      )}
      {mode === "solid" && (
        <ModeBar icon="bricks" tone="solid" onDone={() => setMode("pick")}>
          <span className="min-w-0 flex-1 text-xs leading-4 text-muted">{t("tileset.solidModeHint")}</span>
          <span className="shrink-0 font-mono text-2xs text-faint tabular">{t("tileset.solidCount", { count: solidCount })}</span>
        </ModeBar>
      )}
      {mode === "random" && (
        <ModeBar icon="dice" tone="random" onDone={() => setMode("pick")}>
          <span className="min-w-0 flex-1 text-xs leading-4 text-muted">{t("tilesetPanel.hintRandom")}</span>
          {randomSet.length >= 2 && (
            <span className="shrink-0 font-mono text-2xs text-faint tabular">{t("tileset.randomCount", { count: randomSet.length })}</span>
          )}
        </ModeBar>
      )}
      {mode === "terrain" && (
        <TerrainDefineBar
          tileset={tileset}
          template={template}
          pending={pending}
          problem={tooSmall ?? (pending ? null : blockProblem)}
          onCancel={() => setPending(null)}
          onDone={() => setMode("pick")}
        />
      )}
      <div
        ref={viewportRef}
        tabIndex={0}
        role="grid"
        aria-label={tileset.name}
        aria-multiselectable
        data-tileset-viewport
        className="min-h-0 flex-1 overflow-auto border-t border-line-subtle bg-bg/40 focus-visible:outline-offset-[-2px]"
        style={{ padding: PADDING, scrollbarGutter: "stable" }}
      >
        {image ? (
          <div
            ref={gridRef}
            className={`checker relative touch-none select-none ${cursor}`}
            // Whole-pixel centering keeps tile edges crisp.
            style={{ width: cssW, height: cssH, marginLeft: offsetX }}
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
              if (dragRef.current?.pointerId === e.pointerId && dragRef.current.kind !== "select") updateDrag(null);
            }}
            onAuxClick={(e) => e.preventDefault()}
            onContextMenu={(e) => e.preventDefault()}
          >
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
            {mode !== "solid" &&
              (tileset.terrains ?? []).map((terrain) => {
                const ti = terrainTemplateInfo(terrain.template);
                const strong = mode === "terrain" || terrain.id === activeTerrainId;
                return (
                  <div
                    key={terrain.id}
                    aria-hidden
                    data-terrain-outline={terrain.id}
                    className={`pointer-events-none absolute outline-terrain-tint ${strong ? "outline-2" : "outline-1 opacity-70"}`}
                    style={{
                      left: terrain.origin.col * cellW,
                      top: terrain.origin.row * cellH,
                      width: ti.columns * cellW,
                      height: ti.rows * cellH,
                      outlineStyle: "solid",
                      outlineOffset: -1,
                    }}
                  >
                    <span className="absolute top-0 left-0 max-w-full truncate rounded-br-sm bg-terrain-tint px-1 text-2xs leading-[14px] font-medium text-inverse">
                      {terrain.name}
                    </span>
                  </div>
                );
              })}
            {randomHere.map((r) => {
              const col = r.tileId % tileset.columns;
              const row = Math.floor(r.tileId / tileset.columns);
              return (
                <div
                  key={r.tileId}
                  aria-hidden
                  data-random-tile={r.tileId}
                  className="pointer-events-none absolute rounded-[1px] outline-2 outline-accent"
                  style={{ left: col * cellW, top: row * cellH, width: cellW, height: cellH, outlineStyle: "solid", outlineOffset: -1 }}
                >
                  {cellW >= 14 && (
                    <span className="absolute -top-1 -right-1 grid size-3.5 place-items-center rounded-full bg-accent text-on-accent shadow-popup">
                      <Icon name="dice" size={9} strokeWidth={2.5} />
                    </span>
                  )}
                </div>
              );
            })}
            {(mode === "pick" || mode === "random") && hover && hoverId !== null && !shownSet.has(hoverId) && !drag && (
              <div
                aria-hidden
                className="pointer-events-none absolute bg-hover-tile outline outline-1 outline-text/60"
                style={{ left: hover.col * cellW, top: hover.row * cellH, width: cellW, height: cellH }}
              />
            )}
            {mode === "solid" && hover && (
              <div
                aria-hidden
                className={`pointer-events-none absolute outline-2 outline-collision-solid ${
                  isTileSolid(tileset, hover.row * tileset.columns + hover.col) ? "" : "bg-collision-solid/20"
                }`}
                style={{
                  left: hover.col * cellW,
                  top: hover.row * cellH,
                  width: cellW,
                  height: cellH,
                  outlineStyle: "solid",
                  outlineOffset: -2,
                }}
              />
            )}
            {shown.length > 0 && (
              <SelectionOverlay
                tileset={tileset}
                ids={shown}
                empty={empty}
                cellW={cellW}
                cellH={cellH}
                width={cssW}
                height={cssH}
                live={preview !== null}
              />
            )}
            {blockAt && !tooSmall && (
              <BlockGhost
                template={template}
                left={blockAt.col * cellW}
                top={blockAt.row * cellH}
                cellW={cellW}
                cellH={cellH}
                invalid={blockProblem !== null}
                pinned={pending !== null}
                columns={info.columns}
                rows={info.rows}
              />
            )}
            {(mode === "pick" || mode === "random") && (shownBounds ? shownBounds.width * shownBounds.height > 1 : hover !== null) && (
              <CellLabel
                cell={shownBounds && drag?.kind === "select" ? drag.cell : hover!}
                cellW={cellW}
                cellH={cellH}
                width={cssW}
                rows={tileset.rows}
                text={
                  shownBounds
                    ? t("tilesetPanel.dragSize", { width: shownBounds.width, height: shownBounds.height })
                    : t(empty.has(hoverId!) ? "tilesetPanel.hoverEmpty" : "tilesetPanel.hover", { id: hoverId!, col: hover!.col, row: hover!.row })
                }
              />
            )}
          </div>
        ) : (
          <div className="py-6 text-center text-sm text-faint">{t("tileset.missingImage", { path: tileset.imagePath })}</div>
        )}
      </div>

      <TerrainSets />

      <div className="flex h-8 shrink-0 items-center gap-2 border-t border-line-subtle pr-1.5 pl-3 text-xs text-faint" data-tileset-footer>
        <span className="truncate">{t("tileset.tileCount", { count: tileset.columns * tileset.rows })}</span>
        <span className="font-mono tabular">
          {tileset.columns}×{tileset.rows}
        </span>
        {solidCount > 0 && mode !== "solid" && (
          <span className="flex min-w-0 items-center gap-1 truncate">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-collision-solid" />
            {t("tileset.solidCount", { count: solidCount })}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-0.5" data-tileset-zoom>
          {canWiden && (
            <Tooltip label={t("tilesetPanel.widen")} side="top">
              <IconButton
                aria-label={t("tilesetPanel.widen")}
                data-tileset-widen
                className="size-6 text-accent"
                onClick={() => useLayoutStore.getState().widenLibrary(widenExtra)}
              >
                <Icon name="widen" size={13} />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip label={t("tilesetPanel.zoomOut")} side="top">
            <IconButton aria-label={t("tilesetPanel.zoomOut")} className="size-6" onClick={() => zoomTo(stepZoom(scale, -1))}>
              <Icon name="minus" size={13} />
            </IconButton>
          </Tooltip>
          <Tooltip label={t("tilesetPanel.zoomActual")} side="top">
            <button
              type="button"
              aria-label={t("tilesetPanel.zoomActual")}
              data-tileset-zoom-label
              onClick={() => zoomTo(1)}
              className="h-6 min-w-[42px] rounded-sm px-1 text-center font-mono text-xs text-muted tabular hover:bg-hover hover:text-text"
            >
              {zoomLabel(scale)}
            </button>
          </Tooltip>
          <Tooltip label={t("tilesetPanel.zoomIn")} side="top">
            <IconButton aria-label={t("tilesetPanel.zoomIn")} className="size-6" onClick={() => zoomTo(stepZoom(scale, 1))}>
              <Icon name="plus" size={13} />
            </IconButton>
          </Tooltip>
          <Tooltip label={t("tilesetPanel.zoomFitTitle")} side="top">
            <button
              type="button"
              aria-pressed={storedZoom === null}
              onClick={() => zoomTo(null)}
              className={`ml-0.5 h-6 rounded-sm px-1.5 text-xs transition-colors ${
                storedZoom === null ? "bg-active text-text" : "text-muted hover:bg-hover hover:text-text"
              }`}
            >
              {t("tileset.zoomFit")}
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

/**
 * Selected cells: a translucent accent fill and an accent outline around
 * the selection's edge (holes of a Ctrl selection show). Transparent tiles
 * inside a selection are left unfilled: they are not part of the stamp.
 */
function SelectionOverlay({
  tileset,
  ids,
  empty,
  cellW,
  cellH,
  width,
  height,
  live,
}: {
  tileset: Tileset;
  ids: readonly number[];
  empty: ReadonlySet<number>;
  cellW: number;
  cellH: number;
  width: number;
  height: number;
  live: boolean;
}) {
  const skipEmpty = ids.length > 1;
  const fill = useMemo(() => {
    const parts: string[] = [];
    for (const id of ids) {
      if (skipEmpty && empty.has(id)) continue;
      const { col, row } = cellOf(tileset, id);
      const x0 = Math.round(col * cellW);
      const y0 = Math.round(row * cellH);
      parts.push(`M${x0} ${y0}H${Math.round((col + 1) * cellW)}V${Math.round((row + 1) * cellH)}H${x0}Z`);
    }
    return parts.join("");
  }, [ids, empty, skipEmpty, tileset, cellW, cellH]);
  const outline = useMemo(() => outlinePath(tileset, ids, cellW, cellH), [tileset, ids, cellW, cellH]);
  return (
    <svg
      aria-hidden
      width={width}
      height={height}
      className="pointer-events-none absolute inset-0 overflow-visible"
      shapeRendering="crispEdges"
      data-selected-tiles={ids.join(",")}
    >
      <path d={fill} fill="var(--color-accent)" fillOpacity={live ? 0.28 : 0.22} />
      <path d={outline} fill="none" stroke="var(--color-bg)" strokeWidth={4} strokeLinecap="square" strokeOpacity={0.7} />
      <path d={outline} fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeLinecap="square" strokeDasharray={live ? "4 3" : undefined} />
    </svg>
  );
}

/** Small chip next to a cell: "id 12 · (4, 1)" on hover, "3 × 2" while dragging. */
function CellLabel({
  cell,
  cellW,
  cellH,
  width,
  rows,
  text,
}: {
  cell: TileCell;
  cellW: number;
  cellH: number;
  width: number;
  rows: number;
  text: string;
}) {
  const below = cell.row === 0 || (cell.row + 1) * cellH < 22;
  const top = below ? (cell.row + 1) * cellH + 3 : cell.row * cellH - 19;
  const flipBottom = below && cell.row === rows - 1;
  const left = Math.min(Math.max(0, cell.col * cellW), Math.max(0, width - 96));
  return (
    <div
      aria-hidden
      data-tileset-cell-label
      className="pointer-events-none absolute z-10 rounded-sm border border-line bg-raised/95 px-1.5 font-mono text-2xs leading-4 whitespace-nowrap text-text shadow-popup tabular"
      style={{ left, top: flipBottom ? cell.row * cellH + 2 : top }}
    >
      {text}
    </div>
  );
}

/** Strip above the tileset while a mode is on: what to do, and "Bitti". */
function ModeBar({
  icon,
  tone,
  onDone,
  children,
}: {
  icon: "bricks" | "terrain" | "dice";
  tone: "solid" | "terrain" | "random";
  onDone(): void;
  children: ReactNode;
}) {
  return (
    <div className="mx-2 mb-1 flex shrink-0 items-center gap-2 rounded-md border border-line bg-raised py-1 pr-1 pl-2">
      <Icon
        name={icon}
        size={14}
        className={`shrink-0 ${tone === "solid" ? "text-collision-solid" : tone === "random" ? "text-accent" : "text-terrain-tint"}`}
      />
      {children}
      <Button variant="ghost" className="h-6 shrink-0 px-2 text-sm" onClick={onDone}>
        {t("tileset.done")}
      </Button>
    </div>
  );
}

/** Block-sized outline that follows the cursor; each cell shows its template glyph. */
function BlockGhost({
  template,
  left,
  top,
  cellW,
  cellH,
  columns,
  rows,
  invalid,
  pinned,
}: {
  template: TerrainTemplate;
  left: number;
  top: number;
  cellW: number;
  cellH: number;
  columns: number;
  rows: number;
  invalid: boolean;
  pinned: boolean;
}) {
  const glyphs = useMemo(() => templateGlyphs(terrainTemplateInfo(template)), [template]);
  const width = columns * cellW;
  const height = rows * cellH;
  const unit = Math.floor(Math.min(cellW, cellH) * 0.42 / 3);
  return (
    <div
      aria-hidden
      data-terrain-ghost
      className={`pointer-events-none absolute ${invalid ? "bg-danger/15 outline-danger" : "bg-terrain-tint/10 outline-terrain-tint"} ${
        pinned ? "" : "transition-[left,top] duration-75"
      }`}
      style={{ left, top, width, height, outlineWidth: 2, outlineStyle: pinned ? "solid" : "dashed", outlineOffset: -1 }}
    >
      {unit >= 2 && !invalid && (
        <svg width={width} height={height} className="absolute inset-0" shapeRendering="crispEdges">
          {glyphs.map((glyph, s) => {
            const size = unit * 3;
            const x0 = Math.round((s % columns) * cellW + (cellW - size) / 2);
            const y0 = Math.round(Math.floor(s / columns) * cellH + (cellH - size) / 2);
            if (!glyph) return null;
            return (
              <g key={s}>
                <rect x={x0 - 1} y={y0 - 1} width={size + 2} height={size + 2} fill="var(--color-overlay)" />
                {glyph.map((on, i) =>
                  on ? (
                    <rect
                      key={i}
                      x={x0 + (i % 3) * unit}
                      y={y0 + Math.floor(i / 3) * unit}
                      width={unit}
                      height={unit}
                      fill="var(--color-terrain-tint)"
                    />
                  ) : null,
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
