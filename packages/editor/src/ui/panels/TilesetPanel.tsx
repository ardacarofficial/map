import type { Tileset } from "@smap/core";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { runCommand } from "../../commands/registry";
import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { useStructureVersion, useTilesetImage } from "../hooks";
import { IconButton } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { Tooltip } from "../primitives/Tooltip";
import { useUiStore } from "../uiStore";
import { PanelSection } from "./PanelSection";

const PADDING = 12;
const MAX_FIT_SCALE = 4;
const ZOOM_STEPS = [0.25, 0.5, 1, 2, 3, 4, 6, 8];

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
      className="min-h-[160px] flex-1"
      actions={
        <Tooltip label={t("tileset.add")}>
          <IconButton aria-label={t("tileset.add")} className="size-7" onClick={() => runCommand("tileset.add")}>
            <Icon name="plus" size={15} />
          </IconButton>
        </Tooltip>
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

function EmptyTilesets() {
  return (
    <div className="mx-3 mb-3 flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong px-4 text-center">
      <Icon name="image" size={22} className="text-faint" />
      <div className="text-md text-muted">{t("tileset.empty")}</div>
      <div className="text-xs text-faint">{t("tileset.emptyHint")}</div>
    </div>
  );
}

function TilesetView({ tileset }: { tileset: Tileset }) {
  const image = useTilesetImage(tileset.id);
  const selection = useEditorStore((s) => s.selection);
  const setSelection = useEditorStore((s) => s.setSelection);
  const setTool = useEditorStore((s) => s.setTool);

  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [availWidth, setAvailWidth] = useState(0);
  const [zoom, setZoom] = useState<number | null>(null); // null = fit
  const [hover, setHover] = useState<{ col: number; row: number } | null>(null);

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

  const cellAt = (event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const col = Math.floor((event.clientX - rect.left) / cellW);
    const row = Math.floor((event.clientY - rect.top) / cellH);
    if (col < 0 || row < 0 || col >= tileset.columns || row >= tileset.rows) return null;
    return { col, row };
  };

  const select = (col: number, row: number) => {
    setSelection({ tilesetId: tileset.id, tileId: row * tileset.columns + col });
    setTool("brush");
  };

  const selected =
    selection && selection.tilesetId === tileset.id
      ? { col: selection.tileId % tileset.columns, row: Math.floor(selection.tileId / tileset.columns) }
      : null;

  // Arrow keys move the selection while the tileset view has focus.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const d = delta[event.key];
    if (!d || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    const from = selected ?? { col: 0, row: 0 };
    const col = Math.min(tileset.columns - 1, Math.max(0, from.col + (selected ? d[0] : 0)));
    const row = Math.min(tileset.rows - 1, Math.max(0, from.row + (selected ? d[1] : 0)));
    select(col, row);
    viewportRef.current
      ?.querySelector<HTMLElement>("[data-selected-tile]")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={viewportRef}
        tabIndex={0}
        role="grid"
        aria-label={tileset.name}
        onKeyDown={onKeyDown}
        className="min-h-0 flex-1 overflow-auto rounded-sm focus-visible:outline-offset-[-2px]"
        style={{ padding: PADDING, paddingTop: 0 }}
      >
        {image ? (
          <div
            className="checker relative cursor-pointer"
            // Whole-pixel centering keeps tile edges crisp.
            style={{ width: cssW, height: cssH, marginLeft: Math.max(0, Math.floor((availWidth - cssW) / 2)) }}
            onPointerMove={(e) => {
              const cell = cellAt(e);
              setHover((h) => (h?.col === cell?.col && h?.row === cell?.row ? h : cell));
            }}
            onPointerLeave={() => setHover(null)}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              const cell = cellAt(e);
              if (cell) select(cell.col, cell.row);
            }}
          >
            <canvas ref={canvasRef} className="absolute inset-0 block size-full pixelated" />
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
            {hover && (hover.col !== selected?.col || hover.row !== selected?.row) && (
              <div
                aria-hidden
                className="pointer-events-none absolute bg-hover-tile outline outline-1 outline-text/60"
                style={{ left: hover.col * cellW, top: hover.row * cellH, width: cellW, height: cellH }}
              />
            )}
            {selected && (
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
          </div>
        ) : (
          <div className="py-6 text-center text-sm text-faint">
            {t("tileset.missingImage", { path: tileset.imagePath })}
          </div>
        )}
      </div>

      <div className="flex h-7 shrink-0 items-center gap-2 border-t border-line-subtle px-3 text-xs text-faint">
        <span className="truncate">{t("tileset.tileCount", { count: tileset.columns * tileset.rows })}</span>
        <span className="font-mono tabular">
          {tileset.columns}×{tileset.rows}
        </span>
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
