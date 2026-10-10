/**
 * file.export (Ctrl+E) and the app bar's "Unity'ye aktar": one dialog for
 * Unity / PNG / JSON / Tiled / Zip (concept 3). Left: the form (map, folder,
 * options, per-layer checkboxes with tile counts). Right: a live preview of
 * what is exported and the "Dışa aktarma kontrolü" checklist, then one
 * primary "Dışa aktar". Target, PNG scale, folders, Unity options, the
 * per-level layer selection and "export to Unity on save" are remembered
 * per project (`exportSettings.ts`); the after-save export uses the same.
 */
import { Dialog } from "@base-ui/react/dialog";
import {
  deriveCollision,
  exportBaseName,
  exportLayerSummaries,
  exportWarnings,
  layerDrawList,
  type ExportLayerSummary,
  type ExportWarning,
  type MapDocument,
} from "@smap/core";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";

import { formatNumber, t, type MessageKey } from "../i18n";
import { useProjectLibrary } from "../io/projectLibrary";
import { describeError } from "../io/session";
import { useEditorStore, type OpenProject } from "../state/editorStore";
import { getTilesetImage } from "../state/tilesetImages";
import { backdropClass, popupClass } from "../ui/dialogs/styles";
import { Button } from "../ui/primitives/Button";
import { Icon } from "../ui/primitives/Icon";
import { inputClass, inputOk, NativeSelect } from "../ui/primitives/NativeSelect";
import { toast } from "../ui/toast/toastStore";
import {
  activeSource,
  chooseExportFolder,
  exportJson,
  exportPng,
  exportToTiled,
  exportToUnity,
  exportZip,
  formatClock,
  loadExportSource,
  previewFiles,
  previewZipFiles,
  sourceLevelName,
  type ExportSource,
  type FolderKind,
} from "./exportActions";
import type { ExportFileSet } from "./exportFiles";
import { canExport, exportChecks, levelKey, outputSubfolder, selectedLayerIds, toggleExcluded, type ExportCheck } from "./exportOptions";
import { defaultExportSettings, loadExportSettings, updateExportSettings, type ExportSettings, type ExportTarget } from "./exportSettings";
import { useExportStore } from "./exportStore";
import { compositeOps, largestFittingScale, PNG_MAX_SIDE, PNG_SCALES, pngFits, pngSize, type PngScale } from "./pngComposite";
import { replayOps } from "./pngRender";

export { openExportDialog } from "./exportStore";

export function ExportDialog() {
  const open = useExportStore((s) => s.open);
  const setOpen = useExportStore((s) => s.setOpen);
  const project = useEditorStore((s) => s.project);
  // Focus the export button, so Enter exports right away.
  const submitRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog.Root open={open && project !== null} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdropClass} />
        <Dialog.Popup initialFocus={submitRef} className={`${popupClass} w-[920px] max-w-[calc(100vw-32px)]`}>
          {open && project && <ExportForm project={project} submitRef={submitRef} onDone={() => setOpen(false)} />}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const TARGETS: { id: ExportTarget; title: MessageKey; hint: MessageKey; glyph: ReactNode }[] = [
  { id: "unity", title: "export.targetUnity", hint: "export.targetUnityHint", glyph: <CubeGlyph /> },
  { id: "png", title: "export.targetPng", hint: "export.targetPngHint", glyph: <Icon name="image" size={14} /> },
  { id: "json", title: "export.targetJson", hint: "export.targetJsonHint", glyph: <BracesGlyph /> },
  { id: "tmj", title: "export.targetTmj", hint: "export.targetTmjHint", glyph: <Icon name="grid" size={14} /> },
  { id: "zip", title: "export.targetZip", hint: "export.targetZipHint", glyph: <Icon name="folder" size={14} /> },
];

/** Everything the dialog shows for the chosen target and map, derived once per change. */
interface Derived {
  readonly summaries: readonly ExportLayerSummary[];
  /** Selected tile layers (checkboxes), before Unity's "Tile katmanları". */
  readonly layers: readonly string[];
  /** Layers the export actually writes (Unity with tiles off: none). */
  readonly exported: readonly string[];
  readonly files: ExportFileSet | null;
  readonly warnings: readonly ExportWarning[];
  readonly missingImages: readonly string[];
  readonly imageSize: { width: number; height: number };
  readonly solidCells: number;
  readonly checks: readonly ExportCheck[];
}

