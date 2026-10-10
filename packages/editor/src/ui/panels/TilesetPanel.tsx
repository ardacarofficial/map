/**
 * The tileset view: one tileset or palette at a time ("Tek") or every
 * palette and tileset stacked in one scroll with sticky headers ("Tümü").
 *
 * It lives in the bottom dock (tab "Tileset", round 4: a wide strip with
 * the name ▾, "16 × 16 px", the view / edit toggles and zoom on the left,
 * the grid on the right) and — until the dock registers it, or as a
 * fallback — in the library column (`variant="column"`).
 *
 * Seç is the default: a click picks the brush. Tagging tiles (Katı, Arazi)
 * sits behind the header's ⚙ "Düzenle" toggle; the random brush comes from
 * the brush card ("Rastgele yap") or Alt + drag (no "Rastgele" mode).
 *
 * The scroll viewport is the host of the grids (see `TilesetGrid`): it
 * owns zoom ("Tek": the map's wheel model at the cursor; "Tümü": the wheel
 * scrolls, Ctrl / pinch zooms; a global zoom plus a per-source override),
 * hand panning (Space / middle drag) and keyboard routing. In ⚙ Düzenle →
 * Arazi a rough rectangle over a block starts a terrain (see `TilesetGrid`).
 */
import { ContextMenu } from "@base-ui/react/context-menu";
import type { Collection, Tileset } from "@smap/core";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { dropTileset, gotoTileset, openTilesetImport, renameTilesetGroup } from "../../commands/tilesetActions";
import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { useStructureVersion } from "../hooks";
import { IconButton } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { RenameInput } from "../primitives/RenameInput";
import { Tooltip } from "../primitives/Tooltip";
import { clearTerrainDraft, useTerrainDraft } from "../terrain/terrainDraft";
import { TerrainSets } from "../terrain/TerrainList";
import { PaletteGrid, paletteKey } from "../palettes/PaletteGrid";
import { createPalette, setPaletteColumnCount, showPalette } from "../palettes/paletteActions";
import { MAX_PALETTE_COLUMNS, MIN_PALETTE_COLUMNS } from "../palettes/paletteModel";
import { usePaletteStore } from "../palettes/paletteStore";
import { bestMatch, effectiveZoom, filterTilesets, groupTilesets, UNGROUPED, type DropTarget } from "../tileset/libraryModel";
import { isEditMode, MODE_HINT } from "../tileset/modeModel";
import { GridHostContext, TilesetGrid, type GridHost } from "../tileset/TilesetGrid";
import { ModeBar } from "../tileset/TilesetOverlays";
import { installTilesetPickSync } from "../tileset/tilesetSelect";
import { TilesetContextMenu, TilesetSwitcher, TilesetThumb } from "../tileset/TilesetSwitcher";
import { useTilesetView } from "../tileset/tilesetViewStore";
import { usePanDrag } from "../tileset/usePanDrag";
import { accumulateWheelZoom, fitScale, MAX_ZOOM, MIN_ZOOM, PAN_GESTURE_MS, stackWheel, stepZoom, tilesetWheel, ZOOM_STEPS, zoomLabel } from "../tileset/zoomModel";
import { useUiStore, type TilesetMode } from "../uiStore";
import { widenLibraryTarget } from "../layout/columns";
import { useLayoutStore, wantedLibraryWidth } from "../layout/layoutStore";
import { registerDockTab } from "../layout/dock/registry";
import { LibraryTabs } from "./LibraryPanel";
import { PanelSection } from "./PanelSection";

// Map picks reveal their tiles here, even while another tab is open.
installTilesetPickSync();

/** Space around a tileset inside the scroll area (CSS px). */
const PADDING = 10;
/** Height of a sticky group / tileset header in "Tümü" (CSS px). */
const HEADER_H = 28;
const DRAG_TYPE = "application/x-smap-tileset";
/** Collapse key of the palettes section in "Tümü" (cannot clash with a group name). */
const PALETTE_GROUP = "\u0000palettes";

export type TilesetViewVariant = "dock" | "column";

/** What the view shows in "Tek" (or one section of "Tümü"): a tileset or a palette. */
interface Source {
  /** Zoom / grid key: the tileset id, or `palette:<id>`. */
  readonly key: string;
  /** Natural content width (px at zoom 1) and tile size. */
  readonly width: number;
  readonly tileW: number;
  readonly tileH: number;
}

const tilesetSource = (ts: Tileset): Source => ({ key: ts.id, width: ts.columns * ts.tileWidth, tileW: ts.tileWidth, tileH: ts.tileHeight });
const paletteSource = (p: Collection, tileW: number, tileH: number): Source => ({ key: paletteKey(p.id), width: p.columns * tileW, tileW, tileH });

/** The library column tab (fallback while the bottom dock does not host the tileset view). */
export function TilesetPanel() {
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
      <TilesetView variant="column" />
    </PanelSection>
  );
}

/** The dock tab "Tileset". */
export function TilesetDockTab() {
  return (
    <div className="flex min-h-0 flex-1" data-tileset-dock>
      <TilesetView variant="dock" />
    </div>
  );
}

