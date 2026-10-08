/**
 * The tileset library: one tileset at a time ("Tek") or every tileset
 * stacked in one scroll with sticky group / tileset headers ("Tümü").
 *
 * The scroll viewport is the host of the grids (see `TilesetGrid`): it
 * owns zoom ("Tek": the map's wheel model at the cursor; "Tümü": the wheel
 * scrolls, Ctrl / pinch zooms; a global zoom in the footer plus a
 * per-tileset override), hand panning (Space / middle drag),
 * keyboard routing and the placed terrain block.
 */
import type { Tileset } from "@smap/core";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";

import { dropTileset, gotoTileset, openTilesetImport, renameTilesetGroup } from "../../commands/tilesetActions";
import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { useStructureVersion } from "../hooks";
import { IconButton } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { RenameInput } from "../primitives/RenameInput";
import { Tooltip } from "../primitives/Tooltip";
import { TerrainDefineBar } from "../terrain/TerrainDefineBar";
import { TerrainSets } from "../terrain/TerrainList";
import { bestMatch, effectiveZoom, filterTilesets, groupTilesets, UNGROUPED, type DropTarget } from "../tileset/libraryModel";
import { MODE_HINT } from "../tileset/modeModel";
import { ModeTabs } from "../tileset/ModeTabs";
import { registerSelectionSection } from "../tileset/SelectionSection";
import { GridHostContext, TilesetGrid, type GridHost, type PendingBlock } from "../tileset/TilesetGrid";
import { ModeBar } from "../tileset/TilesetOverlays";
import { installTilesetPickSync } from "../tileset/tilesetSelect";
import { TilesetContextMenu, TilesetSwitcher, TilesetThumb } from "../tileset/TilesetSwitcher";
import { useTilesetView } from "../tileset/tilesetViewStore";
import { usePanDrag } from "../tileset/usePanDrag";
import { accumulateWheelZoom, fitScale, MAX_ZOOM, MIN_ZOOM, PAN_GESTURE_MS, stackWheel, stepZoom, tilesetWheel, ZOOM_STEPS, zoomLabel } from "../tileset/zoomModel";
import { useUiStore } from "../uiStore";
import { widenLibraryTarget } from "../layout/columns";
import { useLayoutStore, wantedLibraryWidth } from "../layout/layoutStore";
import { ContextMenu } from "@base-ui/react/context-menu";
import { LibraryTabs } from "./LibraryPanel";
import { PanelSection } from "./PanelSection";

// Map picks reveal their tiles here, and the inspector shows the selection, even while another library tab is open.
installTilesetPickSync();
registerSelectionSection();

/** Space around a tileset inside the scroll area (CSS px). */
const PADDING = 10;
/** Height of a sticky group / tileset header in "Tümü" (CSS px). */
const HEADER_H = 28;
const DRAG_TYPE = "application/x-smap-tileset";