function derive(target: ExportTarget, source: ExportSource, settings: ExportSettings, project: OpenProject): Derived {
  const doc = source.document;
  const summaries = exportLayerSummaries(doc);
  const layers = selectedLayerIds(summaries, settings.excludedLayers[levelKey(source)] ?? []);
  const exported = target === "unity" && !settings.unityTiles ? [] : layers;
  const files = target === "unity" || target === "tmj" ? previewFiles(target, source, settings) : null;
  const list = layerDrawList(doc, { layers });
  let warnings: readonly ExportWarning[];
  let missingImages: readonly string[];
  if (files) {
    warnings = files.warnings;
    missingImages = files.missingImages;
  } else if (target === "zip") {
    warnings = [];
    missingImages = project.store.document.tilesets.filter((ts) => !getTilesetImage(ts.id)).map((ts) => ts.imagePath);
  } else {
    warnings = target === "png" ? (list.warnings ?? []) : exportWarnings(doc, layers);
    const drawn = new Set(list.layers.flatMap((l) => l.items.map((item) => item.tileset)));
    missingImages = target === "png" ? [...drawn].filter((ts) => !getTilesetImage(ts.id)?.bitmap).map((ts) => ts.imagePath) : [];
  }
  const collision = deriveCollision(doc).data;
  let solidCells = 0;
  for (let i = 0; i < collision.length; i++) if (collision[i] !== 0) solidCells++;
  const checks = exportChecks({
    target,
    selectedLayers: exported.length,
    collision: settings.unityCollision,
    hasFolder: target === "unity" ? settings.unityDir !== null : settings.tmjDir !== null,
    copyTextures: settings.copyTextures,
    missingImages,
    warnings,
  });
  return {
    summaries,
    layers,
    exported,
    files,
    warnings,
    missingImages,
    imageSize: { width: list.width, height: list.height },
    solidCells,
    checks,
  };
}

