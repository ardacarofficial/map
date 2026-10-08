/**
 * The tileset card: one dialog for every way a tileset comes in (welcome
 * drop, drop on the editor, "+" / menu, pasted image) and for its settings
 * later. Left: the image, crisp and zoomable with Ctrl + wheel, with the grid
 * of the current settings over it and fully transparent tiles dimmed.
 * Right: name, tile size (linked), margin, spacing, suggestion chips, the
 * tile count and a leftover hint. Enter confirms.
 */
import { Dialog } from "@base-ui/react/dialog";
import type { TileGridSpec } from "@smap/core";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

import { t } from "../../i18n";
import { backdropClass, popupClass } from "../dialogs/styles";
import { Button, IconButton } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { Tooltip } from "../primitives/Tooltip";
import {
  applySpec,
  leftoverMessage,
  parseDraft,
  sameSpec,
  setDraftField,
  setDraftLinked,
  sizeMismatchNote,
  suggestionChips,
  summarize,
  summaryLine,
  type DraftField,
  type GridDraft,
  type GridSummary,
} from "./importModel";
import { wheelIntent } from "../tileset/zoomModel";
import { useTilesetCard, type CardRequest } from "./importStore";

export function TilesetImportDialog() {
  const request = useTilesetCard((s) => s.request);
  const close = useTilesetCard((s) => s.close);
  return (
    <Dialog.Root open={request !== null} onOpenChange={(open) => !open && close(null)}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdropClass} />
        <Dialog.Popup
          data-testid="tileset-card"
          className={`${popupClass} flex h-[min(640px,calc(100vh-48px))] w-[min(980px,calc(100vw-32px))] overflow-hidden`}
        >
          {request && <TilesetCard key={`${request.fileName}:${request.mode.kind}`} request={request} />}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function TilesetCard({ request }: { request: CardRequest }) {
  const close = useTilesetCard((s) => s.close);
  const [draft, setDraft] = useState<GridDraft>(request.initial);
  const parsed = parseDraft(draft);
  const image = useMemo(() => ({ width: request.width, height: request.height, alpha: request.alpha }), [request]);
  const specKey = parsed.spec ? `${parsed.spec.tileWidth},${parsed.spec.tileHeight},${parsed.spec.margin},${parsed.spec.spacing}` : "";
  // Recomputed only when the grid changes (empty tiles scan the alpha channel).
  const summary = useMemo(() => (parsed.spec ? summarize(parsed.spec, image) : null), [specKey, image]); // eslint-disable-line react-hooks/exhaustive-deps
  const chips = useMemo(() => suggestionChips(request.suggestions), [request.suggestions]);
  const edit = request.mode.kind === "edit";
  const canSubmit = parsed.spec !== null && summary !== null && (edit || parsed.nameOk);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit || !parsed.spec) return;
    close({ kind: "confirm", name: draft.name.trim(), spec: parsed.spec });
  };
  const field = (key: DraftField) => ({
    value: draft[key],
    invalid: parsed.invalid.has(key),
    onChange: (value: string) => setDraft((d) => setDraftField(d, key, value)),
  });
  const leftover = summary ? leftoverMessage(summary) : null;
  const mismatch = parsed.spec ? sizeMismatchNote(parsed.spec, request.mapTile) : null;
  const title =
    request.mode.kind === "edit"
      ? t("tilesetImport.titleEdit")
      : request.mode.kind === "new"
        ? t("tilesetImport.titleNew")
        : t("tilesetImport.titleAdd");
  const primary = edit ? t("tilesetImport.apply") : request.mode.kind === "new" ? t("tilesetImport.create") : t("tilesetImport.import");

  return (
    <form onSubmit={submit} noValidate className="flex min-w-0 flex-1">
      <Preview request={request} spec={parsed.spec} summary={summary} />

      <div className="flex w-[324px] shrink-0 flex-col border-l border-line">
        <div className="flex flex-col gap-1 px-5 pt-5">
          <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
          <Dialog.Description className="text-md text-muted">
            {edit ? request.initial.name : t("tilesetImport.description")}
          </Dialog.Description>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          {!edit && (
            <TextField
              label={t("tilesetImport.name")}
              value={draft.name}
              invalid={!parsed.nameOk}
              autoFocus
              onChange={(name) => setDraft((d) => ({ ...d, name }))}
            />
          )}

          <div className="flex items-end gap-1.5">
            <NumberField label={t("tilesetImport.tileWidth")} autoFocus={edit} {...field("tileWidth")} />
            <Tooltip label={t("tilesetImport.linked")}>
              <IconButton
                aria-label={t("tilesetImport.linked")}
                aria-pressed={draft.linked}
                active={draft.linked}
                className="mb-0"
                onClick={() => setDraft((d) => setDraftLinked(d, !d.linked))}
              >
                <Icon name="link" size={15} />
              </IconButton>
            </Tooltip>
            <NumberField label={t("tilesetImport.tileHeight")} {...field("tileHeight")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <NumberField label={t("tilesetImport.margin")} {...field("margin")} />
            <NumberField label={t("tilesetImport.spacing")} {...field("spacing")} />
          </div>

          {chips.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-muted">{t("tilesetImport.suggestions")}</span>
              <div className="flex flex-wrap gap-1.5">
                {chips.map((chip) => {
                  const on = parsed.spec !== null && sameSpec(chip.spec, parsed.spec);
                  return (
                    <button
                      key={chip.key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setDraft((d) => applySpec(d, chip.spec))}
                      className={`flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition-colors ${
                        on
                          ? "border-accent-line bg-accent-soft text-accent"
                          : "border-line text-muted hover:border-line-strong hover:bg-hover hover:text-text"
                      }`}
                    >
                      <span className="font-mono tabular">{chip.size}</span>
                      <span className={on ? "text-accent/80" : "text-faint"}>· {chip.reason}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <div data-testid="tileset-card-summary" className="font-mono text-md text-text tabular">
              {parsed.spec === null ? (
                <span className="text-danger">{t("tilesetImport.invalid")}</span>
              ) : summary === null ? (
                <span className="text-danger">{t("tilesetImport.noTile")}</span>
              ) : (
                summaryLine(summary)
              )}
            </div>
            {leftover && summary && (
              <Note tone="warning" testId="tileset-card-leftover">
                <span>{leftover}</span>
                {summary.fix && (
                  <button
                    type="button"
                    className="mt-1 self-start text-sm font-medium text-warning underline-offset-2 hover:underline"
                    onClick={() => summary.fix && setDraft((d) => applySpec(d, summary.fix!))}
                  >
                    {t("tilesetImport.applyFix")}
                  </button>
                )}
              </Note>
            )}
            {mismatch && <Note tone="info">{mismatch}</Note>}
            {request.mode.kind === "new" && parsed.spec && (
              <Note tone="info">
                {t("tilesetImport.newProjectNote", {
                  width: request.mode.mapWidth,
                  height: request.mode.mapHeight,
                  tile:
                    parsed.spec.tileWidth === parsed.spec.tileHeight
                      ? parsed.spec.tileWidth
                      : `${parsed.spec.tileWidth}×${parsed.spec.tileHeight}`,
                })}
              </Note>
            )}
            {edit && <Note tone="info">{t("tilesetImport.editNote")}</Note>}
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-line px-5 py-3">
          {edit && (
            <Button variant="ghost" className="-ml-2 self-start" onClick={() => close({ kind: "replaceImage" })}>
              <Icon name="image" size={15} />
              {t("tilesetImport.replaceImage")}
            </Button>
          )}
          <div className="flex justify-end gap-2">
            <Dialog.Close render={<Button variant="ghost">{t("common.cancel")}</Button>} />
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {primary}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}

function Note({ tone, children, testId }: { tone: "warning" | "info"; children: ReactNode; testId?: string }) {
  return (
    <div
      data-testid={testId}
      className={`flex gap-2 rounded-md px-2.5 py-2 text-sm leading-snug ${
        tone === "warning" ? "bg-warning-soft text-warning" : "bg-hover text-muted"
      }`}
    >
      <Icon name={tone === "warning" ? "warning" : "info"} size={14} className="mt-0.5 shrink-0" />
      <div className="flex min-w-0 flex-col">{children}</div>
    </div>
  );
}

function TextField({
  label,
  value,
  invalid,
  autoFocus,
  onChange,
}: {
  label: string;
  value: string;
  invalid: boolean;
  autoFocus?: boolean;
  onChange(value: string): void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-muted">
        {label}
      </label>
      <input
        id={id}
        value={value}
        autoFocus={autoFocus}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={invalid || undefined}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => onChange(e.target.value)}
        className={`h-8 rounded-md border bg-panel px-2.5 text-md text-text transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:outline-none ${
          invalid ? "border-danger" : "border-line hover:border-line-strong"
        }`}
      />
    </div>
  );
}

/** Numeric field: ArrowUp / ArrowDown step by 1 (Shift: 8). */
function NumberField({
  label,
  value,
  invalid,
  autoFocus,
  onChange,
}: {
  label: string;
  value: string;
  invalid: boolean;
  autoFocus?: boolean;
  onChange(value: string): void;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <label htmlFor={id} className="truncate text-sm font-medium text-muted">
        {label}
      </label>
      <div
        className={`flex h-8 items-center rounded-md border bg-panel px-2.5 transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft ${
          invalid ? "border-danger" : "border-line hover:border-line-strong"
        }`}
      >
        <input
          id={id}
          value={value}
          autoFocus={autoFocus}
          inputMode="numeric"
          spellCheck={false}
          autoComplete="off"
          aria-invalid={invalid || undefined}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
            e.preventDefault();
            const n = Number(value);
            if (!Number.isFinite(n)) return;
            const step = (e.shiftKey ? 8 : 1) * (e.key === "ArrowUp" ? 1 : -1);
            onChange(String(Math.max(0, Math.round(n) + step)));
          }}
          className="h-full min-w-0 flex-1 bg-transparent font-mono text-md text-text tabular focus-visible:outline-none"
        />
        <span className="pl-1.5 text-sm text-faint">px</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ preview

const ZOOMS = [0.25, 0.5, 1, 1.5, 2, 3, 4, 6, 8, 12, 16];
const PAD = 24;

function fitZoom(width: number, height: number, boxW: number, boxH: number): number {
  let best = ZOOMS[0]!;
  for (const z of ZOOMS) if (width * z <= boxW - 2 * PAD && height * z <= boxH - 2 * PAD) best = z;
  return best;
}

function Preview({ request, spec, summary }: { request: CardRequest; spec: TileGridSpec | null; summary: GridSummary | null }) {
  const { width, height, bitmap } = request;
  const scrollRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  /** Image pixel kept under the cursor while zooming. */
  const anchor = useRef<{ px: number; py: number; clientX: number; clientY: number } | null>(null);

  // Draw the image once at its natural size; CSS scales it (pixelated).
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, width, height);
    try {
      ctx.drawImage(bitmap, 0, 0);
    } catch {
      // A closed bitmap draws nothing; the grid still shows.
    }
  }, [bitmap, width, height]);

  // First zoom: the largest step that fits the box.
  useLayoutEffect(() => {
    const box = scrollRef.current;
    if (!box || zoom !== null) return;
    setZoom(fitZoom(width, height, box.clientWidth, box.clientHeight));
  }, [width, height, zoom]);

  // Same wheel convention as the tileset panel: wheel scrolls, Shift + wheel scrolls sideways,
  // Ctrl / Cmd + wheel (or pinch) zooms around the cursor (non-passive: the page must not zoom).
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      const intent = wheelIntent(e);
      if (intent === "native") return;
      e.preventDefault();
      if (intent === "scroll-x") {
        box.scrollLeft += e.deltaY || e.deltaX;
        return;
      }
      // Trackpad pinches send many small deltas: one step per ~40 px.
      acc += e.deltaMode === 0 ? e.deltaY : e.deltaY * 40;
      if (Math.abs(acc) < 40) return;
      const zoomIn = acc < 0;
      acc = 0;
      const img = imageRef.current;
      setZoom((z) => {
        const current = z ?? 1;
        const i = ZOOMS.indexOf(current);
        const next = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 2 : i) + (zoomIn ? 1 : -1)))]!;
        if (img && next !== current) {
          const r = img.getBoundingClientRect();
          anchor.current = { px: (e.clientX - r.left) / current, py: (e.clientY - r.top) / current, clientX: e.clientX, clientY: e.clientY };
        }
        return next;
      });
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, []);

  useLayoutEffect(() => {
    const a = anchor.current;
    const box = scrollRef.current;
    const img = imageRef.current;
    anchor.current = null;
    if (!a || !box || !img || zoom === null) return;
    const r = img.getBoundingClientRect();
    box.scrollLeft += r.left + a.px * zoom - a.clientX;
    box.scrollTop += r.top + a.py * zoom - a.clientY;
  }, [zoom]);

  const step = (dir: 1 | -1) =>
    setZoom((z) => {
      const i = ZOOMS.indexOf(z ?? 1);
      return ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 2 : i) + dir))]!;
    });

  const z = zoom ?? 1;
  return (
    <div className="relative flex min-w-0 flex-1 flex-col bg-canvas">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto" data-testid="tileset-card-preview">
        <div className="flex min-h-full min-w-full items-center justify-center" style={{ padding: PAD, width: "max-content", height: "max-content" }}>
          <div
            ref={imageRef}
            className="checker relative shrink-0 shadow-popup"
            style={{ width: width * z, height: height * z, visibility: zoom === null ? "hidden" : undefined }}
          >
            <canvas ref={canvasRef} width={width} height={height} className="pixelated absolute inset-0 size-full" />
            {spec && summary && <GridOverlay spec={spec} summary={summary} width={width} height={height} />}
          </div>
        </div>
      </div>
      <div className="pointer-events-none absolute right-3 bottom-3 left-3 flex items-center justify-between">
        <span className="rounded-md bg-panel/90 px-2 py-1 font-mono text-xs text-muted tabular">
          {t("tilesetImport.imageSize", { width, height })}
        </span>
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-md border border-line bg-panel/95 p-0.5 shadow-popup">
          <IconButton aria-label={t("commands.view.zoomOut")} className="size-6" onClick={() => step(-1)}>
            <Icon name="minus" size={14} />
          </IconButton>
          <Tooltip label={t("tilesetImport.zoomHint")} side="top">
            <span className="w-12 text-center font-mono text-xs text-muted tabular" aria-label={t("tilesetImport.zoom", { zoom: `${Math.round(z * 100)}%` })}>
              {Math.round(z * 100)}%
            </span>
          </Tooltip>
          <IconButton aria-label={t("commands.view.zoomIn")} className="size-6" onClick={() => step(1)}>
            <Icon name="plus" size={14} />
          </IconButton>
        </div>
      </div>
    </div>
  );
}