/** The tileset / palette view in either place. */
export function TilesetView({ variant }: { variant: TilesetViewVariant }) {
  const store = useEditorStore((s) => s.project?.store);
  const activeId = useUiStore((s) => s.activeTilesetId);
  const activePaletteId = usePaletteStore((s) => s.activePaletteId);
  useStructureVersion(store);
  const tilesets = store?.document.tilesets ?? [];
  const palettes = store?.document.collections ?? [];
  const active = tilesets.find((ts) => ts.id === activeId) ?? tilesets[0];
  const palette = activePaletteId ? palettes.find((p) => p.id === activePaletteId) : undefined;
  if (!active) return <EmptyTilesets />;
  return <TilesetLibrary tilesets={tilesets} palettes={palettes} active={active} palette={palette ?? null} variant={variant} />;
}

function EmptyTilesets() {
  return (
    <button
      type="button"
      onClick={() => void openTilesetImport()}
      data-tileset-empty
      className="m-3 flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong px-4 text-center transition-colors hover:border-accent-line hover:bg-accent-soft/40"
    >
      <Icon name="image" size={22} className="text-faint" />
      <span className="text-md text-muted">{t("tileset.empty")}</span>
      <span className="text-xs text-faint">{t("tileset.emptyHint")}</span>
    </button>
  );
}