export function TilesetPanel() {
  const store = useEditorStore((s) => s.project?.store);
  const activeId = useUiStore((s) => s.activeTilesetId);
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
      {active ? <TilesetLibrary tilesets={tilesets} active={active} /> : <EmptyTilesets />}
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

function TilesetLibrary({ tilesets, active }: { tilesets: readonly Tileset[]; active: Tileset }) {
  const view = useTilesetView((s) => s.view);
  const zoomMap = useTilesetView((s) => s.zoom);
  const globalZoom = useTilesetView((s) => s.globalZoom);
  const mode = useUiStore((s) => s.tilesetMode);
  const setMode = useUiStore((s) => s.setTilesetMode);
  const template = useUiStore((s) => s.terrainTemplate);
  const setActive = useUiStore((s) => s.setActiveTileset);
  const randomSet = useEditorStore((s) => s.randomSet);
  const stack = view === "all";

  const viewportRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const availWidth = Math.max(0, stack ? width - 2 * PADDING : width);
  const [pending, setPending] = useState<PendingBlock | null>(null);
  const keyHandlers = useRef(new Map<string, (e: KeyboardEvent) => boolean>());
  const pan = usePanDrag(viewportRef);
  const panRef = useRef(pan);
  panRef.current = pan;

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const scaleOf = useCallback(
    (ts: Tileset) => effectiveZoom(zoomMap[ts.id], globalZoom, fitScale(availWidth, ts.columns * ts.tileWidth, ts.tileWidth)),
    [zoomMap, globalZoom, availWidth],
  );

  // ---- host for the grids

  const host = useMemo(
    (): GridHost => ({
      focus: () => viewportRef.current?.focus({ preventScroll: true }),
      panning: () => panRef.current.active(),
      registerKeys: (id, handler) => {
        if (handler) keyHandlers.current.set(id, handler);
        else keyHandlers.current.delete(id);
      },
      pending,
      setPending,
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
    [pending, stack],
  );

  // A placed block belongs to one template; leaving terrain mode drops it.
  useEffect(() => {
    if (mode !== "terrain") setPending(null);
  }, [mode]);

  // ---- zoom (anchored at the cursor)

  const setZoom = useTilesetView((s) => s.setZoom);
  const setGlobalZoom = useTilesetView((s) => s.setGlobalZoom);
  const anchorRef = useRef<{ id: string; ux: number; uy: number; cx: number; cy: number; scale: number } | null>(null);

  const gridEl = (id: string) => viewportRef.current?.querySelector<HTMLElement>(`[data-tileset-grid="${CSS.escape(id)}"]`) ?? null;

  /** Remembers the content point under (`cx`, `cy`) of tileset `id` so it stays put across the zoom. */
  const anchor = (id: string, cx?: number, cy?: number) => {
    const el = gridEl(id);
    const vp = viewportRef.current;
    const ts = tilesets.find((x) => x.id === id);
    if (!el || !vp || !ts) return;
    const r = el.getBoundingClientRect();
    const v = vp.getBoundingClientRect();
    const x = cx ?? Math.min(r.right, Math.max(r.left, v.left + v.width / 2));
    const y = cy ?? Math.min(r.bottom, Math.max(r.top, v.top + v.height / 2));
    const scale = scaleOf(ts);
    anchorRef.current = { id, ux: (x - r.left) / scale, uy: (y - r.top) / scale, cx: x, cy: y, scale };
  };

  /** Sets tileset `id`'s own zoom (null = back to the global zoom). */
  const zoomTileset = (id: string, next: number | null, cx?: number, cy?: number) => {
    const ts = tilesets.find((x) => x.id === id);
    if (!ts) return;
    const now = scaleOf(ts);
    const then = effectiveZoom(next, globalZoom, fitScale(availWidth, ts.columns * ts.tileWidth, ts.tileWidth));
    if (Math.abs(now - then) > 1e-6) anchor(id, cx, cy);
    setZoom(id, next);
  };

  /** The global zoom; in "Tek" it also drops the shown tileset's own zoom (the slider always moves what you see). */
  const zoomGlobal = (next: number | null) => {
    const vp = viewportRef.current;
    let id: string | null = active.id;
    if (stack && vp) {
      const v = vp.getBoundingClientRect();
      const hit = document.elementFromPoint(v.left + v.width / 2, v.top + v.height / 2)?.closest("[data-tileset-grid]");
      id = hit?.getAttribute("data-tileset-grid") ?? null;
    }
    if (id) anchor(id);
    if (!stack) setZoom(active.id, null);
    setGlobalZoom(next);
  };

  useLayoutEffect(() => {
    const a = anchorRef.current;
    const vp = viewportRef.current;
    if (!a || !vp) return;
    const el = gridEl(a.id);
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
      if (r.step !== 0) zoomGlobal(stepZoom(globalZoom ?? scaleOf(active), r.step));
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
    // Zoom the shown tileset at the cursor (its own zoom).
    zoomTileset(active.id, stepZoom(scaleOf(active), r.step), e.clientX, e.clientY);
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
      if (pending || mode !== "pick") {
        event.preventDefault();
        event.stopPropagation();
        if (pending) setPending(null);
        else setMode("pick");
      }
      return;
    }
    const target = panelSelection?.tilesetId && keyHandlers.current.has(panelSelection.tilesetId) ? panelSelection.tilesetId : active.id;
    if (keyHandlers.current.get(target)?.(event)) event.preventDefault();
  };

  // ---- footer state

  const override = !stack ? (zoomMap[active.id] ?? null) : null;
  const shownScale = stack ? (globalZoom ?? scaleOf(active)) : scaleOf(active);
  const contentW = active.columns * active.tileWidth;
  const widenExtra = !stack && zoomMap[active.id] == null && globalZoom === null && availWidth > 0 && contentW > availWidth ? contentW - availWidth : 0;
  const canWiden = useLayoutStore(
    (s) =>
      widenExtra > 0 &&
      widenLibraryTarget(window.innerWidth, { library: wantedLibraryWidth(s, window.innerWidth), right: s.rightWidth }, widenExtra) !== null,
  );
  const solidCount = active.solidTiles?.length ?? 0;
  const pendingTileset = (pending && tilesets.find((ts) => ts.id === pending.tilesetId)) || active;
  const pendingCell = pending && pending.template === template ? pending.cell : null;
  const offsetX = (ts: Tileset) => Math.max(0, Math.floor((availWidth - Math.round(ts.columns * ts.tileWidth * scaleOf(ts))) / 2));

  return (
    <GridHostContext.Provider value={host}>
      <div className="relative flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
        {stack ? (
          <LibrarySearch tilesets={tilesets} trailing={<ViewToggle />} />
        ) : (
          <TilesetSwitcher tilesets={tilesets} active={active} onSelect={setActive} trailing={<ViewToggle />} />
        )}
        <ModeTabs mode={mode} onChange={setMode} />
        {mode === "pick" && (
          <div className="mx-3 mb-1 shrink-0 text-2xs leading-4 text-pretty text-faint" data-tileset-hint>
            {t("tilesetPanel.hintSelect")}
          </div>
        )}
        {mode === "solid" && (
          <ModeBar icon="bricks" tone="solid" onDone={() => setMode("pick")}>
            <span className="min-w-0 flex-1 text-xs leading-4 text-muted" data-tileset-hint>
              {t(MODE_HINT.solid)}
            </span>
            {!stack && <span className="shrink-0 font-mono text-2xs text-faint tabular">{t("tileset.solidCount", { count: solidCount })}</span>}
          </ModeBar>
        )}
        {mode === "random" && (
          <ModeBar icon="dice" tone="random" onDone={() => setMode("pick")}>
            <span className="min-w-0 flex-1 text-xs leading-4 text-muted" data-tileset-hint>
              {t(MODE_HINT.random)}
            </span>
            {randomSet.length >= 2 && <span className="shrink-0 font-mono text-2xs text-faint tabular">{t("tileset.randomCount", { count: randomSet.length })}</span>}
          </ModeBar>
        )}
        {mode === "terrain" && (
          <>
            <TerrainDefineBar
              tileset={pendingTileset}
              template={template}
              pending={pendingCell}
              problem={null}
              onCancel={() => setPending(null)}
              onDone={() => setMode("pick")}
            />
            {!pendingCell && (
              <div className="mx-3 mb-1 shrink-0 text-2xs leading-4 text-pretty text-faint" data-tileset-hint>
                {t(MODE_HINT.terrain)}
              </div>
            )}
          </>
        )}
        {stack && <JumpChips tilesets={tilesets} activeId={active.id} />}
        <div
          ref={viewportRef}
          tabIndex={0}
          role={stack ? "region" : "grid"}
          aria-label={stack ? t("tilesetLib.allLabel") : active.name}
          aria-multiselectable={stack ? undefined : true}
          data-tileset-viewport
          data-tileset-scroll
          data-tileset-view={view}
          className={`relative min-h-0 flex-1 overflow-auto border-t border-line-subtle bg-bg/40 focus-visible:outline-offset-[-2px] ${pan.cursor}`}
          style={{ padding: stack ? 0 : PADDING, scrollbarGutter: "stable" }}
          {...pan.handlers}
        >
          {stack ? (
            <TilesetStack tilesets={tilesets} scaleOf={scaleOf} offsetX={offsetX} onResetZoom={(id) => zoomTileset(id, null)} />
          ) : (
            <div style={{ marginLeft: offsetX(active), width: "max-content" }}>
              <TilesetGrid key={active.id} tileset={active} scale={scaleOf(active)} />
            </div>
          )}
        </div>

        <TerrainSets />

        {stack && (
          // How the wheel behaves in the stacked list (it scrolls here, unlike "Tek").
          <div
            className="shrink-0 border-t border-line-subtle px-3 pt-1 text-2xs leading-4 text-pretty text-faint"
            title={t("tilesetLib.wheelHint")}
            data-tileset-wheel-hint
          >
            {t("tilesetLib.wheelHint")}
          </div>
        )}
        <div
          className={`flex h-8 shrink-0 items-center gap-2 pr-1.5 pl-3 text-xs text-faint ${stack ? "" : "border-t border-line-subtle"}`}
          data-tileset-footer
        >
          {stack ? (
            <span className="min-w-0 truncate">{t("tilesetLib.count", { count: tilesets.length })}</span>
          ) : (
            <>
              <span className="min-w-0 truncate">{t("tileset.tileCount", { count: active.columns * active.rows })}</span>
              <span className="font-mono tabular">
                {active.columns}×{active.rows}
              </span>
              {solidCount > 0 && mode !== "solid" && (
                <span className="flex min-w-0 items-center gap-1 truncate">
                  <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-collision-solid" />
                  {t("tileset.solidCount", { count: solidCount })}
                </span>
              )}
            </>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1" data-tileset-zoom>
            {override !== null && (
              <Tooltip label={t("tilesetLib.zoomOverrideReset")} side="top">
                <button
                  type="button"
                  data-tileset-zoom-override
                  onClick={() => zoomTileset(active.id, null)}
                  className="flex h-6 items-center gap-1 rounded-sm bg-accent-soft px-1.5 font-mono text-2xs text-accent tabular hover:brightness-110"
                >
                  {t("tilesetLib.zoomOverride", { zoom: zoomLabel(override) })}
                  <Icon name="x" size={11} />
                </button>
              </Tooltip>
            )}
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
            <ZoomSlider value={override ?? globalZoom} shown={shownScale} onChange={zoomGlobal} />
            <Tooltip label={t("tilesetPanel.zoomActual")} side="top">
              <button
                type="button"
                aria-label={t("tilesetPanel.zoomActual")}
                data-tileset-zoom-label
                onClick={() => zoomGlobal(1)}
                className="h-6 min-w-[40px] rounded-sm px-1 text-center font-mono text-xs text-muted tabular hover:bg-hover hover:text-text"
              >
                {zoomLabel(shownScale)}
              </button>
            </Tooltip>
            <Tooltip label={t("tilesetPanel.zoomFitTitle")} side="top">
              <button
                type="button"
                aria-pressed={globalZoom === null && override === null}
                onClick={() => zoomGlobal(null)}
                className={`h-6 rounded-sm px-1.5 text-xs transition-colors ${
                  globalZoom === null && override === null ? "bg-active text-text" : "text-muted hover:bg-hover hover:text-text"
                }`}
              >
                {t("tileset.zoomFit")}
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    </GridHostContext.Provider>
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
      className="h-6 w-16 min-w-0 accent-(--color-accent)"
    />
  );
}

/** "Tümü | Tek" segmented toggle (remembered); icons keep the switcher's name readable in a narrow column. */
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
      {option("all", t("tilesetLib.viewAllTitle"), "layers")}
      {option("single", t("tilesetLib.viewSingleTitle"), "image")}
    </div>
  );
}

/** Search by name ("Tümü"): filters the stack; Enter jumps to the best match; Esc clears. */
function LibrarySearch({ tilesets, trailing }: { tilesets: readonly Tileset[]; trailing: React.ReactNode }) {
  const query = useTilesetView((s) => s.query);
  const setQuery = useTilesetView((s) => s.setQuery);
  const focusNonce = useTilesetView((s) => s.searchFocus);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusNonce > 0) ref.current?.focus();
  }, [focusNonce]);
  return (
    <div className="flex shrink-0 items-center gap-1 px-2 pb-1.5">
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

/** One chip per tileset (search applied): a click jumps there. */
function JumpChips({ tilesets, activeId }: { tilesets: readonly Tileset[]; activeId: string }) {
  const query = useTilesetView((s) => s.query);
  const shown = filterTilesets(tilesets, query);
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
      {shown.map((ts) => (
        <button
          key={ts.id}
          type="button"
          data-tileset-chip={ts.id}
          title={ts.name}
          onClick={() => gotoTileset(ts.id)}
          className={`h-5 max-w-[120px] shrink-0 truncate rounded-full border px-2 text-2xs transition-colors ${
            ts.id === activeId ? "border-accent-line bg-accent-soft text-accent" : "border-line text-muted hover:border-line-strong hover:text-text"
          }`}
        >
          {ts.name}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ "Tümü"

function TilesetStack({
  tilesets,
  scaleOf,
  offsetX,
  onResetZoom,
}: {
  tilesets: readonly Tileset[];
  scaleOf(ts: Tileset): number;
  offsetX(ts: Tileset): number;
  onResetZoom(id: string): void;
}) {
  const query = useTilesetView((s) => s.query);
  const collapsed = useTilesetView((s) => s.collapsed);
  const toggleCollapsed = useTilesetView((s) => s.toggleCollapsed);
  const zoomMap = useTilesetView((s) => s.zoom);
  const jump = useTilesetView((s) => s.jump);
  const activeId = useUiStore((s) => s.activeTilesetId);
  const shown = filterTilesets(tilesets, query);
  const groups = groupTilesets(shown);
  const labelled = groups.some((g) => g.name !== UNGROUPED);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<DropTarget | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Jump requests (goto, chips, search Enter): open its group, then bring its header to the top.
  const jumped = useRef(0);
  useLayoutEffect(() => {
    if (!jump || jumped.current === jump.nonce) return;
    const ts = tilesets.find((x) => x.id === jump.tilesetId);
    if (!ts) return;
    const group = ts.group ?? UNGROUPED;
    if (labelled && collapsed.includes(group)) {
      toggleCollapsed(group);
      return;
    }
    const vp = rootRef.current?.closest<HTMLElement>("[data-tileset-scroll]");
    const section = rootRef.current?.querySelector<HTMLElement>(`[data-tileset-section="${CSS.escape(ts.id)}"]`);
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

  if (shown.length === 0) {
    return <div className="px-4 py-8 text-center text-sm text-faint">{t("tilesetLib.noMatch")}</div>;
  }

  return (
    <div ref={rootRef} onDragEnd={() => (setDragId(null), setOver(null))}>
      {groups.map((group) => {
        const isCollapsed = labelled && collapsed.includes(group.name);
        const groupTarget = { group: group.name, beforeId: null };
        const overGroup = over && over.group === group.name && over.beforeId === null;
        return (
          <div key={group.name || "\u0000"} data-tileset-group={group.name} data-group-labelled={labelled ? "" : undefined}>
            {labelled && (
              <div
                className={`sticky top-0 z-20 flex items-center gap-1 border-b border-line-subtle bg-panel pr-2 pl-1 ${overGroup ? "shadow-[inset_0_-2px_0_var(--color-accent)]" : ""}`}
                style={{ height: HEADER_H }}
                data-group-header={group.name}
                {...dragProps(groupTarget)}
              >
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  aria-label={isCollapsed ? t("tilesetLib.groupExpand") : t("tilesetLib.groupCollapse")}
                  onClick={() => toggleCollapsed(group.name)}
                  className="grid size-5 shrink-0 place-items-center rounded-sm text-faint hover:bg-hover hover:text-text"
                >
                  <Icon name={isCollapsed ? "chevronRight" : "chevronDown"} size={13} />
                </button>
                {renaming === group.name ? (
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
                    className="min-w-0 flex-1 truncate text-2xs font-semibold tracking-wide text-muted select-none"
                    title={group.name === UNGROUPED ? undefined : t("tilesetLib.groupRenameHint")}
                    onDoubleClick={() => group.name !== UNGROUPED && setRenaming(group.name)}
                    data-group-name
                  >
                    {group.name === UNGROUPED ? t("tilesetLib.ungrouped") : group.name}
                  </span>
                )}
                <span className="shrink-0 font-mono text-2xs text-faint tabular">{group.tilesets.length}</span>
              </div>
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
                            onClick={() => useUiStore.getState().setActiveTileset(ts.id)}
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