function ExportForm({
  project,
  submitRef,
  onDone,
}: {
  project: OpenProject;
  submitRef: RefObject<HTMLButtonElement | null>;
  onDone(): void;
}) {
  const busy = useExportStore((s) => s.busy);
  const revision = useExportStore((s) => s.revision);
  const initialTarget = useExportStore((s) => s.initialTarget);
  const levels = useProjectLibrary((s) => s.levels);
  const [settings, setSettings] = useState<ExportSettings | null>(null);
  const [target, setTarget] = useState<ExportTarget | null>(initialTarget);
  const [scale, setScale] = useState<PngScale | null>(null);
  const [levelId, setLevelId] = useState<string | undefined>(project.levelId);
  const [loaded, setLoaded] = useState<ExportSource | null>(null);
  const [subfolderDraft, setSubfolderDraft] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadExportSettings(project.name).then((next) => {
      if (cancelled) return;
      setSettings(next);
      setTarget((current) => current ?? next.target);
      setScale((current) => current ?? next.pngScale);
    });
    return () => {
      cancelled = true;
    };
  }, [project.name, revision]);

  // Another level of the project (Harita ▾): read it without opening it.
  useEffect(() => {
    if (levelId === undefined || levelId === project.levelId) return;
    let cancelled = false;
    loadExportSource(levelId).then(
      (next) => {
        if (!cancelled && next) setLoaded(next);
      },
      (error: unknown) => {
        console.error(error);
        if (!cancelled) toast.error(t("export.mapLoadFailed", { detail: describeError(error) }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [levelId, project.levelId]);

  const active = useMemo(() => activeSource(project), [project]);
  const source = levelId !== undefined && levelId !== project.levelId && loaded?.levelId === levelId ? loaded : active;
  const current = settings ?? defaultExportSettings(project.name);
  const chosen = target ?? current.target;
  const pngScale = scale ?? current.pngScale;
  const derived = useMemo(() => derive(chosen, source, current, project), [chosen, source, current, project]);
  const pngOk = pngFits(derived.imageSize.width, derived.imageSize.height, pngScale);
  const ready = canExport(derived.checks) && (chosen !== "png" || pngOk);
  const key = levelKey(source);
  const excluded = current.excludedLayers[key] ?? [];

  /** Optimistic: the form updates at once, IndexedDB follows. */
  const patch = (next: Partial<ExportSettings>) => {
    setSettings((s) => ({ ...(s ?? defaultExportSettings(project.name)), ...next }));
    void updateExportSettings(project.name, next);
  };

  const setLayer = (layerId: string, include: boolean) => {
    patch({ excludedLayers: { ...current.excludedLayers, [key]: toggleExcluded(excluded, layerId, include) } });
  };

  const pickFolder = async (kind: FolderKind) => {
    try {
      const next = await chooseExportFolder(kind);
      if (next) setSettings(next);
    } catch (error) {
      console.error(error);
      toast.error(t("export.toastFailed", { detail: describeError(error) }));
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || !ready) return;
    const run = async (): Promise<boolean> => {
      if (subfolderDraft !== null) await updateExportSettings(project.name, { unitySubfolder: subfolderDraft });
      switch (chosen) {
        case "unity":
          return (await exportToUnity(source)) !== null;
        case "tmj":
          return (await exportToTiled(source)) !== null;
        case "png":
          return exportPng(pngScale, source);
        case "json":
          return exportJson(source);
        case "zip":
          return exportZip();
      }
    };
    void run().then((ok) => ok && onDone());
  };

  const mapName = levels.find((l) => l.id === source.levelId)?.name ?? sourceLevelName(source);
  const [before, after] = t("export.prepare", { map: "\u0001" }).split("\u0001");
  const showMap = chosen !== "zip" && levels.length > 0;
  const subfolder = subfolderDraft ?? current.unitySubfolder;

  return (
    <form onSubmit={submit} noValidate className="flex max-h-[calc(100vh-32px)] flex-col">
      <div className="flex items-start gap-3 px-6 pt-5">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Dialog.Title className="text-xl font-semibold text-title">
            {chosen === "unity" ? t("export.titleUnity") : t("export.title")}
          </Dialog.Title>
          <Dialog.Description className="truncate text-md text-muted">
            {chosen === "zip" ? (
              t("export.description")
            ) : (
              <>
                {before}
                <span className="text-accent">{mapName}</span>
                {after}
              </>
            )}
          </Dialog.Description>
        </div>
        <Dialog.Close
          aria-label={t("common.cancel")}
          className="grid size-8 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-hover hover:text-text"
        >
          <Icon name="x" size={16} />
        </Dialog.Close>
      </div>

      <div role="radiogroup" aria-label={t("export.targets")} className="mx-6 mt-4 flex gap-1 rounded-lg border border-line bg-raised p-1">
        {TARGETS.map((item) => {
          const selected = item.id === chosen;
          return (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={selected}
              title={t(item.hint)}
              onClick={() => setTarget(item.id)}
              className={`flex h-8 flex-1 items-center justify-center gap-2 rounded-md text-md transition-colors ${
                selected ? "bg-accent-soft text-text" : "text-muted hover:bg-hover hover:text-text"
              }`}
            >
              <span className={selected ? "text-accent" : "text-faint"}>{item.glyph}</span>
              {t(item.title)}
            </button>
          );
        })}
      </div>

      <div className="mx-6 mt-4 grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] overflow-hidden rounded-lg border border-line">
        <div className="flex min-h-0 flex-col gap-5 overflow-y-auto p-4" data-testid="export-form">
          {showMap && (
            <Section label={t("export.map")}>
              <NativeSelect
                aria-label={t("export.map")}
                value={source.levelId ?? ""}
                disabled={levels.length < 2}
                onChange={(event) => setLevelId(event.target.value)}
              >
                {levels.map((level) => (
                  <option key={level.id} value={level.id}>
                    {level.name}
                  </option>
                ))}
              </NativeSelect>
            </Section>
          )}

          {chosen === "unity" && (
            <>
              <Section label={t("export.destination")}>
                <FolderRow handle={current.unityDir} onPick={() => void pickFolder("unity")} />
                <label className="mt-1 grid grid-cols-[96px_minmax(0,1fr)] items-center gap-2">
                  <span className="text-sm text-muted">{t("export.outputFolder")}</span>
                  <input
                    className={`${inputClass} ${inputOk} font-mono`}
                    value={subfolder}
                    placeholder={t("export.outputFolderPlaceholder")}
                    spellCheck={false}
                    onChange={(event) => setSubfolderDraft(event.target.value)}
                    onBlur={() => {
                      if (subfolderDraft !== null) patch({ unitySubfolder: subfolderDraft });
                    }}
                    data-testid="export-subfolder"
                  />
                </label>
                <span className="truncate font-mono text-xs text-faint" title={t("export.unityFolderHint")}>
                  {[current.unityDir?.name ?? "…", outputSubfolder(subfolder), derived.files?.mapFile].filter(Boolean).join(" / ")}
                </span>
              </Section>

              <Section label={t("export.options")}>
                <CheckRow checked={current.unityTiles} onChange={(unityTiles) => patch({ unityTiles })} label={t("export.optTiles")} />
                <CheckRow
                  checked={current.unityCollision}
                  onChange={(unityCollision) => patch({ unityCollision })}
                  label={t("export.optCollision")}
                  meta={t("export.optCollisionCount", { count: formatNumber(derived.solidCells) })}
                />
                <CheckRow checked={current.copyTextures} onChange={(copyTextures) => patch({ copyTextures })} label={t("export.optTextures")} />
                <span className="pl-6 text-xs text-faint">{t("export.optTexturesHint")}</span>
              </Section>

              <Section label={t("export.scale")}>
                <div className="flex items-center gap-3">
                  <output className="flex h-7 w-16 items-center rounded-md border border-line bg-raised px-2 font-mono text-md text-text tabular" data-testid="export-ppu">
                    {source.document.map.tileWidth}
                  </output>
                  <span className="text-md text-muted">{t("export.ppu")}</span>
                  <span className="ml-auto font-mono text-xs text-faint tabular">
                    {t("export.ppuTile", { width: source.document.map.tileWidth, height: source.document.map.tileHeight })}
                  </span>
                </div>
                <span className="text-xs text-faint">{t("export.ppuHint")}</span>
              </Section>
            </>
          )}

          {chosen === "png" && (
            <PngOptions
              width={derived.imageSize.width}
              height={derived.imageSize.height}
              scale={pngScale}
              onScale={(next) => {
                setScale(next);
                patch({ pngScale: next });
              }}
            />
          )}

          {chosen === "tmj" && (
            <Section label={t("export.destination")}>
              <FolderRow handle={current.tmjDir} onPick={() => void pickFolder("tmj")} />
              <span className="text-xs text-faint">{t("export.tmjFolderHint")}</span>
            </Section>
          )}

          {chosen !== "zip" && (
            <LayerList
              summaries={derived.summaries}
              selected={derived.layers}
              disabled={chosen === "unity" && !current.unityTiles}
              onToggle={setLayer}
            />
          )}

          {chosen === "json" && (
            <Section label={t("export.files")}>
              <FileList paths={[`${exportBaseName(sourceLevelName(source))}.json`]} />
              <span className="text-xs text-faint">{t("export.jsonHint")}</span>
            </Section>
          )}
          {chosen === "tmj" && derived.files && (
            <Section label={t("export.files")}>
              <FileList paths={displayOrder(derived.files.files.map((f) => f.path), derived.files.mapFile)} />
            </Section>
          )}
          {chosen === "zip" && <ZipFiles project={project} />}
        </div>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto border-l border-line p-4">
          <Section label={t("export.preview")}>
            <MapPreview document={source.document} layers={derived.exported} />
            <span className="font-mono text-xs text-muted tabular">
              {t("export.previewInfo", {
                width: source.document.map.width,
                height: source.document.map.height,
                layers: derived.exported.length,
              })}
            </span>
          </Section>

          <Section label={t("export.checkTitle")}>
            <ul className="flex flex-col gap-1.5" data-testid="export-checks">
              {derived.checks.map((check) => (
                <CheckItem key={check.id} check={check} />
              ))}
            </ul>
            <span className="text-sm text-faint" data-testid="export-ready">
              {!ready
                ? chosen === "png" && !pngOk
                  ? t("export.toastPngTooLarge")
                  : t("export.notReady")
                : derived.checks.some((c) => c.state === "warn")
                  ? t("export.readyWarnings")
                  : t("export.ready")}
            </span>
          </Section>

          <WarningsNotice warnings={derived.warnings.filter((w) => w.code === "collisionExceptions")} />

          {chosen === "unity" && (
            <div className="mt-auto flex items-center gap-3 rounded-lg border border-line bg-raised p-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-hover text-muted">
                <Icon name="upload" size={16} />
              </span>
              <Toggle
                checked={current.autoUnity && current.unityDir !== null}
                disabled={current.unityDir === null}
                onChange={(autoUnity) => patch({ autoUnity })}
                label={t("export.autoUnity")}
                hint={current.unityDir !== null ? t("export.autoUnityHint") : t("export.autoUnityNeedsFolder")}
              />
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 px-6 py-4">
        <Dialog.Close render={<Button className="h-10 min-w-[120px]">{t("common.cancel")}</Button>} />
        <span className="min-w-0 truncate font-mono text-xs text-faint tabular">
          {chosen === "unity" && current.lastUnityAt !== null ? t("export.lastExport", { time: formatClock(new Date(current.lastUnityAt)) }) : ""}
        </span>
        <Button
          ref={submitRef}
          type="submit"
          variant="primary"
          disabled={busy || !ready}
          className="ml-auto h-10 min-w-[200px] text-lg"
          data-testid="export-submit"
        >
          {busy ? t("export.working") : t("export.exportButton")}
          {!busy && <ExportIcon />}
        </Button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ parts

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">{label}</span>
      {children}
    </div>
  );
}

function CheckRow({
  checked,
  onChange,
  label,
  meta,
  disabled = false,
}: {
  checked: boolean;
  onChange(checked: boolean): void;
  label: string;
  meta?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex h-7 items-center gap-2.5 ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="size-3.5 shrink-0 accent-accent"
      />
      <span className="min-w-0 flex-1 truncate text-md text-text">{label}</span>
      {meta !== undefined && <span className="shrink-0 font-mono text-xs text-faint tabular">{meta}</span>}
    </label>
  );
}

function LayerList({
  summaries,
  selected,
  disabled,
  onToggle,
}: {
  summaries: readonly ExportLayerSummary[];
  selected: readonly string[];
  disabled: boolean;
  onToggle(layerId: string, include: boolean): void;
}) {
  const on = new Set(selected);
  // Top layer first, like the layer panel.
  const rows = [...summaries].reverse();
  return (
    <Section label={t("export.layers")}>
      {rows.length === 0 ? (
        <span className="text-sm text-faint">{t("export.noLayers")}</span>
      ) : (
        <div className="flex flex-col" data-testid="export-layers">
          {rows.map((layer) => (
            <CheckRow
              key={layer.id}
              checked={on.has(layer.id)}
              disabled={disabled}
              onChange={(include) => onToggle(layer.id, include)}
              label={layer.visible ? layer.name : `${layer.name} · ${t("export.layerHidden")}`}
              meta={t("export.layerTiles", { count: formatNumber(layer.tiles) })}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

function CheckItem({ check }: { check: ExportCheck }) {
  const tone = check.state === "ok" ? "text-success" : check.state === "warn" ? "text-warning" : "text-danger";
  return (
    <li className="flex items-start gap-2" data-state={check.state}>
      <span className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border ${tone} border-current`}>
        <Icon name={check.state === "ok" ? "check" : "alert"} size={10} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-md text-text">{t(check.label)}</span>
        {check.detail && <span className="text-xs break-words text-faint">{t(check.detail.key, check.detail.params)}</span>}
      </span>
    </li>
  );
}

/** Largest map image composited at 1× before scaling down smoothly (bigger maps draw tiles straight at the small scale). */
const PREVIEW_FULL_PIXELS = 16 * 1024 * 1024;

/** Live thumbnail of what is exported: the chosen visible tile layers, scaled to fit. */
function MapPreview({ document, layers }: { document: MapDocument; layers: readonly string[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const list = layerDrawList(document, { layers });
    const box = canvas.parentElement!.getBoundingClientRect();
    const fit = Math.min((box.width || 360) / Math.max(1, list.width), (box.height || 220) / Math.max(1, list.height), 4);
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(1, Math.round(list.width * fit));
    const cssH = Math.max(1, Math.round(list.height * fit));
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const image = (id: string) => getTilesetImage(id)?.bitmap;
    const scale = canvas.width / Math.max(1, list.width);
    if (list.width * list.height <= PREVIEW_FULL_PIXELS && typeof OffscreenCanvas !== "undefined" && scale < 1) {
      // Composite at 1×, then scale down with smoothing: no gaps between tiles.
      const full = new OffscreenCanvas(Math.max(1, list.width), Math.max(1, list.height));
      const fullCtx = full.getContext("2d");
      if (fullCtx) {
        replayOps(fullCtx, compositeOps(list, 1), image);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(full, 0, 0, canvas.width, canvas.height);
        return;
      }
    }
    replayOps(ctx, compositeOps(list, scale), image);
  }, [document, layers]);
  return (
    <div className="grid h-[240px] place-items-center overflow-hidden rounded-md border border-line bg-canvas">
      <canvas ref={canvasRef} aria-label={t("export.preview")} data-testid="export-preview" />
    </div>
  );
}

function PngOptions({ width, height, scale, onScale }: { width: number; height: number; scale: PngScale; onScale(scale: PngScale): void }) {
  const size = pngSize(width, height, scale);
  const fits = pngFits(width, height, scale);
  const fallback = largestFittingScale(width, height);
  return (
    <Section label={t("export.scale")}>
      <div role="radiogroup" aria-label={t("export.scale")} className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-raised p-1">
        {PNG_SCALES.map((option) => {
          const selected = option === scale;
          const optionSize = pngSize(width, height, option);
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onScale(option)}
              className={`flex flex-col items-center gap-0.5 rounded-md px-2 py-1.5 transition-colors ${
                selected ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover hover:text-text"
              }`}
            >
              <span className="text-md font-medium">{option}×</span>
              <span className={`font-mono text-2xs tabular ${pngFits(width, height, option) ? "text-faint" : "text-warning"}`}>
                {optionSize.width} × {optionSize.height}
              </span>
            </button>
          );
        })}
      </div>
      {fits ? (
        <span className="font-mono text-md text-text tabular" data-testid="png-size">
          {t("export.pngSize", { width: size.width, height: size.height })}
        </span>
      ) : (
        <Notice tone="warning">
          <div className="flex flex-col items-start gap-2">
            <span>{fallback === null ? t("export.pngNoFit") : t("export.pngTooLarge", { scale, max: PNG_MAX_SIDE })}</span>
            {fallback !== null && (
              <button type="button" onClick={() => onScale(fallback)} className="font-medium underline underline-offset-2">
                {t("export.pngUseScale", { scale: fallback })}
              </button>
            )}
          </div>
        </Notice>
      )}
      <span className="text-xs text-faint">{t("export.pngHint")}</span>
    </Section>
  );
}

function ZipFiles({ project }: { project: OpenProject }) {
  const paths = useMemo(() => previewZipFiles(project).map((f) => f.path), [project]);
  return (
    <Section label={t("export.files")}>
      <FileList paths={[...paths, "stamps/"]} />
      <span className="text-xs text-faint">{t("export.zipHint", { file: `${project.name}.zip` })}</span>
    </Section>
  );
}

function FolderRow({ handle, onPick }: { handle: FileSystemDirectoryHandle | null; onPick(): void }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-raised px-2.5">
        <Icon name="folder" size={14} className={handle ? "shrink-0 text-accent" : "shrink-0 text-faint"} />
        {handle ? (
          <span className="truncate font-mono text-sm text-text" data-testid="export-folder">
            {handle.name}
          </span>
        ) : (
          <span className="truncate text-sm text-faint">{t("export.noFolder")}</span>
        )}
      </div>
      <Button onClick={onPick} className="size-8 shrink-0 px-0" aria-label={handle ? t("export.changeFolder") : t("export.pickFolder")} title={handle ? t("export.changeFolder") : t("export.pickFolder")}>
        <Icon name="folder" size={15} />
      </Button>
    </div>
  );
}

function FileList({ paths }: { paths: readonly string[] }) {
  return (
    <ul className="flex max-h-[96px] flex-col gap-0.5 overflow-y-auto rounded-md border border-line-subtle bg-panel px-2.5 py-2">
      {paths.map((path) => (
        <li key={path} className="flex items-center gap-2 font-mono text-xs text-muted">
          <span className="text-faint">{path.toLowerCase().endsWith(".png") ? <Icon name="image" size={12} /> : <FileGlyph />}</span>
          <span className="truncate">{path}</span>
        </li>
      ))}
    </ul>
  );
}

function Notice({ tone, children }: { tone: "warning" | "info"; children: ReactNode }) {
  return (
    <div
      className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm ${
        tone === "warning" ? "bg-warning-soft text-warning" : "bg-panel text-muted"
      }`}
    >
      <Icon name={tone === "warning" ? "warning" : "info"} size={14} className="mt-px shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Map file last, so it reads first in the list. */
function displayOrder(paths: readonly string[], mapFile: string): string[] {
  return [mapFile, ...paths.filter((p) => !p.endsWith(mapFile))];
}

/** The exporter's warnings, translated; nothing when the export lost nothing. */
function WarningsNotice({ warnings }: { warnings: readonly ExportWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <Notice tone="warning">
      <span className="font-medium">{t("export.warnings")}</span>
      <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4">
        {warnings.map((warning) => (
          <li key={warning.message}>{warningText(warning)}</li>
        ))}
      </ul>
    </Notice>
  );
}

function warningText(warning: ExportWarning): string {
  switch (warning.code) {
    case "missingTilesets":
      return t("export.warnMissingTilesets", { ids: warning.tilesets.join(", ") });
    case "tileIdsOutOfRange":
      return t("export.warnTileOutOfRange", { tileset: warning.tileset, ids: warning.tileIds.join(", ") });
    case "collisionExceptions":
      return t("export.warnCollisionExceptions", { layers: warning.layers.join(", ") });
  }
}

function Toggle({
  checked,
  disabled,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  disabled: boolean;
  onChange(checked: boolean): void;
  label: string;
  hint: string;
}) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-[18px] w-8 shrink-0 rounded-full transition-colors duration-150 ${
          checked ? "bg-accent" : "bg-line-strong"
        }`}
      >
        <span
          className={`absolute top-[3px] left-[3px] size-3 rounded-full bg-text transition-transform duration-150 ease-(--ease-out) ${
            checked ? "translate-x-[14px]" : ""
          }`}
        />
      </button>
      <span className="flex flex-col gap-0.5">
        <span className="text-md text-text">{label}</span>
        <span className="text-xs text-faint">{hint}</span>
      </span>
    </label>
  );
}

// ------------------------------------------------------------------ glyphs (Icon geometry, export-only)

function Glyph({ size = 16, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function CubeGlyph() {
  return (
    <Glyph>
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </Glyph>
  );
}

function BracesGlyph() {
  return (
    <Glyph>
      <path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1" />
      <path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1" />
    </Glyph>
  );
}

function FileGlyph() {
  return (
    <Glyph size={12}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </Glyph>
  );
}

/** Toolbar icon for file.export (arrow leaving a tray). */
export function ExportIcon() {
  return (
    <Glyph>
      <path d="M12 15V3" />
      <path d="m7 8 5-5 5 5" />
      <path d="M20 15v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4" />
    </Glyph>
  );
}