function TilesetLibrary({
  tilesets,
  palettes,
  active,
  palette,
  variant,
}: {
  tilesets: readonly Tileset[];
  palettes: readonly Collection[];
  active: Tileset;
  /** The palette shown in "Tek" instead of `active`, or null. */
  palette: Collection | null;
  variant: TilesetViewVariant;
}) {
  const dock = variant === "dock";
  const view = useTilesetView((s) => s.view);
  const zoomMap = useTilesetView((s) => s.zoom);
  const globalZoom = useTilesetView((s) => s.globalZoom);
  const mode = useUiStore((s) => s.tilesetMode);
  const setMode = useUiStore((s) => s.setTilesetMode);
  const terrainEditing = useTerrainDraft((s) => s.draft !== null || s.fix !== null);
  const fixing = useTerrainDraft((s) => s.fix !== null);
  const setActive = useUiStore((s) => s.setActiveTileset);
  const map = useEditorStore((s) => s.project?.store.document.map);
  const mapTileW = map?.tileWidth ?? 32;
  const mapTileH = map?.tileHeight ?? 32;
  const stack = view === "all";
  // A palette has nothing to tag: editing applies to tilesets only.
  const showingPalette = !stack && palette !== null;
  const editing = isEditMode(mode) && !showingPalette;

  const viewportRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const availWidth = Math.max(0, stack || dock ? size.width - 2 * PADDING : size.width);
  const keyHandlers = useRef(new Map<string, (e: KeyboardEvent) => boolean>());
  const pan = usePanDrag(viewportRef);
  const panRef = useRef(pan);
  panRef.current = pan;

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) });
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

  /** Fit: the panel width; in the short dock also at most a third of its height per tile (a wide strip, not a giant single tileset). */
  const fitOf = useCallback(
    (src: Source) => {
      const byWidth = fitScale(availWidth, src.width, src.tileW);
      if (!dock || size.height <= 0) return byWidth;
      const cap = Math.max(MIN_ZOOM, (size.height - 2 * PADDING) / 3 / src.tileH);
      const step = [...ZOOM_STEPS].reverse().find((z) => z <= cap) ?? MIN_ZOOM;
      return Math.min(byWidth, Math.max(step, MIN_ZOOM));
    },
    [availWidth, dock, size.height],
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

  // The "Rastgele" mode is gone: a stale value (old command, saved UI state) falls back to Seç.
  useEffect(() => {
    if (mode === "random") setMode("pick");
  }, [mode, setMode]);

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

  /** The global zoom; in "Tek" it also drops the shown source's own zoom (the slider always moves what you see). */
  const zoomGlobal = (next: number | null) => {
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
      if (terrainEditing || mode !== "pick") {
        event.preventDefault();
        event.stopPropagation();
        if (terrainEditing) clearTerrainDraft();
        else setMode("pick");
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

  // ---- footer / side state

  const override = !stack ? (zoomMap[shown.key] ?? null) : null;
  const shownScale = stack ? (globalZoom ?? scaleOfSource(shown)) : scaleOfSource(shown);
  const widenExtra =
    !dock && !stack && !showingPalette && zoomMap[active.id] == null && globalZoom === null && availWidth > 0 && shown.width > availWidth ? shown.width - availWidth : 0;
  const canWiden = useLayoutStore(
    (s) =>
      widenExtra > 0 &&
      widenLibraryTarget(window.innerWidth, { library: wantedLibraryWidth(s, window.innerWidth), right: s.rightWidth }, widenExtra) !== null,
  );
  const solidCount = active.solidTiles?.length ?? 0;
  const offsetOf = (scaledWidth: number) => (dock ? 0 : Math.max(0, Math.floor((availWidth - Math.round(scaledWidth)) / 2)));
  const offsetX = (ts: Tileset) => offsetOf(ts.columns * ts.tileWidth * scaleOf(ts));
  const paletteOffsetX = (p: Collection) => offsetOf(p.columns * mapTileW * scaleOfPalette(p));

  const dockSlot = useTilesetView((s) => s.dockSlot);
  const zoomControls = (
    <ZoomControls
      override={override}
      onResetOverride={() => zoomSource(shown.key, null)}
      globalZoom={globalZoom}
      shownScale={shownScale}
      onZoom={zoomGlobal}
      widen={
        canWiden ? (
          <Tooltip label={t("tilesetPanel.widen")} side="top">
            <IconButton aria-label={t("tilesetPanel.widen")} data-tileset-widen className="size-6 text-accent" onClick={() => useLayoutStore.getState().widenLibrary(widenExtra)}>
              <Icon name="widen" size={13} />
            </IconButton>
          </Tooltip>
        ) : null
      }
    />
  );

  const meta = showingPalette ? (
    <span className="min-w-0 truncate" data-tileset-meta>
      {t("palettes.meta", { count: palette.cells.length, columns: palette.columns })}
    </span>
  ) : (
    <span className="min-w-0 truncate font-mono tabular" data-tileset-meta>
      {t("tilesetDock.tileSize", { width: active.tileWidth, height: active.tileHeight })}
      {!dock && <span className="text-faint/80"> · {active.columns}×{active.rows}</span>}
    </span>
  );

  const switcher = (
    <TilesetSwitcher
      tilesets={tilesets}
      palettes={palettes}
      active={active}
      palette={showingPalette ? palette : null}
      onSelect={(id) => {
        showPalette(null);
        setActive(id);
      }}
      onSelectPalette={(id) => showPalette(id)}
      onNewPalette={() => void createPalette()}
      compact={dock}
      meta={dock ? meta : undefined}
    />
  );

  const modeArea = (
    <>
      {dock ? (
        editing && <EditModeChips mode={mode} onChange={setMode} />
      ) : showingPalette ? (
        <PaletteColumns palette={palette} />
      ) : (
        <div className="flex shrink-0 items-center gap-1" data-tileset-edit-row>
          <EditToggle mode={mode} onChange={setMode} />
          {editing && <EditModeChips mode={mode} onChange={setMode} />}
        </div>
      )}
      {!editing && !dock && (
        <div className="shrink-0 text-2xs leading-4 text-pretty text-faint" data-tileset-hint>
          {t(showingPalette ? "palettes.hint" : "tilesetPanel.hintSelect")}
        </div>
      )}
      {editing && mode === "solid" && (
        <ModeBar icon="bricks" tone="solid" onDone={() => setMode("pick")}>
          <span className="min-w-0 flex-1 text-xs leading-4 text-muted" data-tileset-hint>
            {t(MODE_HINT.solid)}
          </span>
          {!stack && <span className="shrink-0 font-mono text-2xs text-faint tabular">{t("tileset.solidCount", { count: solidCount })}</span>}
        </ModeBar>
      )}
      {editing && mode === "terrain" && (
        <ModeBar icon="terrain" tone="terrain" onDone={() => setMode("pick")}>
          <span className="min-w-0 flex-1 text-xs leading-4 text-muted" data-tileset-hint>
            {t(fixing ? "terrain.fixHintShort" : "terrain.hintDrag")}
          </span>
        </ModeBar>
      )}
    </>
  );

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
      className={`relative min-h-0 min-w-0 flex-1 overflow-auto bg-bg/40 focus-visible:outline-offset-[-2px] ${dock ? "" : "border-t border-line-subtle"} ${pan.cursor}`}
      style={{ padding: stack ? 0 : PADDING, scrollbarGutter: dock ? undefined : "stable" }}
      {...pan.handlers}
    >
      {stack ? (
        <TilesetStack
          tilesets={tilesets}
          palettes={palettes}
          scaleOf={scaleOf}
          scaleOfPalette={scaleOfPalette}
          offsetX={offsetX}
          paletteOffsetX={paletteOffsetX}
          onResetZoom={(key) => zoomSource(key, null)}
        />
      ) : showingPalette ? (
        <div style={{ marginLeft: paletteOffsetX(palette), width: "max-content" }}>
          <PaletteGrid key={palette.id} palette={palette} scale={scaleOfPalette(palette)} />
        </div>
      ) : (
        <div style={{ marginLeft: offsetX(active), width: "max-content" }}>
          <TilesetGrid key={active.id} tileset={active} scale={scaleOf(active)} />
        </div>
      )}
    </div>
  );

  return (
    <GridHostContext.Provider value={host}>
      <TileDragGhost />
      {dock && dockSlot && createPortal(<div className="flex items-center gap-1" data-tileset-zoom>{zoomControls}</div>, dockSlot)}
      {dock ? (
        <div className="relative flex min-h-0 min-w-0 flex-1" onKeyDown={onKeyDown} data-tileset-library="dock">
          <aside
            aria-label={t("tilesetDock.side")}
            className="flex w-[216px] shrink-0 flex-col gap-1.5 overflow-y-auto border-r border-line-subtle px-2 pt-2 pb-1.5 text-xs text-muted"
            data-tileset-side
          >
            {stack ? <LibrarySearch tilesets={tilesets} trailing={null} /> : switcher}
            <div className="flex shrink-0 items-center gap-1">
              <ViewToggle />
              {showingPalette ? <PaletteColumns palette={palette} /> : <EditToggle mode={mode} onChange={setMode} />}
            </div>
            <PaletteChips palettes={palettes} activeId={showingPalette ? palette.id : null} wide />
            {modeArea}
            <TerrainSets compact />
          </aside>
          {viewport}
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown} data-tileset-library="column">
          <div className="flex shrink-0 flex-col gap-1.5 px-2 pb-1.5">
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1">{stack ? <LibrarySearch tilesets={tilesets} trailing={null} /> : switcher}</div>
              <ViewToggle />
            </div>
            <PaletteChips palettes={palettes} activeId={showingPalette ? palette.id : null} wide />
            {modeArea}
          </div>
          {stack && <JumpChips tilesets={tilesets} palettes={palettes} activeId={active.id} />}
          {viewport}
          <TerrainSets />
          {stack && (
            // How the wheel behaves in the stacked list (it scrolls here, unlike "Tek").
            <div className="shrink-0 border-t border-line-subtle px-3 pt-1 text-2xs leading-4 text-pretty text-faint" title={t("tilesetLib.wheelHint")} data-tileset-wheel-hint>
              {t("tilesetLib.wheelHint")}
            </div>
          )}
          <div className={`flex h-8 shrink-0 items-center gap-2 pr-1.5 pl-3 text-xs text-faint ${stack ? "" : "border-t border-line-subtle"}`} data-tileset-footer>
            {stack ? <span className="min-w-0 truncate">{t("tilesetLib.count", { count: tilesets.length })}</span> : meta}
            <div className="ml-auto flex shrink-0 items-center gap-1" data-tileset-zoom>
              {zoomControls}
            </div>
          </div>
        </div>
      )}
    </GridHostContext.Provider>
  );
}

