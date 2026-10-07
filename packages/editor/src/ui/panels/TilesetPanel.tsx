import { isTileSolid, terrainTemplateInfo, type TerrainTemplate, type Tileset } from "@smap/core";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import { runCommand } from "../../commands/registry";
import { SolidStroke } from "../../commands/solidStroke";
import {
  activateTerrain,
  defineTerrain,
  terrainBlockProblem,
  tileLayerForPick,
  uniqueTerrainName,
} from "../../commands/terrainActions";
import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { useStructureVersion, useTilesetImage } from "../hooks";
import { Button, IconButton } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { Tooltip } from "../primitives/Tooltip";
import { TemplatePicker } from "../terrain/TemplatePicker";
import { TerrainList, useActiveTerrainId } from "../terrain/TerrainList";
import { templateGlyphs } from "../terrain/templateGlyph";
import { toast } from "../toast/toastStore";
import { useUiStore, type TilesetMode } from "../uiStore";
import { toggleRandomTile } from "../../commands/randomBrush";
import { LibraryTabs } from "./LibraryPanel";
import { PanelSection } from "./PanelSection";

const PADDING = 12;
const MAX_FIT_SCALE = 4;
const ZOOM_STEPS = [0.25, 0.5, 1, 2, 3, 4, 6, 8];

interface TileCell {
  col: number;
  row: number;
}

export function TilesetPanel() {
  const store = useEditorStore((s) => s.project?.store);
  const activeId = useUiStore((s) => s.activeTilesetId);
  const setActive = useUiStore((s) => s.setActiveTileset);
  const mode = useUiStore((s) => s.tilesetMode);
  const toggleMode = useUiStore((s) => s.toggleTilesetMode);
  useStructureVersion(store);
  const tilesets = store?.document.tilesets ?? [];
  const active = tilesets.find((ts) => ts.id === activeId) ?? tilesets[0];

  return (
    <PanelSection
      title={t("panels.tileset")}
      heading={<LibraryTabs />}
      className="min-h-[160px] flex-1"
      actions={
        <>
          {active && (
            <>
              <ModeButton mode="solid" current={mode} icon="bricks" label={t("tileset.solidMode")} onClick={toggleMode} />
              <ModeButton mode="terrain" current={mode} icon="terrain" label={t("tileset.terrainMode")} onClick={toggleMode} />
              <ModeButton mode="random" current={mode} icon="dice" label={t("tileset.randomMode")} onClick={toggleMode} />
              <div aria-hidden className="mx-0.5 h-4 w-px bg-line" />
            </>
          )}
          <Tooltip label={t("tileset.add")}>
            <IconButton aria-label={t("tileset.add")} className="size-7" onClick={() => runCommand("tileset.add")}>
              <Icon name="plus" size={15} />
            </IconButton>
          </Tooltip>
        </>
      }
    >
      {tilesets.length > 1 && (
        <div role="tablist" className="flex shrink-0 gap-1 overflow-x-auto px-2 pb-2">
          {tilesets.map((ts) => (
            <button
              key={ts.id}
              role="tab"
              type="button"
              aria-selected={ts.id === active?.id}
              onClick={() => setActive(ts.id)}
              className={`h-6 shrink-0 rounded-sm px-2 text-sm whitespace-nowrap transition-colors ${
                ts.id === active?.id ? "bg-active text-text" : "text-muted hover:bg-hover hover:text-text"
              }`}
            >
              {ts.name}
            </button>
          ))}
        </div>
      )}
      {active ? <TilesetView key={active.id} tileset={active} /> : <EmptyTilesets />}
    </PanelSection>
  );
}

function ModeButton({
  mode,
  current,
  icon,
  label,
  onClick,
}: {
  mode: TilesetMode;
  current: TilesetMode;
  icon: "bricks" | "terrain" | "dice";
  label: string;
  onClick(mode: TilesetMode): void;
}) {
  const on = current === mode;
  return (
    <Tooltip label={label}>
      <IconButton aria-label={label} aria-pressed={on} active={on} className="size-7" onClick={() => onClick(mode)}>
        <Icon name={icon} size={15} />
      </IconButton>
    </Tooltip>
  );
}