/** Grid lines, dimmed empty tiles and the unused right / bottom strips, in image pixels. */
function GridOverlay({
  spec,
  summary,
  width,
  height,
}: {
  spec: TileGridSpec;
  summary: GridSummary;
  width: number;
  height: number;
}) {
  const { tileWidth: tw, tileHeight: th, margin: m, spacing: s } = spec;
  const { columns, rows } = summary;
  const gridW = columns * tw + (columns - 1) * s;
  const gridH = rows * th + (rows - 1) * s;
  const empty = summary.emptyIds;
  const patternId = useId();

  const dim = useMemo(() => {
    let d = "";
    for (const id of empty) {
      const x = m + (id % columns) * (tw + s);
      const y = m + Math.floor(id / columns) * (th + s);
      d += `M${x} ${y}h${tw}v${th}h${-tw}z`;
    }
    return d;
  }, [empty, columns, m, tw, th, s]);

  const lines = useMemo(() => {
    let d = "";
    const xs = new Set<number>();
    const ys = new Set<number>();
    for (let c = 0; c < columns; c++) {
      xs.add(m + c * (tw + s));
      xs.add(m + c * (tw + s) + tw);
    }
    for (let r = 0; r < rows; r++) {
      ys.add(m + r * (th + s));
      ys.add(m + r * (th + s) + th);
    }
    for (const x of xs) d += `M${x} ${m}V${m + gridH}`;
    for (const y of ys) d += `M${m} ${y}H${m + gridW}`;
    return d;
  }, [columns, rows, m, tw, th, s, gridW, gridH]);

  const { leftoverX, leftoverY } = summary;
  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <pattern id={patternId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="var(--color-warning)" fillOpacity="0.12" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-warning)" strokeOpacity="0.55" strokeWidth="2" />
        </pattern>
      </defs>
      {/* Margin / spacing gutters read as "not part of a tile". */}
      <path
        d={`M0 0H${width}V${height}H0z M${m} ${m}V${m + gridH}H${m + gridW}V${m}z`}
        fill="var(--color-canvas)"
        fillOpacity="0.55"
        fillRule="evenodd"
      />
      {dim && <path d={dim} fill="var(--color-canvas)" fillOpacity="0.7" />}
      {leftoverX > 0 && <rect x={width - leftoverX} y={0} width={leftoverX} height={height} fill={`url(#${patternId})`} />}
      {leftoverY > 0 && <rect x={0} y={height - leftoverY} width={width} height={leftoverY} fill={`url(#${patternId})`} />}
      <path d={lines} fill="none" stroke="var(--color-canvas)" strokeOpacity="0.55" strokeWidth="3" vectorEffect="non-scaling-stroke" />
      <path d={lines} fill="none" stroke="var(--color-accent)" strokeOpacity="0.9" strokeWidth="1" vectorEffect="non-scaling-stroke" shapeRendering="crispEdges" />
    </svg>
  );
}
