/**
 * The tileset card: one dialog for every way a tileset comes in (welcome
 * drop, drop on the editor, "+" / menu, pasted image) and for its settings
 * later. Left: the image, crisp and zoomable like the map (wheel at the
 * cursor, Space / middle drag pans), with the grid
 * of the current settings over it and fully transparent tiles dimmed.
 * Right: name, tile size (linked), margin, spacing, suggestion chips, the
 * tile count and a leftover hint. Enter confirms.
 */
import { Dialog } from "@base-ui/react/dialog";
import type { TileGridSpec } from "@smap/core";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

import { t } from "../../i18n";
import { backdropClass, popupClass, dialogWidthL } from "../dialogs/styles";
import { DialogHeader, DialogBody, DialogFooter, FormField, dialogLayoutClass } from "../dialogs/DialogFrame";
import { TextField as InputField } from "../primitives/TextField";
import { Button, IconButton } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { Tooltip } from "../primitives/Tooltip";
import { usePanDrag } from "../tileset/usePanDrag";
import {
  applySpec,
  alphaScanOf,
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
import { RemoveTilesetDialog } from "../tileset/RemoveTilesetDialog";
import { PaletteDialogs } from "../palettes/PaletteDialogs";
import { TextPromptDialog } from "../tileset/TextPrompt";
import { accumulateWheelZoom, PAN_GESTURE_MS, tilesetWheel } from "../tileset/zoomModel";
import { BulkImportDialog } from "./BulkImportCard";
import { useTilesetCard, type CardRequest, type CardResult } from "./importStore";
import { selectAll } from "../primitives/selectAll";

/** Every tileset dialog: the single card, the bulk card, the remove question and the name prompt. */
export function TilesetImportDialog() {
  return (
    <>
      <SingleCardDialog />
      <BulkImportDialog />
      <RemoveTilesetDialog />
      <TextPromptDialog />
      <PaletteDialogs />
    </>
  );
}

function SingleCardDialog() {
  const popupRef = useRef<HTMLDivElement>(null);
  const request = useTilesetCard((s) => s.request);
  const close = useTilesetCard((s) => s.close);
  return (
    <Dialog.Root open={request !== null} onOpenChange={(open) => !open && close(null)}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdropClass} />
        <Dialog.Popup
          ref={popupRef}
          initialFocus={() => popupRef.current?.querySelector<HTMLElement>("input:not(:disabled)") ?? popupRef.current}
          data-testid="tileset-card"
          className={`${popupClass} ${dialogWidthL} ${dialogLayoutClass} h-[min(640px,calc(100vh-32px))]`}
        >
          {request && <TilesetCard key={`${request.fileName}:${request.mode.kind}`} request={request} onClose={close} />}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function TilesetCard({
  request,
  onClose: close,
  confirmLabel,
}: {
  request: CardRequest;
  onClose(result: CardResult | null): void;
  /** Primary button text instead of the mode's ("Uygula" for a bulk row). */
  confirmLabel?: string;
}) {
  const [draft, setDraft] = useState<GridDraft>(request.initial);
  const parsed = parseDraft(draft);
  const image = useMemo(() => ({ width: request.width, height: request.height, alpha: request.alpha }), [request]);
  // Scan the alpha channel once when the card opens; every field edit reuses it (see importModel).
  useMemo(() => alphaScanOf(image), [image]);
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
  const primary = confirmLabel ?? (edit ? t("tilesetImport.apply") : request.mode.kind === "new" ? t("tilesetImport.create") : t("tilesetImport.import"));

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 min-w-0 flex-1 flex-col">
      <DialogHeader title={title} subtitle={edit ? request.initial.name : undefined} onClose={() => close(null)} />
      <DialogBody className="flex min-h-0 flex-1 gap-4">
        <Preview request={request} spec={parsed.spec} summary={summary} />
        <div className="flex min-h-0 w-80 shrink-0 flex-col gap-3 overflow-y-auto">
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
                className={draft.linked ? "bg-active !text-title" : ""}
                onClick={() => setDraft((d) => setDraftLinked(d, !d.linked))}
              >
                <Icon name="link" size={16} />
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
                      className={`flex h-control-sm items-center gap-1 rounded-sm border px-2 text-sm transition-colors duration-(--duration-fast) ${
                        on
                          ? "border-line-strong bg-active text-title"
                          : "border-line bg-field text-muted hover:border-line-strong hover:bg-hover-popup hover:text-text"
                      }`}
                    >
                      <span className="tabular">{chip.size}</span>
                      <span className="text-xs text-muted">· {chip.reason}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <div data-testid="tileset-card-summary" className="text-md text-text tabular">
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
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        {edit && <Button variant="ghost" onClick={() => close({ kind: "replaceImage" })}><Icon name="image" size={16} />{t("tilesetImport.replaceImage")}</Button>}
        <Button variant="secondary" onClick={() => close(null)}>{t("common.cancel")}</Button>
        <Button type="submit" variant="primary" disabled={!canSubmit}>{primary}</Button>
      </DialogFooter>
    </form>
  );
}

function Note({ tone, children, testId }: { tone: "warning" | "info"; children: ReactNode; testId?: string }) {
  return (
    <div
      data-testid={testId}
      className={`flex items-start gap-2 text-sm ${
        tone === "warning" ? "text-warning" : "text-muted"
      }`}
    >
      <Icon name={tone === "warning" ? "warning" : "info"} size={16} className="mt-0.5 shrink-0" />
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
  return <FormField label={label} htmlFor={id}>
    <InputField size="md" id={id} value={value} autoFocus={autoFocus} spellCheck={false} autoComplete="off"
      aria-invalid={invalid || undefined} {...selectAll} onChange={e => onChange(e.target.value)}
      className={invalid ? "[&>input]:border-danger" : ""} />
  </FormField>;
}

/** Numeric field: ArrowUp / ArrowDown step by 1 (Shift: 8). */
function NumberField({ label, value, invalid, autoFocus, onChange }: { label: string; value: string; invalid: boolean; autoFocus?: boolean; onChange(value: string): void }) {
  const id = useId();
  return <div className="min-w-0 flex-1"><FormField label={label} htmlFor={id}>
    <InputField size="md" id={id} value={value} autoFocus={autoFocus} inputMode="numeric" spellCheck={false} autoComplete="off"
      aria-invalid={invalid || undefined} {...selectAll} onChange={e => onChange(e.target.value)}
      trailing={<span className="text-xs text-muted">{t("newProject.pxUnit")}</span>}
      className={`tabular ${invalid ? "[&>input]:border-danger" : ""}`}
      onKeyDown={e => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        const n = Number(value);
        if (!Number.isFinite(n)) return;
        const step = (e.shiftKey ? 8 : 1) * (e.key === "ArrowUp" ? 1 : -1);
        onChange(String(Math.max(0, Math.round(n) + step)));
      }} />
  </FormField></div>;
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

  // The map's wheel model: a mouse notch zooms at the cursor, Shift + wheel scrolls sideways, a
  // trackpad swipe pans, pinch / Ctrl + wheel zooms (non-passive: the page must not zoom).
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    let acc = 0;
    let lastPan = -Infinity;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const now = performance.now();
      const action = tilesetWheel(e, now - lastPan < PAN_GESTURE_MS);
      if (action.kind === "pan") {
        lastPan = now;
        box.scrollLeft += action.dx;
        box.scrollTop += action.dy;
        return;
      }
      const r = accumulateWheelZoom(acc, action.delta);
      acc = r.acc;
      if (r.step === 0) return;
      const zoomIn = r.step > 0;
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

  // Space + drag or middle drag pans the preview (as on the map).
  const pan = usePanDrag(scrollRef);

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
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md bg-canvas">
      <div
        ref={scrollRef}
        tabIndex={-1}
        className={`min-h-0 flex-1 overflow-auto outline-none ${pan.cursor}`}
        data-import-preview
        data-testid="tileset-card-preview"
        {...pan.handlers}
      >
        <div className="flex min-h-full min-w-full items-center justify-center" style={{ padding: PAD, width: "max-content", height: "max-content" }}>
          <div
            ref={imageRef}
            className="checker relative shrink-0"
            style={{ width: width * z, height: height * z, visibility: zoom === null ? "hidden" : undefined }}
          >
            <canvas ref={canvasRef} width={width} height={height} className="pixelated absolute inset-0 size-full" />
            {spec && summary && <GridOverlay spec={spec} summary={summary} width={width} height={height} />}
          </div>
        </div>
      </div>
      <div className="pointer-events-none absolute right-3 bottom-3 left-3 flex items-center justify-between">
        <span className="text-xs text-muted tabular">
          {t("tilesetImport.imageSize", { width, height })}
        </span>
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-sm bg-panel p-0.5">
          <IconButton aria-label={t("commands.view.zoomOut")} size="sm" onClick={() => step(-1)}>
            <Icon name="minus" size={16} />
          </IconButton>
          <Tooltip label={t("tilesetImport.zoomHint")} side="top">
            <span className="w-12 text-center text-xs text-muted tabular" data-testid="tileset-card-zoom" aria-label={t("tilesetImport.zoom", { zoom: `${Math.round(z * 100)}%` })}>
              {Math.round(z * 100)}%
            </span>
          </Tooltip>
          <IconButton aria-label={t("commands.view.zoomIn")} size="sm" onClick={() => step(1)}>
            <Icon name="plus" size={16} />
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