function EmptyTilesets() {
  return (
    <div className="mx-3 mb-3 flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong px-4 text-center">
      <Icon name="image" size={22} className="text-faint" />
      <div className="text-md text-muted">{t("tileset.empty")}</div>
      <div className="text-xs text-faint">{t("tileset.emptyHint")}</div>
    </div>
  );
}

/** `#rrggbb` CSS variable → `[r, g, b]`. */
function cssColor(name: string, fallback: [number, number, number]): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
  if (!m) return fallback;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Solid tiles on top of the tileset image. In "Katı işaretle" mode: tinted,
 * hatched and outlined; otherwise a small corner mark so the state stays
 * visible without getting in the way.
 */
function drawSolidOverlay(
  canvas: HTMLCanvasElement,
  tileset: Tileset,
  cellW: number,
  cellH: number,
  cssW: number,
  cssH: number,
  marking: boolean,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.max(1, Math.round(cssH * dpr));
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const solid = tileset.solidTiles ?? [];
  if (solid.length === 0) return;
  const [r, g, b] = cssColor("--color-collision-solid", [255, 84, 104]);
  const rgba = (a: number) => `rgba(${r}, ${g}, ${b}, ${a})`;
  const cw = cellW * dpr;
  const ch = cellH * dpr;
  if (!marking && Math.min(cellW, cellH) < 10) return;
  for (const id of solid) {
    const col = id % tileset.columns;
    const row = Math.floor(id / tileset.columns);
    const x0 = Math.round(col * cw);
    const y0 = Math.round(row * ch);
    const x1 = Math.round((col + 1) * cw);
    const y1 = Math.round((row + 1) * ch);
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

function TilesetView({ tileset }: { tileset: Tileset }) {
  const image = useTilesetImage(tileset.id);
  const store = useEditorStore((s) => s.project?.store);
  const selection = useEditorStore((s) => s.selection);
  const setSelection = useEditorStore((s) => s.setSelection);
  const setTool = useEditorStore((s) => s.setTool);
  const mode = useUiStore((s) => s.tilesetMode);
  const setMode = useUiStore((s) => s.setTilesetMode);
  const template = useUiStore((s) => s.terrainTemplate);
  const activeTerrainId = useActiveTerrainId();

  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const solidRef = useRef<HTMLCanvasElement>(null);
  const strokeRef = useRef<SolidStroke | null>(null);
  const [availWidth, setAvailWidth] = useState(0);
  const [zoom, setZoom] = useState<number | null>(null); // null = fit
  const [hover, setHover] = useState<TileCell | null>(null);
  /** Terrain block placed with a click, waiting for its name. */
  const [pending, setPending] = useState<TileCell | null>(null);

  const imgW = image?.bitmap.width ?? tileset.columns * tileset.tileWidth;
  const imgH = image?.bitmap.height ?? tileset.rows * tileset.tileHeight;
  // contentRect excludes the padding already.
  const fit = availWidth > 0 ? availWidth / imgW : 1;
  const fitScale = fit >= 1 ? Math.min(MAX_FIT_SCALE, Math.floor(fit)) : fit;
  const scale = zoom ?? fitScale;
  const cssW = Math.round(imgW * scale);
  const cssH = Math.round(imgH * scale);
  const cellW = tileset.tileWidth * scale;
  const cellH = tileset.tileHeight * scale;

  // A placed block belongs to one mode / template.
  useEffect(() => setPending(null), [mode, template]);
  // A stroke never outlives the view.
  useEffect(() => () => strokeRef.current?.end(), []);

  // Track the panel width for zoom-to-fit.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setAvailWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Ctrl+wheel zooms the tileset (native listener: React wheel handlers are passive).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom((z) => {
        const currentScale = z ?? fitScale;
        const next =
          event.deltaY < 0
            ? ZOOM_STEPS.find((s) => s > currentScale + 1e-6)
            : [...ZOOM_STEPS].reverse().find((s) => s < currentScale - 1e-6);
        return next ?? currentScale;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [fitScale]);

  // Draw the image crisply at device resolution.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !image) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image.bitmap, 0, 0, canvas.width, canvas.height);
  }, [image, cssW, cssH]);

  // Solid marks.
  useEffect(() => {
    if (solidRef.current) drawSolidOverlay(solidRef.current, tileset, cellW, cellH, cssW, cssH, mode === "solid");
  }, [tileset, cellW, cellH, cssW, cssH, mode, image]);

  /** Tile under the pointer, not clamped (may be outside the tileset). */
  const rawCellAt = (event: PointerEvent<HTMLElement>): TileCell => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      col: Math.floor((event.clientX - rect.left) / cellW),
      row: Math.floor((event.clientY - rect.top) / cellH),
    };
  };
  const inside = (c: TileCell) => c.col >= 0 && c.row >= 0 && c.col < tileset.columns && c.row < tileset.rows;
  const cellAt = (event: PointerEvent<HTMLElement>): TileCell | null => {
    const c = rawCellAt(event);
    return inside(c) ? c : null;
  };

  // The pointer stays over the canvas across a mode switch (shortcut, layout shift under it), so no
  // pointermove arrives: re-derive the hovered tile from the last known pointer position.
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const p = pointerRef.current;
    const el = gridRef.current;
    if (!p || !el) return;
    const rect = el.getBoundingClientRect();
    const c = { col: Math.floor((p.x - rect.left) / cellW), row: Math.floor((p.y - rect.top) / cellH) };
    const next = inside(c) ? c : null;
    setHover((h) => (h?.col === next?.col && h?.row === next?.row ? h : next));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `inside` only reads the tileset grid
  }, [mode, template, cellW, cellH, cssW, tileset.columns, tileset.rows]);

  const select = (col: number, row: number) => {
    // A normal pick is a single tile: it ends a random brush and a stamp on the brush.
    useEditorStore.getState().setRandomSet([]);
    useEditorStore.getState().setStamp(null);
    setSelection({ tilesetId: tileset.id, tileId: row * tileset.columns + col });
    // Picking a tile while a terrain / collision layer is active: paint it on a tile layer.
    const state = useEditorStore.getState();
    const doc = state.project?.store.document;
    const target = doc ? tileLayerForPick(doc, state.activeLayerId) : null;
    if (target) state.setActiveLayer(target);
    setTool("brush");
  };

  const randomSet = useEditorStore((s) => s.randomSet);
  const randomHere = randomSet.length >= 2 ? randomSet.filter((r) => r.tilesetId === tileset.id) : [];
  const selected =
    randomSet.length < 2 && selection && selection.tilesetId === tileset.id
      ? { col: selection.tileId % tileset.columns, row: Math.floor(selection.tileId / tileset.columns) }
      : null;

  // Terrain placement.
  const info = terrainTemplateInfo(template);
  const blockAt = mode === "terrain" ? (pending ?? hover) : null;
  const tooSmall = mode === "terrain" ? terrainBlockProblem(tileset, template, 0, 0) : null;
  const blockProblem = blockAt ? terrainBlockProblem(tileset, template, blockAt.col, blockAt.row) : null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && (pending || mode !== "pick")) {
      event.preventDefault();
      event.stopPropagation();
      if (pending) setPending(null);
      else setMode("pick");
      return;
    }
    // Arrow keys move the selection while the tileset view has focus.
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const d = delta[event.key];
    if (!d || event.ctrlKey || event.metaKey || event.altKey || mode !== "pick") return;
    event.preventDefault();
    const from = selected ?? { col: 0, row: 0 };
    const col = Math.min(tileset.columns - 1, Math.max(0, from.col + (selected ? d[0] : 0)));
    const row = Math.min(tileset.rows - 1, Math.max(0, from.row + (selected ? d[1] : 0)));
    select(col, row);
    viewportRef.current
      ?.querySelector<HTMLElement>("[data-selected-tile]")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const cell = cellAt(e);
    if (!cell) return;
    if (mode === "random" || (e.altKey && mode === "pick")) {
      toggleRandomTile({ tilesetId: tileset.id, tileId: cell.row * tileset.columns + cell.col });
    } else if (mode === "pick") {
      select(cell.col, cell.row);
    } else if (mode === "solid") {
      if (!store || store.inTransaction || !store.document.getTileset(tileset.id)) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      strokeRef.current = new SolidStroke(store, tileset.id, cell.col, cell.row);
    } else if (terrainBlockProblem(tileset, template, cell.col, cell.row) === null) {
      setPending(cell);
    }
  };
  const endStroke = () => {
    strokeRef.current?.end();
    strokeRef.current = null;
  };

  const solidCount = tileset.solidTiles?.length ?? 0;
  const cursor = mode === "pick" || mode === "random" ? "cursor-pointer" : mode === "terrain" && blockProblem ? "cursor-not-allowed" : "cursor-crosshair";

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {mode === "solid" && (
        <ModeBar icon="bricks" tone="solid" onDone={() => setMode("pick")}>
          <span className="min-w-0 flex-1 text-xs leading-4 text-muted">{t("tileset.solidModeHint")}</span>
          <span className="shrink-0 font-mono text-2xs text-faint tabular">{t("tileset.solidCount", { count: solidCount })}</span>
        </ModeBar>
      )}
      {mode === "random" && (
        <ModeBar icon="dice" tone="random" onDone={() => setMode("pick")}>
          <span className="min-w-0 flex-1 text-xs leading-4 text-muted">{t("tileset.randomModeHint")}</span>
          {randomSet.length >= 2 && (
            <span className="shrink-0 font-mono text-2xs text-faint tabular">{t("tileset.randomCount", { count: randomSet.length })}</span>
          )}
        </ModeBar>
      )}
      {mode === "terrain" && (
        <TerrainBar
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
        onKeyDown={onKeyDown}
        className="min-h-0 flex-1 overflow-auto rounded-sm focus-visible:outline-offset-[-2px]"
        style={{ padding: PADDING, paddingTop: mode === "pick" ? 0 : 8 }}
      >
        {image ? (
          <div
            ref={gridRef}
            className={`checker relative touch-none ${cursor}`}
            // Whole-pixel centering keeps tile edges crisp.
            style={{ width: cssW, height: cssH, marginLeft: Math.max(0, Math.floor((availWidth - cssW) / 2)) }}
            onPointerMove={(e) => {
              if (strokeRef.current) {
                const c = rawCellAt(e);
                strokeRef.current.moveTo(c.col, c.row);
              }
              pointerRef.current = { x: e.clientX, y: e.clientY };
              const cell = cellAt(e);
              setHover((h) => (h?.col === cell?.col && h?.row === cell?.row ? h : cell));
            }}
            onPointerLeave={() => {
              pointerRef.current = null;
              setHover(null);
            }}
            onPointerDown={onPointerDown}
            onPointerUp={endStroke}
            onPointerCancel={endStroke}
            onLostPointerCapture={endStroke}
          >
            <canvas ref={canvasRef} role="img" aria-label={t("tileset.preview")} className="absolute inset-0 block size-full pixelated" />
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
            <canvas ref={solidRef} aria-hidden className="pointer-events-none absolute inset-0 block size-full" />
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
            {(mode === "pick" || mode === "random") && hover && (hover.col !== selected?.col || hover.row !== selected?.row) && (
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
            {mode === "pick" && selected && (
              <div
                data-selected-tile
                aria-hidden
                className="pointer-events-none absolute rounded-[1px] shadow-[0_0_0_1px_var(--color-bg),inset_0_0_0_1px_var(--color-bg)] outline-2 outline-accent"
                style={{
                  left: selected.col * cellW,
                  top: selected.row * cellH,
                  width: cellW,
                  height: cellH,
                  outlineStyle: "solid",
                  outlineOffset: -1,
                }}
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
          </div>
        ) : (
          <div className="py-6 text-center text-sm text-faint">
            {t("tileset.missingImage", { path: tileset.imagePath })}
          </div>
        )}
      </div>

      <TerrainList tileset={tileset} />

      <div className="flex h-7 shrink-0 items-center gap-2 border-t border-line-subtle px-3 text-xs text-faint">
        <span className="truncate">{t("tileset.tileCount", { count: tileset.columns * tileset.rows })}</span>
        <span className="font-mono tabular">
          {tileset.columns}×{tileset.rows}
        </span>
        {solidCount > 0 && mode !== "solid" && (
          <span className="flex items-center gap-1 truncate">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-collision-solid" />
            {t("tileset.solidCount", { count: solidCount })}
          </span>
        )}
        <span className="ml-auto font-mono tabular">{Math.round(scale * 100)}%</span>
        {zoom !== null && (
          <button
            type="button"
            onClick={() => setZoom(null)}
            className="rounded-xs px-1 text-muted hover:bg-hover hover:text-text"
          >
            {t("tileset.zoomFit")}
          </button>
        )}
      </div>
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

/** "Arazi tanımla": template picker, then the name of the placed block. */
function TerrainBar({
  tileset,
  template,
  pending,
  problem,
  onCancel,
  onDone,
}: {
  tileset: Tileset;
  template: TerrainTemplate;
  pending: TileCell | null;
  problem: string | null;
  onCancel(): void;
  onDone(): void;
}) {
  const setTemplate = useUiStore((s) => s.setTerrainTemplate);
  return (
    <div className="mx-2 mb-1 flex shrink-0 flex-col gap-1.5 rounded-md border border-line bg-raised p-1.5">
      <div className="flex items-center gap-1.5">
        <TemplatePicker value={template} onChange={setTemplate} />
        <Button variant="ghost" className="h-7 shrink-0 px-2 text-sm" onClick={onDone}>
          {t("tileset.done")}
        </Button>
      </div>
      {pending ? (
        <NameForm key={`${pending.col},${pending.row}`} tileset={tileset} template={template} origin={pending} onCancel={onCancel} onDone={onDone} />
      ) : problem ? (
        <div role="alert" className="flex items-start gap-1.5 px-0.5 text-xs leading-4 text-danger">
          <Icon name="alert" size={13} className="mt-px shrink-0" />
          {problem}
        </div>
      ) : (
        <div className="px-0.5 text-xs leading-4 text-muted">{t("tileset.terrainModeHint")}</div>
      )}
    </div>
  );
}

function NameForm({
  tileset,
  template,
  origin,
  onCancel,
  onDone,
}: {
  tileset: Tileset;
  template: TerrainTemplate;
  origin: TileCell;
  onCancel(): void;
  onDone(): void;
}) {
  const store = useEditorStore((s) => s.project?.store);
  const [name, setName] = useState(() => (store ? uniqueTerrainName(store.document) : ""));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const terrain = defineTerrain(tileset.id, template, origin, name);
    if (!terrain) return;
    onDone();
    toast.withAction(t("toast.terrainDefined", { name: terrain.name }), {
      label: t("terrain.paint"),
      run: () => activateTerrain(terrain.id),
    });
  };
  return (
    <form onSubmit={submit} className="flex items-center gap-1.5">
      <input
        autoFocus
        value={name}
        aria-label={t("terrain.name")}
        onChange={(e) => setName(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
        spellCheck={false}
        autoComplete="off"
        maxLength={64}
        className="h-7 min-w-0 flex-1 rounded-md border border-line bg-panel px-2 text-md text-text focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
      />
      <Button type="submit" variant="primary" className="h-7 px-2.5 text-sm">
        {t("terrain.define")}
      </Button>
      <Button variant="ghost" className="h-7 px-2 text-sm" onClick={onCancel}>
        {t("common.cancel")}
      </Button>
    </form>
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