// ------------------------------------------------------------------ header pieces

/** ⚙ "Düzenle": tag tiles (Katı / Arazi) instead of picking a brush. Remembers the last edit mode. */
let lastEditMode: TilesetMode = "solid";

function EditToggle({ mode, onChange }: { mode: TilesetMode; onChange(mode: TilesetMode): void }) {
  const on = isEditMode(mode);
  if (on) lastEditMode = mode;
  return (
    <Tooltip label={on ? t("tilesetDock.editDone") : t("tilesetDock.editTitle")}>
      <button
        type="button"
        aria-pressed={on}
        data-tileset-edit
        onClick={() => onChange(on ? "pick" : lastEditMode)}
        className={`flex h-6 shrink-0 items-center gap-1 rounded-sm px-1.5 text-xs transition-colors ${
          on ? "bg-accent-soft text-accent shadow-[inset_0_0_0_1px_var(--color-accent-line)]" : "text-muted hover:bg-hover hover:text-text"
        }`}
      >
        <Icon name="sliders" size={13} />
        {t("tilesetDock.edit")}
      </button>
    </Tooltip>
  );
}

const EDIT_CHIPS: readonly { mode: TilesetMode; icon: "bricks" | "terrain"; label: "tilesetPanel.modeSolid" | "tilesetPanel.modeTerrain"; title: "tilesetPanel.modeSolidTitle" | "tilesetPanel.modeTerrainTitle"; tone: string }[] = [
  { mode: "solid", icon: "bricks", label: "tilesetPanel.modeSolid", title: "tilesetPanel.modeSolidTitle", tone: "text-collision-solid" },
  { mode: "terrain", icon: "terrain", label: "tilesetPanel.modeTerrain", title: "tilesetPanel.modeTerrainTitle", tone: "text-terrain-tint" },
];

