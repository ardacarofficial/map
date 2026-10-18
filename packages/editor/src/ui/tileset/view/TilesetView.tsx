import type { Collection, Tileset } from "@smap/core";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { openTilesetImport } from "../../../commands/tilesetActions";
import { t } from "../../../i18n";
import { useEditorStore } from "../../../state/editorStore";
import { useStructureVersion } from "../../hooks";
import { Button } from "../../primitives/Button";
import { Icon } from "../../primitives/Icon";
import { PaletteGrid, paletteKey } from "../../palettes/PaletteGrid";
import { paletteRows } from "../../palettes/paletteModel";
import { usePaletteStore } from "../../palettes/paletteStore";
import { effectiveZoom } from "../libraryModel";
import { TilesetGrid } from "../TilesetGrid";
import { GridHostContext, type GridHost } from "./gridHost";
import { installTilesetPickSync } from "../tilesetSelect";
import { useTilesetView } from "../tilesetViewStore";
import { usePanDrag } from "../usePanDrag";
import { accumulateWheelZoom, fitScale, widthScale, naturalScale, PAN_GESTURE_MS, stackWheel, stepZoom, tilesetWheel } from "../zoomModel";
import { useUiStore } from "../../uiStore";
import { DockHeader } from "./DockHeader";
import { TileDragGhost } from "./TileDragGhost";
import { TilesetStack } from "./TilesetStack";
import { HEADER_H, PADDING } from "./constants";
installTilesetPickSync();

/** What the view shows in "Tek" (or one section of "Tümü"): a tileset or a palette. */
interface Source {
  /** Zoom / grid key: the tileset id, or `palette:<id>`. */
  readonly key: string;
  /** Natural content width and height (px at zoom 1) and tile size. */
  readonly width: number;
  readonly height: number;
  readonly tileW: number;
  readonly tileH: number;
}

const tilesetSource = (ts: Tileset): Source => ({ key: ts.id, width: ts.columns * ts.tileWidth, height: ts.rows * ts.tileHeight, tileW: ts.tileWidth, tileH: ts.tileHeight });
const paletteSource = (p: Collection, tileW: number, tileH: number): Source => ({
  key: paletteKey(p.id),
  width: p.columns * tileW,
  height: paletteRows(p) * tileH,
  tileW,
  tileH,
});

export function TilesetView() {
  const store = useEditorStore((s) => s.project?.store);
  const activeId = useUiStore((s) => s.activeTilesetId);
  const activePaletteId = usePaletteStore((s) => s.activePaletteId);
  useStructureVersion(store);
  const tilesets = store?.document.tilesets ?? [];
  const palettes = store?.document.collections ?? [];
  const active = tilesets.find((ts) => ts.id === activeId) ?? tilesets[0];
  const palette = activePaletteId ? palettes.find((p) => p.id === activePaletteId) : undefined;
  if (!active) return <EmptyTilesets />;
  return <TilesetLibrary tilesets={tilesets} palettes={palettes} active={active} palette={palette ?? null} />;
}

function EmptyTilesets() {
  return <div className="flex items-center gap-2 p-2 text-sm text-muted">
    <span>{t("tilesetDock.empty")}</span>
    <Button size="sm" data-tileset-empty onClick={() => void openTilesetImport()}><Icon name="image-up" />{t("tilesetPanel.add")}</Button>
  </div>;
}

