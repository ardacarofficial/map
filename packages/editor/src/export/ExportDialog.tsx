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
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement, type ReactNode, type RefObject } from "react";

import { formatNumber, t, type MessageKey } from "../i18n";
import { useProjectLibrary } from "../io/projectLibrary";
import { describeError } from "../io/session";
import { useEditorStore, type OpenProject } from "../state/editorStore";
import { getTilesetImage } from "../state/tilesetImages";
import { backdropClass, popupClass, dialogWidthL } from "../ui/dialogs/styles";
import { DialogHeader, DialogBody, DialogFooter, dialogLayoutClass } from "../ui/dialogs/DialogFrame";
import { Segmented } from "../ui/primitives/Segmented";
import { DialogToggle as Toggle } from "../ui/dialogs/DialogFrame";
import { Button, IconButton } from "../ui/primitives/Button";
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
  const popupRef = useRef<HTMLDivElement>(null);
  const open = useExportStore((s) => s.open);
  const setOpen = useExportStore((s) => s.setOpen);
  const project = useEditorStore((s) => s.project);
  // Focus the export button, so Enter exports right away.
  const submitRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog.Root open={open && project !== null} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdropClass} />
        <Dialog.Popup ref={popupRef} initialFocus={() => submitRef.current && !submitRef.current.disabled ? submitRef.current : popupRef.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]:not(:disabled), footer button:not(:disabled)') ?? popupRef.current} className={`${popupClass} ${dialogWidthL} ${dialogLayoutClass}`}>
          {open && project && <ExportForm project={project} submitRef={submitRef} onDone={() => setOpen(false)} />}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const TARGETS: { id: ExportTarget; title: MessageKey; hint: MessageKey; glyph: ReactElement }[] = [
  { id: "unity", title: "export.targetUnity", hint: "export.targetUnityHint", glyph: <Icon name="box" size={16} /> },
  { id: "png", title: "export.targetPng", hint: "export.targetPngHint", glyph: <Icon name="image" size={16} /> },
  { id: "json", title: "export.targetJson", hint: "export.targetJsonHint", glyph: <Icon name="file-plus" size={16} /> },
  { id: "tmj", title: "export.targetTmj", hint: "export.targetTmjHint", glyph: <Icon name="grid" size={16} /> },
  { id: "zip", title: "export.targetZip", hint: "export.targetZipHint", glyph: <Icon name="folder" size={16} /> },
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
  const showMap = chosen !== "zip" && levels.length > 1;
  const subfolder = subfolderDraft ?? current.unitySubfolder;

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 max-h-[calc(100vh-32px)] flex-col">
      <DialogHeader title={chosen === "unity" ? t("export.titleUnity") : t("export.title")}
        subtitle={chosen === "zip" ? t("export.description") : <>{before}<span className="text-text">{mapName}</span>{after}</>} onClose={onDone} />
      <Segmented<ExportTarget> size="md" label={t("export.targets")} value={chosen} onValueChange={setTarget} className="mx-4 shrink-0"
        items={TARGETS.map(item => ({ value: item.id, label: t(item.title), tooltip: t(item.hint), icon: item.glyph }))} />
      <DialogBody className="grid grid-cols-2 gap-4 pt-3">
        <div className="flex min-w-0 flex-col gap-4" data-testid="export-form">
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
                <label className="mt-1 flex flex-col gap-2">
                  <span className="text-sm text-muted">{t("export.outputFolder")}</span>
                  <input
                    className={`${inputClass} ${inputOk} `}
                    value={subfolder}
                    placeholder={t("export.outputFolderPlaceholder")}
                    spellCheck={false}
                    onChange={(event) => setSubfolderDraft(event.target.value)}
                    onBlur={() => {
                      if (subfolderDraft !== null) patch({ unitySubfolder: subfolderDraft });
                    }}
                    title={[current.unityDir?.name ?? "…", outputSubfolder(subfolder), derived.files?.mapFile].filter(Boolean).join(" / ")}
                    data-testid="export-subfolder"
                  />
                </label>

              </Section>

              <Section label={t("export.options")}>
                <div className="grid grid-cols-2 gap-x-3">
                <CheckRow checked={current.unityTiles} onChange={(unityTiles) => patch({ unityTiles })} label={t("export.optTiles")} />
                <CheckRow
                  checked={current.unityCollision}
                  onChange={(unityCollision) => patch({ unityCollision })}
                  label={t("export.optCollision")}
                  meta={t("export.optCollisionCount", { count: formatNumber(derived.solidCells) })}
                />
                </div>
                <CheckRow checked={current.copyTextures} onChange={(copyTextures) => patch({ copyTextures })} label={t("export.optTextures")} />
              </Section>

              <div className="flex items-center gap-2 text-sm text-muted">
                <span>{t("export.ppu")}</span><output className="text-text tabular" data-testid="export-ppu">{source.document.map.tileWidth}</output>
                <span className="ml-auto text-xs tabular">{t("export.ppuTile", { width: source.document.map.tileWidth, height: source.document.map.tileHeight })}</span>
              </div>
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


        </div>

        <div className="flex min-w-0 flex-col gap-4 border-l border-line-subtle pl-4">
          <Section label={t("export.preview")}>
            <MapPreview document={source.document} layers={derived.exported} />
            <span className="text-xs text-muted tabular">
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
            <span className="text-sm text-muted" data-testid="export-ready">
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

          {chosen === "json" && (
            <Section label={t("export.files")}>
              <FileList paths={[`${exportBaseName(sourceLevelName(source))}.json`]} />
            </Section>
          )}
          {(chosen === "tmj" || chosen === "unity") && derived.files && (
            <Section label={t("export.files")}>
              <FileList paths={displayOrder(derived.files.files.map((f) => f.path), derived.files.mapFile)} />
            </Section>
          )}
          {chosen === "zip" && <ZipFiles project={project} />}
          {chosen === "unity" && <label className="flex items-center gap-2" title={current.unityDir !== null ? t("export.autoUnityHint") : t("export.autoUnityNeedsFolder")}>
            <Toggle checked={current.autoUnity && current.unityDir !== null} disabled={current.unityDir === null}
              onChange={autoUnity => patch({ autoUnity })} label={t("export.autoUnity")} />
            <span className="text-sm text-text">{t("export.autoUnity")}</span>
          </label>}
        </div>
      </DialogBody>

      <DialogFooter status={chosen === "unity" && current.lastUnityAt !== null ? t("export.lastExport", { time: formatClock(new Date(current.lastUnityAt)) }) : undefined}>
        <Button variant="secondary" onClick={onDone}>{t("common.cancel")}</Button>
        <Button
          ref={submitRef}
          type="submit"
          variant="primary"
          disabled={busy || !ready}
          data-testid="export-submit"
        >
          <ExportIcon />
          {busy ? t("export.working") : t("export.exportButton")}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ------------------------------------------------------------------ parts

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold tracking-section text-muted uppercase">{label}</span>
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
    <label title={label} className={`flex h-control-md items-center gap-2 ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 shrink-0 accent-muted"
      />
      <span className="min-w-0 flex-1 truncate text-sm text-text">{label}</span>
      {meta !== undefined && <span className="shrink-0 text-xs text-muted tabular">{meta}</span>}
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
        <span className="text-sm text-muted">{t("export.noLayers")}</span>
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
      <Icon name={check.state === "ok" ? "tick" : "circle-alert"} size={16} className={`mt-0.5 shrink-0 ${tone}`} />
      <span className="flex min-w-0 flex-col">
        <span className="text-md text-text">{t(check.label)}</span>
        {check.detail && <span className="text-xs break-words text-muted">{t(check.detail.key, check.detail.params)}</span>}
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
    <div className="grid aspect-video max-h-48 place-items-center overflow-hidden rounded-md bg-canvas">
      <canvas ref={canvasRef} aria-label={t("export.preview")} className="bg-checker-a" data-testid="export-preview" />
    </div>
  );
}

function PngOptions({ width, height, scale, onScale }: { width: number; height: number; scale: PngScale; onScale(scale: PngScale): void }) {
  const size = pngSize(width, height, scale);
  const fits = pngFits(width, height, scale);
  const fallback = largestFittingScale(width, height);
  return (
    <Section label={t("export.scale")}>
      <Segmented size="md" label={t("export.scale")} value={String(scale)} onValueChange={value => onScale(Number(value) as PngScale)}
        items={PNG_SCALES.map(option => ({ value: String(option), label: `${option}×`, tooltip: t("export.pngSize", pngSize(width, height, option)) }))} />
      {fits ? (
        <span className="text-md text-text tabular" data-testid="png-size">
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
    </Section>
  );
}

function ZipFiles({ project }: { project: OpenProject }) {
  const paths = useMemo(() => previewZipFiles(project).map((f) => f.path), [project]);
  return (
    <Section label={t("export.files")}>
      <FileList paths={[...paths, "stamps/"]} />
    </Section>
  );
}

function FolderRow({ handle, onPick }: { handle: FileSystemDirectoryHandle | null; onPick(): void }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Icon name="folder" size={16} className="shrink-0 text-muted" />
        {handle ? <span className="truncate text-sm text-text" data-testid="export-folder">{handle.name}</span> : <span className="truncate text-sm text-muted">{t("export.noFolder")}</span>}
      </div>
      <IconButton size="md" onClick={onPick} aria-label={handle ? t("export.changeFolder") : t("export.pickFolder")} title={handle ? t("export.changeFolder") : t("export.pickFolder")}>
        <Icon name="folder" size={16} />
      </IconButton>
    </div>
  );
}

function FileList({ paths }: { paths: readonly string[] }) {
  return (
    <ul className="flex max-h-24 flex-col gap-1 overflow-y-auto">
      {paths.map((path) => (
        <li key={path} className="flex items-center gap-2 text-xs text-muted">
          <span className="text-muted">{path.toLowerCase().endsWith(".png") ? <Icon name="image" size={12} /> : <Icon name="file-plus" size={12} />}</span>
          <span className="truncate">{path}</span>
        </li>
      ))}
    </ul>
  );
}

function Notice({ tone, children }: { tone: "warning" | "info"; children: ReactNode }) {
  return (
    <div
      className={`flex items-start gap-2 text-sm ${
        tone === "warning" ? "text-warning" : "text-muted"
      }`}
    >
      <Icon name={tone === "warning" ? "warning" : "info"} size={16} className="mt-px shrink-0" />
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

/** Toolbar icon for file.export. */
export function ExportIcon() {
  return <Icon name="upload" size={16} />;
}