/** Labelled chips of the edit modes (only while ⚙ Düzenle is on). */
function EditModeChips({ mode, onChange }: { mode: TilesetMode; onChange(mode: TilesetMode): void }) {
  return (
    <div role="radiogroup" aria-label={t("tilesetPanel.modes")} className="flex min-w-0 gap-0.5 rounded-md bg-raised p-0.5" data-tileset-modes>
      {EDIT_CHIPS.map((m) => {
        const on = m.mode === mode;
        return (
          <button
            key={m.mode}
            type="button"
            role="radio"
            aria-checked={on}
            title={t(m.title)}
            data-tileset-mode={m.mode}
            onClick={() => onChange(m.mode)}
            className={`flex h-5 min-w-0 items-center gap-1 rounded-sm px-1.5 text-xs font-medium transition-colors ${
              on ? "bg-active text-text shadow-[inset_0_0_0_1px_var(--color-line)]" : "text-faint hover:bg-hover hover:text-muted"
            }`}
          >
            <Icon name={m.icon} size={12} className={`shrink-0 ${on ? m.tone : ""}`} />
            <span className="truncate">{t(m.label)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Palette column count stepper (a palette's header). */
function PaletteColumns({ palette }: { palette: Collection }) {
  const step = (d: number) => setPaletteColumnCount(palette.id, palette.columns + d);
  return (
    <div className="flex shrink-0 items-center gap-1 text-2xs text-faint" data-palette-columns>
      <span>{t("palettes.columns")}</span>
      <span className="flex items-center rounded-sm border border-line">
        <button type="button" aria-label={t("palettes.columnsLess")} disabled={palette.columns <= MIN_PALETTE_COLUMNS} onClick={() => step(-1)} className="grid size-5 place-items-center text-muted hover:text-text disabled:opacity-30">
          <Icon name="minus" size={11} />
        </button>
        <span className="w-5 text-center font-mono text-xs text-text tabular">{palette.columns}</span>
        <button type="button" aria-label={t("palettes.columnsMore")} disabled={palette.columns >= MAX_PALETTE_COLUMNS} onClick={() => step(1)} className="grid size-5 place-items-center text-muted hover:text-text disabled:opacity-30">
          <Icon name="plus" size={11} />
        </button>
      </span>
    </div>
  );
}

/**
 * Palette chips: a click shows the palette; dropping dragged tiles on a
 * chip appends them (so a drag works while a tileset is shown). "+" makes
 * a new palette.
 */
function PaletteChips({ palettes, activeId, wide = false }: { palettes: readonly Collection[]; activeId: string | null; wide?: boolean }) {
  const dragging = usePaletteStore((s) => s.drag !== null);
  const dropId = usePaletteStore((s) => (s.drag?.target && !s.drag.target.slot ? s.drag.target.paletteId : null));
  return (
    <div className={`flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] ${wide ? "" : "flex-1"}`} data-palette-chips role="list" aria-label={t("palettes.title")}>
      {palettes.map((p) => (
        <button
          key={p.id}
          type="button"
          role="listitem"
          data-palette-drop={p.id}
          title={p.name}
          onClick={() => showPalette(activeId === p.id ? null : p.id)}
          className={`flex h-5 max-w-[110px] shrink-0 items-center gap-1 truncate rounded-full border px-1.5 text-2xs transition-colors ${
            dropId === p.id
              ? "border-accent bg-accent text-on-accent"
              : activeId === p.id
                ? "border-accent-line bg-accent-soft text-accent"
                : dragging
                  ? "border-dashed border-accent-line text-muted"
                  : "border-line text-muted hover:border-line-strong hover:text-text"
          }`}
        >
          <Icon name="grid" size={10} className="shrink-0" />
          <span className="truncate">{p.name}</span>
        </button>
      ))}
      <Tooltip label={t("palettes.new")}>
        <button
          type="button"
          aria-label={t("palettes.new")}
          data-palette-new
          onClick={() => void createPalette()}
          className={`flex h-5 shrink-0 items-center gap-0.5 rounded-full border border-dashed border-line px-1.5 text-2xs text-faint transition-colors hover:border-accent-line hover:text-accent`}
        >
          <Icon name="plus" size={10} />
          {palettes.length === 0 && t("palettes.newShort")}
        </button>
      </Tooltip>
    </div>
  );
}

/** Floating "+3 · Kopyala" next to the pointer while tiles are dragged. */
function TileDragGhost() {
  const drag = usePaletteStore((s) => s.drag);
  if (!drag) return null;
  const moving = drag.move && drag.source.kind === "palette";
  return createPortal(
    <div
      aria-hidden
      data-tile-drag-ghost
      className={`pointer-events-none fixed z-50 flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-2xs font-medium shadow-popup ${
        drag.target ? "border-accent bg-accent text-on-accent" : "border-line bg-raised text-muted"
      }`}
      style={{ left: drag.x + 14, top: drag.y + 12 }}
    >
      <Icon name={moving ? "arrowDown" : "copy"} size={11} />
      {t(moving ? "palettes.ghostMove" : "palettes.ghostCopy", { count: drag.items.length })}
    </div>,
    document.body,
  );
}

function ZoomControls({
  override,
  onResetOverride,
  globalZoom,
  shownScale,
  onZoom,
  widen,
}: {
  override: number | null;
  onResetOverride(): void;
  globalZoom: number | null;
  shownScale: number;
  onZoom(zoom: number | null): void;
  widen: ReactNode;
}) {
  const fit = globalZoom === null && override === null;
  return (
    <>
      {override !== null && (
        <Tooltip label={t("tilesetLib.zoomOverrideReset")} side="top">
          <button
            type="button"
            data-tileset-zoom-override
            onClick={onResetOverride}
            className="flex h-6 shrink-0 items-center gap-1 rounded-sm bg-accent-soft px-1.5 font-mono text-2xs text-accent tabular hover:brightness-110"
          >
            {t("tilesetLib.zoomOverride", { zoom: zoomLabel(override) })}
            <Icon name="x" size={11} />
          </button>
        </Tooltip>
      )}
      {widen}
      <ZoomSlider value={override ?? globalZoom} shown={shownScale} onChange={onZoom} />
      <Tooltip label={t("tilesetPanel.zoomActual")} side="top">
        <button
          type="button"
          aria-label={t("tilesetPanel.zoomActual")}
          data-tileset-zoom-label
          onClick={() => onZoom(1)}
          className="h-6 min-w-[40px] shrink-0 rounded-sm px-1 text-center font-mono text-xs text-muted tabular hover:bg-hover hover:text-text"
        >
          {zoomLabel(shownScale)}
        </button>
      </Tooltip>
      <Tooltip label={t("tilesetPanel.zoomFitTitle")} side="top">
        <button
          type="button"
          aria-pressed={fit}
          data-tileset-zoom-fit
          onClick={() => onZoom(null)}
          className={`h-6 shrink-0 rounded-sm px-1.5 text-xs transition-colors ${fit ? "bg-active text-text" : "text-muted hover:bg-hover hover:text-text"}`}
        >
          {t("tileset.zoomFit")}
        </button>
      </Tooltip>
    </>
  );
}

/** Global zoom slider over the zoom steps (left end = smallest). */
function ZoomSlider({ value, shown, onChange }: { value: number | null; shown: number; onChange(zoom: number): void }) {
  const current = value ?? shown;
  let index = ZOOM_STEPS.findIndex((s) => s >= current - 1e-6);
  if (index < 0) index = ZOOM_STEPS.length - 1;
  return (
    <input
      type="range"
      min={0}
      max={ZOOM_STEPS.length - 1}
      step={1}
      value={index}
      aria-label={t("tilesetLib.zoomSlider")}
      aria-valuetext={zoomLabel(current)}
      data-tileset-zoom-slider
      onChange={(e) => onChange(ZOOM_STEPS[Number(e.target.value)] ?? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current)))}
      className="h-6 w-16 min-w-0 flex-1 accent-(--color-accent)"
    />
  );
}

/** "Tümü | Tek" segmented toggle (remembered). */
function ViewToggle() {
  const view = useTilesetView((s) => s.view);
  const setView = useTilesetView((s) => s.setView);
  const option = (v: "all" | "single", label: string, icon: "layers" | "image") => (
    <Tooltip label={label}>
      <button
        type="button"
        role="radio"
        aria-checked={view === v}
        aria-label={label}
        data-library-view={v}
        onClick={() => setView(v)}
        className={`grid size-6 place-items-center rounded-sm transition-colors ${view === v ? "bg-active text-text shadow-[inset_0_0_0_1px_var(--color-line)]" : "text-faint hover:bg-hover hover:text-muted"}`}
      >
        <Icon name={icon} size={13} />
      </button>
    </Tooltip>
  );
  return (
    <div role="radiogroup" aria-label={t("tilesetLib.view")} className="flex shrink-0 gap-0.5 rounded-md bg-raised p-0.5">
      {option("single", t("tilesetLib.viewSingleTitle"), "image")}
      {option("all", t("tilesetLib.viewAllTitle"), "layers")}
    </div>
  );
}

/** Search by name ("Tümü"): filters the stack; Enter jumps to the best match; Esc clears. */
function LibrarySearch({ tilesets, trailing }: { tilesets: readonly Tileset[]; trailing: ReactNode }) {
  const query = useTilesetView((s) => s.query);
  const setQuery = useTilesetView((s) => s.setQuery);
  const focusNonce = useTilesetView((s) => s.searchFocus);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusNonce > 0) ref.current?.focus();
  }, [focusNonce]);
  return (
    <div className="flex shrink-0 items-center gap-1">
      <label className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-line bg-raised px-2 transition-colors focus-within:border-accent hover:border-line-strong">
        <Icon name="search" size={14} className="shrink-0 text-faint" />
        <input
          ref={ref}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const best = bestMatch(tilesets, query);
              if (best) gotoTileset(best.id);
            } else if (e.key === "Escape" && query) {
              e.preventDefault();
              e.stopPropagation();
              setQuery("");
            }
          }}
          placeholder={t("tilesetLib.search")}
          aria-label={t("tilesetLib.search")}
          data-tileset-search
          spellCheck={false}
          autoComplete="off"
          className="h-full min-w-0 flex-1 bg-transparent text-md text-text placeholder:text-faint focus-visible:outline-none"
        />
        {query && (
          <button type="button" aria-label={t("tilesetLib.searchClear")} onClick={() => setQuery("")} className="text-faint hover:text-text">
            <Icon name="x" size={13} />
          </button>
        )}
      </label>
      {trailing}
    </div>
  );
}