function TilesetLibrary({
  tilesets,
  palettes,
  active,
  palette,
}: {
  tilesets: readonly Tileset[];
  palettes: readonly Collection[];
  active: Tileset;
  /** The palette shown in "Tek" instead of `active`, or null. */
  palette: Collection | null;
}) {
  const view = useTilesetView((s) => s.view);
  const zoomMap = useTilesetView((s) => s.zoom);
  const globalZoom = useTilesetView((s) => s.globalZoom);
  const setActive = useUiStore((s) => s.setActiveTileset);
  const map = useEditorStore((s) => s.project?.store.document.map);
  const mapTileW = map?.tileWidth ?? 32;
  const mapTileH = map?.tileHeight ?? 32;
  const stack = view === "all";
  // A palette has nothing to tag: editing applies to tilesets only.
  const showingPalette = !stack && palette !== null;

  const viewportRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [fitRequested, setFitRequested] = useState(false);
  const availWidth = Math.max(0, size.width - 2 * PADDING);
  const keyHandlers = useRef(new Map<string, (e: KeyboardEvent) => boolean>());
  const pan = usePanDrag(viewportRef);
  const panRef = useRef(pan);
  panRef.current = pan;

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0) setSize({ width: el.clientWidth, height: el.clientHeight });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const shown: Source = showingPalette ? paletteSource(palette, mapTileW, mapTileH) : tilesetSource(active);
  const sources = useMemo(() => {
    const m = new Map<string, Source>();
    for (const ts of tilesets) m.set(ts.id, tilesetSource(ts));
    for (const p of palettes) {
      const src = paletteSource(p, mapTileW, mapTileH);
      m.set(src.key, src);
    }
    return m;
  }, [tilesets, palettes, mapTileW, mapTileH]);

  const fitOf = useCallback(
    (src: Source) => fitRequested
      ? fitScale(availWidth, src.width, Math.max(1, size.height - 2 * PADDING - (stack ? HEADER_H * 2 : 0)), src.height)
      : Math.min(naturalScale(src.tileH), widthScale(availWidth, src.width, src.tileW)),
    [availWidth, fitRequested, size.height, stack],
  );
  const scaleOfSource = useCallback((src: Source) => effectiveZoom(zoomMap[src.key], globalZoom, fitOf(src)), [zoomMap, globalZoom, fitOf]);
  const scaleOf = useCallback((ts: Tileset) => scaleOfSource(tilesetSource(ts)), [scaleOfSource]);
  const scaleOfPalette = useCallback((p: Collection) => scaleOfSource(paletteSource(p, mapTileW, mapTileH)), [scaleOfSource, mapTileW, mapTileH]);

  // ---- host for the grids

  const host = useMemo(
    (): GridHost => ({
      focus: () => viewportRef.current?.focus({ preventScroll: true }),
      panning: () => panRef.current.active(),
      registerKeys: (id, handler) => {
        if (handler) keyHandlers.current.set(id, handler);
        else keyHandlers.current.delete(id);
      },
      reveal: (grid, box, center) => {
        const vp = viewportRef.current;
        if (!vp) return;
        const v = vp.getBoundingClientRect();
        const g = grid.getBoundingClientRect();
        const inset = stack ? HEADER_H * (grid.closest("[data-group-labelled]") ? 2 : 1) : 0;
        const left = g.left - v.left + vp.scrollLeft + box.left;
        const top = g.top - v.top + vp.scrollTop + box.top;
        const right = left + (box.right - box.left);
        const bottom = top + (box.bottom - box.top);
        const viewW = vp.clientWidth;
        const viewH = vp.clientHeight - inset;
        const viewTop = vp.scrollTop + inset;
        const visible = left >= vp.scrollLeft && right <= vp.scrollLeft + viewW && top >= viewTop && bottom <= viewTop + viewH;
        if (visible) return;
        if (center) {
          vp.scrollLeft = Math.max(0, Math.round((left + right) / 2 - viewW / 2));
          vp.scrollTop = Math.max(0, Math.round((top + bottom) / 2 - viewH / 2 - inset));
          return;
        }
        if (left < vp.scrollLeft) vp.scrollLeft = left - PADDING;
        else if (right > vp.scrollLeft + viewW) vp.scrollLeft = right - viewW + PADDING;
        if (top < viewTop) vp.scrollTop = top - inset - PADDING;
        else if (bottom > viewTop + viewH) vp.scrollTop = bottom - vp.clientHeight + PADDING;
      },
      lazy: stack,
    }),
    [stack],
  );

  // ---- zoom (anchored at the cursor)

  const setZoom = useTilesetView((s) => s.setZoom);
  const setGlobalZoom = useTilesetView((s) => s.setGlobalZoom);
  const anchorRef = useRef<{ key: string; ux: number; uy: number; cx: number; cy: number; scale: number } | null>(null);

  const gridEl = (key: string) => viewportRef.current?.querySelector<HTMLElement>(`[data-tileset-grid="${CSS.escape(key)}"]`) ?? null;

  /** Remembers the content point under (`cx`, `cy`) of source `key` so it stays put across the zoom. */
  const anchor = (key: string, cx?: number, cy?: number) => {
    const el = gridEl(key);
    const vp = viewportRef.current;
    const src = sources.get(key);
    if (!el || !vp || !src) return;
    const r = el.getBoundingClientRect();
    const v = vp.getBoundingClientRect();
    const x = cx ?? Math.min(r.right, Math.max(r.left, v.left + v.width / 2));
    const y = cy ?? Math.min(r.bottom, Math.max(r.top, v.top + v.height / 2));
    const scale = scaleOfSource(src);
    anchorRef.current = { key, ux: (x - r.left) / scale, uy: (y - r.top) / scale, cx: x, cy: y, scale };
  };

  /** Sets source `key`'s own zoom (null = back to the global zoom). */
  const zoomSource = (key: string, next: number | null, cx?: number, cy?: number) => {
    const src = sources.get(key);
    if (!src) return;
    const now = scaleOfSource(src);
    const then = effectiveZoom(next, globalZoom, fitOf(src));
    if (Math.abs(now - then) > 1e-6) anchor(key, cx, cy);
    setZoom(key, next);
  };

  /** The global zoom; in "Tek" it also drops the shown source's own zoom (the zoom field always moves what you see). */
  const zoomGlobal = (next: number | null) => {
    setFitRequested(next === null);
    if (next === null) {
      anchorRef.current = null;
      if (viewportRef.current) { viewportRef.current.scrollTop = 0; viewportRef.current.scrollLeft = 0; }
      if (stack) { for (const key of sources.keys()) setZoom(key, null); }
      else setZoom(shown.key, null);
      setGlobalZoom(null);
      return;
    }
    const vp = viewportRef.current;
    let key: string | null = shown.key;
    if (stack && vp) {
      const v = vp.getBoundingClientRect();
      const hit = document.elementFromPoint(v.left + v.width / 2, v.top + v.height / 2)?.closest("[data-tileset-grid]");
      key = hit?.getAttribute("data-tileset-grid") ?? null;
    }
    if (key) anchor(key);
    if (!stack) setZoom(shown.key, null);
    setGlobalZoom(next);
  };

  useLayoutEffect(() => {
    const a = anchorRef.current;
    const vp = viewportRef.current;
    if (!a || !vp) return;
    const el = gridEl(a.key);
    const scale = Number(el?.getAttribute("data-tileset-scale"));
    if (!el || !(scale > 0) || Math.abs(scale - a.scale) < 1e-6) return;
    anchorRef.current = null;
    const r = el.getBoundingClientRect();
    vp.scrollLeft += r.left + a.ux * scale - a.cx;
    vp.scrollTop += r.top + a.uy * scale - a.cy;
  });

  // "Tek": the map's wheel model. "Tümü": a plain wheel scrolls the list
  // (native), a pinch / Ctrl + wheel zooms globally. Native listener: React
  // wheel handlers are passive.
  const wheelAcc = useRef(0);
  const lastPan = useRef(-Infinity);
  const onWheelRef = useRef<(e: WheelEvent) => void>(() => undefined);
  onWheelRef.current = (e: WheelEvent) => {
    const vp = viewportRef.current;
    if (!vp) return;
    if (stack) {
      const delta = stackWheel(e);
      if (delta === null) return;
      e.preventDefault();
      const r = accumulateWheelZoom(wheelAcc.current, delta);
      wheelAcc.current = r.acc;
      if (r.step !== 0) zoomGlobal(stepZoom(globalZoom ?? scaleOfSource(shown), r.step));
      return;
    }
    e.preventDefault();
    const now = performance.now();
    const action = tilesetWheel(e, now - lastPan.current < PAN_GESTURE_MS);
    if (action.kind === "pan") {
      lastPan.current = now;
      vp.scrollLeft += action.dx;
      vp.scrollTop += action.dy;
      return;
    }
    const r = accumulateWheelZoom(wheelAcc.current, action.delta);
    wheelAcc.current = r.acc;
    if (r.step === 0) return;
    // Zoom the shown source at the cursor (its own zoom).
    zoomSource(shown.key, stepZoom(scaleOfSource(shown), r.step), e.clientX, e.clientY);
  };
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => onWheelRef.current(e);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ---- keyboard

  const panelSelection = useTilesetView((s) => s.selection);
  const paletteSelection = usePaletteStore((s) => s.selection);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("input,textarea")) return;
    if (event.key === "Escape") {
      for (const handler of keyHandlers.current.values()) {
        if (handler(event)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }
      return;
    }
    const has = (key: string | undefined) => (key && keyHandlers.current.has(key) ? key : null);
    const target = showingPalette
      ? paletteKey(palette.id)
      : ((stack ? has(paletteSelection ? paletteKey(paletteSelection.paletteId) : undefined) : null) ?? has(panelSelection?.tilesetId) ?? active.id);
    if (keyHandlers.current.get(target)?.(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const override = !stack ? (zoomMap[shown.key] ?? null) : null;
  const shownScale = stack ? (globalZoom ?? scaleOfSource(shown)) : scaleOfSource(shown);
  const viewport = (
    <div
      ref={viewportRef}
      tabIndex={0}
      role={stack ? "region" : "grid"}
      aria-label={stack ? t("tilesetLib.allLabel") : showingPalette ? palette.name : active.name}
      aria-multiselectable={stack ? undefined : true}
      data-tileset-viewport
      data-tileset-scroll
      data-tileset-view={view}
      data-tileset-shown={showingPalette ? paletteKey(palette.id) : active.id}
      className={`relative min-h-0 min-w-0 flex-1 overflow-auto bg-bg/40 outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--color-accent-line)] ${pan.cursor}`}
      style={{ padding: stack ? 0 : PADDING }}
      {...pan.handlers}
    >
      {stack ? (
        <TilesetStack
          tilesets={tilesets}
          palettes={palettes}
          scaleOf={scaleOf}
          scaleOfPalette={scaleOfPalette}
          offsetX={() => 0}
          paletteOffsetX={() => 0}
          onResetZoom={(key) => zoomSource(key, null)}
        />
      ) : showingPalette ? (
        <div style={{ width: "max-content" }}>
          <PaletteGrid key={palette.id} palette={palette} scale={scaleOfPalette(palette)} />
        </div>
      ) : (
        <div style={{ width: "max-content" }}>
          <TilesetGrid key={active.id} tileset={active} scale={scaleOf(active)} />
        </div>
      )}
    </div>
  );

  return (
    <GridHostContext.Provider value={host}>
      <TileDragGhost />
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col" onKeyDown={onKeyDown} data-tileset-library="dock" data-tileset-dock>
        <DockHeader tilesets={tilesets} palettes={palettes} active={active} palette={showingPalette ? palette : null}
          onSelect={setActive}
          override={override} onResetOverride={() => zoomSource(shown.key, null)} globalZoom={globalZoom} shownScale={shownScale} displayTileSize={Math.round(shown.tileH * scaleOfSource(shown))} onZoom={zoomGlobal} />
        {viewport}
      </div>
    </GridHostContext.Provider>
  );
}