/** One chip per tileset / palette (search applied): a click jumps there. */
function JumpChips({ tilesets, palettes, activeId }: { tilesets: readonly Tileset[]; palettes: readonly Collection[]; activeId: string }) {
  const query = useTilesetView((s) => s.query);
  const shown = [
    ...filterTilesets(palettes, query).map((p) => ({ key: paletteKey(p.id), name: p.name, palette: true })),
    ...filterTilesets(tilesets, query).map((ts) => ({ key: ts.id, name: ts.name, palette: false })),
  ];
  const rowRef = useRef<HTMLDivElement>(null);
  // Which ends have chips scrolled out of sight (they fade there).
  const [more, setMore] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const el = rowRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setMore((m) => (m.left === left && m.right === right ? m : { left, right }));
  }, []);
  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    // A vertical wheel scrolls the row sideways (it has no vertical scroll).
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey || el.scrollWidth <= el.clientWidth) return;
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (d === 0) return;
      e.preventDefault();
      el.scrollLeft += e.deltaMode === 1 ? d * 16 : d;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      el.removeEventListener("wheel", onWheel);
    };
  }, [measure, shown.length]);
  // Keep the active chip in view.
  useEffect(() => {
    rowRef.current?.querySelector(`[data-tileset-chip="${CSS.escape(activeId)}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId]);
  if (shown.length < 2) return null;
  const fade = 20;
  const mask =
    more.left || more.right
      ? `linear-gradient(to right, ${more.left ? "transparent" : "#000"} 0, #000 ${more.left ? fade : 0}px, #000 calc(100% - ${more.right ? fade : 0}px), ${more.right ? "transparent" : "#000"} 100%)`
      : undefined;
  return (
    <div
      ref={rowRef}
      onScroll={measure}
      className="flex shrink-0 gap-1 overflow-x-auto px-2 pb-1.5 [scrollbar-width:none]"
      style={{ maskImage: mask, WebkitMaskImage: mask }}
      data-tileset-jump
      data-more-left={more.left || undefined}
      data-more-right={more.right || undefined}
      role="navigation"
      aria-label={t("tilesetLib.jump")}
    >
      {shown.map((s) => (
        <button
          key={s.key}
          type="button"
          data-tileset-chip={s.key}
          title={s.name}
          onClick={() => (s.palette ? useTilesetView.getState().requestJump(s.key) : gotoTileset(s.key))}
          className={`flex h-5 max-w-[120px] shrink-0 items-center gap-1 truncate rounded-full border px-2 text-2xs transition-colors ${
            s.key === activeId ? "border-accent-line bg-accent-soft text-accent" : "border-line text-muted hover:border-line-strong hover:text-text"
          }`}
        >
          {s.palette && <Icon name="grid" size={10} className="shrink-0" />}
          <span className="truncate">{s.name}</span>
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ "Tümü"

function TilesetStack({
  tilesets,
  palettes,
  scaleOf,
  scaleOfPalette,
  offsetX,
  paletteOffsetX,
  onResetZoom,
}: {
  tilesets: readonly Tileset[];
  palettes: readonly Collection[];
  scaleOf(ts: Tileset): number;
  scaleOfPalette(p: Collection): number;
  offsetX(ts: Tileset): number;
  paletteOffsetX(p: Collection): number;
  onResetZoom(key: string): void;
}) {
  const query = useTilesetView((s) => s.query);
  const collapsed = useTilesetView((s) => s.collapsed);
  const toggleCollapsed = useTilesetView((s) => s.toggleCollapsed);
  const zoomMap = useTilesetView((s) => s.zoom);
  const jump = useTilesetView((s) => s.jump);
  const activeId = useUiStore((s) => s.activeTilesetId);
  const shown = filterTilesets(tilesets, query);
  const shownPalettes = filterTilesets(palettes, query);
  const groups = groupTilesets(shown);
  // With palettes listed, tilesets always get group headers, so the two kinds read apart.
  const labelled = groups.some((g) => g.name !== UNGROUPED) || shownPalettes.length > 0;
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<DropTarget | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Jump requests (goto, chips, search Enter): open its group, then bring its header to the top.
  const jumped = useRef(0);
  useLayoutEffect(() => {
    if (!jump || jumped.current === jump.nonce) return;
    const isPalette = jump.tilesetId.startsWith("palette:");
    const ts = isPalette ? undefined : tilesets.find((x) => x.id === jump.tilesetId);
    if (!isPalette && !ts) return;
    const group = isPalette ? PALETTE_GROUP : (ts!.group ?? UNGROUPED);
    if (labelled && collapsed.includes(group)) {
      toggleCollapsed(group);
      return;
    }
    const vp = rootRef.current?.closest<HTMLElement>("[data-tileset-scroll]");
    const section = rootRef.current?.querySelector<HTMLElement>(`[data-tileset-section="${CSS.escape(jump.tilesetId)}"]`);
    if (!vp || !section) return;
    jumped.current = jump.nonce;
    vp.scrollTop += section.getBoundingClientRect().top - vp.getBoundingClientRect().top - (labelled ? HEADER_H : 0);
  }, [jump, tilesets, collapsed, labelled, toggleCollapsed]);

  const dragProps = (target: DropTarget) => ({
    onDragOver: (e: DragEvent) => {
      if (!dragId || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (over?.group !== target.group || over.beforeId !== target.beforeId) setOver(target);
    },
    onDrop: (e: DragEvent) => {
      const id = e.dataTransfer.getData(DRAG_TYPE) || dragId;
      e.preventDefault();
      setOver(null);
      setDragId(null);
      if (id) dropTileset(id, target);
    },
  });

  if (shown.length === 0 && shownPalettes.length === 0) {
    return <div className="px-4 py-8 text-center text-sm text-faint">{t("tilesetLib.noMatch")}</div>;
  }

  const groupHeader = (name: string, label: string, count: number, extra?: ReactNode, props?: object) => {
    const isCollapsed = collapsed.includes(name);
    return (
      <div
        className="sticky top-0 z-20 flex items-center gap-1 border-b border-line-subtle bg-panel pr-2 pl-1"
        style={{ height: HEADER_H }}
        data-group-header={name}
        {...props}
      >
        <button
          type="button"
          aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? t("tilesetLib.groupExpand") : t("tilesetLib.groupCollapse")}
          onClick={() => toggleCollapsed(name)}
          className="grid size-5 shrink-0 place-items-center rounded-sm text-faint hover:bg-hover hover:text-text"
        >
          <Icon name={isCollapsed ? "chevronRight" : "chevronDown"} size={13} />
        </button>
        {extra ?? <span className="min-w-0 flex-1 truncate text-2xs font-semibold tracking-wide text-muted uppercase select-none">{label}</span>}
        <span className="shrink-0 font-mono text-2xs text-faint tabular">{count}</span>
      </div>
    );
  };

  return (
    <div ref={rootRef} onDragEnd={() => (setDragId(null), setOver(null))}>
      {shownPalettes.length > 0 && (
        <div data-tileset-group={PALETTE_GROUP} data-group-labelled="">
          {groupHeader(PALETTE_GROUP, t("palettes.title"), shownPalettes.length)}
          {!collapsed.includes(PALETTE_GROUP) &&
            shownPalettes.map((p) => {
              const key = paletteKey(p.id);
              const own = zoomMap[key];
              return (
                <section key={p.id} data-tileset-section={key} aria-label={p.name}>
                  <div
                    className="sticky z-10 flex items-center gap-1.5 border-b border-line-subtle bg-panel/95 pr-2 pl-2 backdrop-blur-sm"
                    style={{ top: HEADER_H, height: HEADER_H }}
                    data-palette-header={p.id}
                    data-palette-drop={p.id}
                  >
                    <Icon name="grid" size={13} className="shrink-0 text-faint" />
                    <span className="min-w-0 flex-1 truncate text-sm text-muted">{p.name}</span>
                    {own != null && (
                      <button
                        type="button"
                        title={t("tilesetLib.zoomOverrideReset")}
                        onClick={() => onResetZoom(key)}
                        className="flex h-5 shrink-0 items-center gap-0.5 rounded-sm bg-accent-soft px-1 font-mono text-2xs text-accent tabular"
                      >
                        {zoomLabel(own)}
                        <Icon name="x" size={10} />
                      </button>
                    )}
                    <span className="shrink-0 font-mono text-2xs text-faint tabular">{p.cells.length}</span>
                  </div>
                  <div style={{ padding: `8px ${PADDING}px` }}>
                    <div style={{ marginLeft: paletteOffsetX(p), width: "max-content" }}>
                      <PaletteGrid palette={p} scale={scaleOfPalette(p)} />
                    </div>
                  </div>
                </section>
              );
            })}
        </div>
      )}
      {groups.map((group) => {
        const isCollapsed = labelled && collapsed.includes(group.name);
        const groupTarget = { group: group.name, beforeId: null };
        const overGroup = over && over.group === group.name && over.beforeId === null;
        return (
          <div key={group.name || "\u0000"} data-tileset-group={group.name} data-group-labelled={labelled ? "" : undefined}>
            {labelled &&
              groupHeader(
                group.name,
                group.name === UNGROUPED ? t("tilesetLib.ungrouped") : group.name,
                group.tilesets.length,
                renaming === group.name ? (
                  <RenameInput
                    initial={group.name}
                    label={t("tilesetLib.groupName")}
                    onDone={(name) => {
                      setRenaming(null);
                      if (name) renameTilesetGroup(group.name, name);
                    }}
                  />
                ) : (
                  <span
                    className={`min-w-0 flex-1 truncate text-2xs font-semibold tracking-wide text-muted select-none ${overGroup ? "text-accent" : ""}`}
                    title={group.name === UNGROUPED ? undefined : t("tilesetLib.groupRenameHint")}
                    onDoubleClick={() => group.name !== UNGROUPED && setRenaming(group.name)}
                    data-group-name
                  >
                    {group.name === UNGROUPED ? (shownPalettes.length > 0 ? t("tilesetDock.tilesets") : t("tilesetLib.ungrouped")) : group.name}
                  </span>
                ),
                dragProps(groupTarget),
              )}
            {!isCollapsed &&
              group.tilesets.map((ts) => {
                const target = { group: group.name, beforeId: ts.id };
                const overThis = over && over.group === group.name && over.beforeId === ts.id && dragId !== ts.id;
                const own = zoomMap[ts.id];
                return (
                  <section key={ts.id} data-tileset-section={ts.id} aria-label={ts.name}>
                    <TilesetContextMenu tileset={ts}>
                      <ContextMenu.Trigger
                        render={
                          <div
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData(DRAG_TYPE, ts.id);
                              e.dataTransfer.effectAllowed = "move";
                              setDragId(ts.id);
                            }}
                            onClick={() => {
                              showPalette(null);
                              useUiStore.getState().setActiveTileset(ts.id);
                            }}
                            className={`sticky z-10 flex cursor-grab items-center gap-1.5 border-b border-line-subtle bg-panel/95 pr-2 pl-1.5 backdrop-blur-sm active:cursor-grabbing ${
                              overThis ? "shadow-[inset_0_2px_0_var(--color-accent)]" : ""
                            } ${dragId === ts.id ? "opacity-50" : ""}`}
                            style={{ top: labelled ? HEADER_H : 0, height: HEADER_H }}
                            data-tileset-header={ts.id}
                            {...dragProps(target)}
                          />
                        }
                      >
                        <Icon name="grip" size={12} className="shrink-0 text-faint" />
                        <TilesetThumb tileset={ts} size={16} />
                        <span className={`min-w-0 flex-1 truncate text-sm ${ts.id === activeId ? "text-text" : "text-muted"}`}>{ts.name}</span>
                        {own != null && (
                          <button
                            type="button"
                            title={t("tilesetLib.zoomOverrideReset")}
                            data-tileset-zoom-override={ts.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              onResetZoom(ts.id);
                            }}
                            className="flex h-5 shrink-0 items-center gap-0.5 rounded-sm bg-accent-soft px-1 font-mono text-2xs text-accent tabular"
                          >
                            {zoomLabel(own)}
                            <Icon name="x" size={10} />
                          </button>
                        )}
                        <span className="shrink-0 font-mono text-2xs text-faint tabular">
                          {ts.tileWidth === ts.tileHeight ? `${ts.tileWidth}px · ` : `${ts.tileWidth}×${ts.tileHeight} · `}
                          {ts.columns}×{ts.rows}
                        </span>
                      </ContextMenu.Trigger>
                    </TilesetContextMenu>
                    <div style={{ padding: `8px ${PADDING}px` }}>
                      <div style={{ marginLeft: offsetX(ts), width: "max-content" }}>
                        <TilesetGrid tileset={ts} scale={scaleOf(ts)} />
                      </div>
                    </div>
                  </section>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ dock tab

/** "+" in the dock's tab strip while the Tileset tab is open. */
function DockActions() {
  const setSlot = useCallback((el: HTMLDivElement | null) => useTilesetView.getState().setDockSlot(el), []);
  return (
    <>
      {/* The tileset view portals its zoom controls in here. */}
      <div ref={setSlot} className="flex items-center" data-tileset-dock-actions />
      <Tooltip label={t("tileset.add")}>
        <IconButton aria-label={t("tileset.add")} className="size-7" data-tileset-add onClick={() => void openTilesetImport()}>
          <Icon name="plus" size={15} />
        </IconButton>
      </Tooltip>
    </>
  );
}

registerDockTab({ id: "tileset", label: "layout.dockTileset", order: 10, Component: TilesetDockTab, Actions: DockActions });
