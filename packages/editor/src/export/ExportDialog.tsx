/**
 * file.export (Ctrl+E): Unity / PNG / JSON / Tiled. The last target, PNG
 * scale, folders and "export to Unity on save" are remembered per project.
 */
import { Dialog } from "@base-ui/react/dialog";
import { exportBaseName, layerDrawList } from "@smap/core";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";

import { t, type MessageKey } from "../i18n";
import { useEditorStore, type OpenProject } from "../state/editorStore";
import { backdropClass, popupClass } from "../ui/dialogs/styles";
import { Button } from "../ui/primitives/Button";
import { Icon } from "../ui/primitives/Icon";
import { toast } from "../ui/toast/toastStore";
import { describeError } from "../io/session";
import {
  chooseExportFolder,
  exportJson,
  exportPng,
  exportToTiled,
  exportToUnity,
  exportZip,
  previewZipFiles,
  formatClock,
  previewFiles,
  projectLevelName,
  type FolderKind,
} from "./exportActions";
import { defaultExportSettings, loadExportSettings, updateExportSettings, type ExportSettings, type ExportTarget } from "./exportSettings";
import { useExportStore } from "./exportStore";
import { largestFittingScale, PNG_MAX_SIDE, PNG_SCALES, pngFits, pngSize, type PngScale } from "./pngComposite";

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
        <Dialog.Popup initialFocus={submitRef} className={`${popupClass} w-[640px] max-w-[calc(100vw-32px)]`}>
          {open && project && <ExportForm project={project} submitRef={submitRef} onDone={() => setOpen(false)} />}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const TARGETS: { id: ExportTarget; title: MessageKey; hint: MessageKey; glyph: ReactNode }[] = [
  { id: "unity", title: "export.targetUnity", hint: "export.targetUnityHint", glyph: <CubeGlyph /> },
  { id: "png", title: "export.targetPng", hint: "export.targetPngHint", glyph: <Icon name="image" size={16} /> },
  { id: "json", title: "export.targetJson", hint: "export.targetJsonHint", glyph: <BracesGlyph /> },
  { id: "tmj", title: "export.targetTmj", hint: "export.targetTmjHint", glyph: <Icon name="grid" size={16} /> },
  { id: "zip", title: "export.targetZip", hint: "export.targetZipHint", glyph: <Icon name="folder" size={16} /> },
];

const ACTION: Record<ExportTarget, MessageKey> = {
  unity: "export.exportUnity",
  png: "export.exportPng",
  json: "export.exportJson",
  tmj: "export.exportTmj",
  zip: "export.exportZip",
};

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
  const [settings, setSettings] = useState<ExportSettings | null>(null);
  const [target, setTarget] = useState<ExportTarget | null>(null);
  const [scale, setScale] = useState<PngScale | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadExportSettings(project.name).then((loaded) => {
      if (cancelled) return;
      setSettings(loaded);
      setTarget((current) => current ?? loaded.target);
      setScale((current) => current ?? loaded.pngScale);
    });
    return () => {
      cancelled = true;
    };
  }, [project.name, revision]);

  const current = settings ?? defaultExportSettings(project.name);
  const chosen = target ?? current.target;
  const pngScale = scale ?? current.pngScale;
  const imageSize = useMemo(() => {
    const list = layerDrawList(project.store.document);
    return { width: list.width, height: list.height };
  }, [project]);
  const pngOk = pngFits(imageSize.width, imageSize.height, pngScale);

  const patch = (next: Partial<ExportSettings>) => {
    void updateExportSettings(project.name, next).then(setSettings);
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
    if (busy) return;
    const run = async (): Promise<boolean> => {
      switch (chosen) {
        case "unity":
          return (await exportToUnity()) !== null;
        case "tmj":
          return (await exportToTiled()) !== null;
        case "png":
          return pngOk && (await exportPng(pngScale));
        case "json":
          return exportJson();
        case "zip":
          return exportZip();
      }
    };
    void run().then((ok) => ok && onDone());
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col">
      <div className="flex flex-col gap-1 px-5 pt-5">
        <Dialog.Title className="text-lg font-semibold">{t("export.title")}</Dialog.Title>
        <Dialog.Description className="text-md text-muted">{t("export.description")}</Dialog.Description>
      </div>
      <div className="flex gap-4 px-5 py-5">
        <div role="radiogroup" aria-label={t("export.targets")} className="flex w-[184px] shrink-0 flex-col gap-1">
          {TARGETS.map((item) => {
            const selected = item.id === chosen;
            return (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setTarget(item.id)}
                className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                  selected
                    ? "border-accent-line bg-accent-soft"
                    : "border-transparent hover:bg-hover"
                }`}
              >
                <span
                  className={`grid size-7 shrink-0 place-items-center rounded-md ${
                    selected ? "bg-accent text-on-accent" : "bg-panel text-muted"
                  }`}
                >
                  {item.glyph}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className={`text-md font-medium ${selected ? "text-text" : "text-muted"}`}>{t(item.title)}</span>
                  <span className="truncate text-xs text-faint">{t(item.hint)}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex min-h-[248px] min-w-0 flex-1 flex-col gap-4 border-l border-line pl-4">
          {chosen === "unity" && (
            <UnityPanel
              project={project}
              settings={current}
              onPick={() => void pickFolder("unity")}
              onAuto={(autoUnity) => patch({ autoUnity })}
            />
          )}
          {chosen === "png" && (
            <PngPanel width={imageSize.width} height={imageSize.height} scale={pngScale} onScale={setScale} />
          )}
          {chosen === "json" && <JsonPanel project={project} />}
          {chosen === "zip" && <ZipPanel project={project} />}
          {chosen === "tmj" && <TmjPanel project={project} settings={current} onPick={() => void pickFolder("tmj")} />}
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-line px-5 py-3">
        <span className="min-w-0 truncate font-mono text-xs text-faint tabular">
          {chosen === "unity" && current.lastUnityAt !== null
            ? t("export.lastExport", { time: formatClock(new Date(current.lastUnityAt)) })
            : " "}
        </span>
        <div className="ml-auto flex gap-2">
          <Dialog.Close render={<Button variant="ghost">{t("common.cancel")}</Button>} />
          <Button ref={submitRef} type="submit" variant="primary" disabled={busy || (chosen === "png" && !pngOk)}>
            {busy ? t("export.working") : t(ACTION[chosen])}
          </Button>
        </div>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ panels

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-muted">{label}</span>
      {children}
    </div>
  );
}

function FolderRow({ handle, onPick }: { handle: FileSystemDirectoryHandle | null; onPick(): void }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-panel px-2.5">
        <Icon name="folder" size={14} className={handle ? "shrink-0 text-accent" : "shrink-0 text-faint"} />
        {handle ? (
          <span className="truncate font-mono text-sm text-text" data-testid="export-folder">
            {handle.name}
          </span>
        ) : (
          <span className="truncate text-sm text-faint">{t("export.noFolder")}</span>
        )}
      </div>
      <Button onClick={onPick} className="shrink-0">{handle ? t("export.changeFolder") : t("export.pickFolder")}</Button>
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
  return [mapFile, ...paths.filter((p) => p !== mapFile)];
}

function UnityPanel({
  project,
  settings,
  onPick,
  onAuto,
}: {
  project: OpenProject;
  settings: ExportSettings;
  onPick(): void;
  onAuto(on: boolean): void;
}) {
  const set = useMemo(() => previewFiles("unity", project), [project]);
  const hasFolder = settings.unityDir !== null;
  return (
    <>
      <Section label={t("export.folder")}>
        <FolderRow handle={settings.unityDir} onPick={onPick} />
        <span className="text-xs text-faint">{t("export.unityFolderHint")}</span>
      </Section>
      <Toggle
        checked={settings.autoUnity && hasFolder}
        disabled={!hasFolder}
        onChange={onAuto}
        label={t("export.autoUnity")}
        hint={hasFolder ? t("export.autoUnityHint") : t("export.autoUnityNeedsFolder")}
      />
      <Section label={t("export.files")}>
        <FileList paths={displayOrder(set.files.map((f) => f.path), set.mapFile)} />
      </Section>
    </>
  );
}

function PngPanel({
  width,
  height,
  scale,
  onScale,
}: {
  width: number;
  height: number;
  scale: PngScale;
  onScale(scale: PngScale): void;
}) {
  const size = pngSize(width, height, scale);
  const fits = pngFits(width, height, scale);
  const fallback = largestFittingScale(width, height);
  return (
    <>
      <Section label={t("export.scale")}>
        <div role="radiogroup" aria-label={t("export.scale")} className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-panel p-1">
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
      </Section>
      {fits ? (
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-lg text-text tabular" data-testid="png-size">
            {t("export.pngSize", { width: size.width, height: size.height })}
          </span>
        </div>
      ) : (
        <Notice tone="warning">
          <div className="flex flex-col items-start gap-2">
            <span>
              {fallback === null ? t("export.pngNoFit") : t("export.pngTooLarge", { scale, max: PNG_MAX_SIDE })}
            </span>
            {fallback !== null && (
              <button type="button" onClick={() => onScale(fallback)} className="font-medium underline underline-offset-2">
                {t("export.pngUseScale", { scale: fallback })}
              </button>
            )}
          </div>
        </Notice>
      )}
      <span className="text-xs text-faint">{t("export.pngHint")}</span>
    </>
  );
}

function JsonPanel({ project }: { project: OpenProject }) {
  const fileName = `${exportBaseName(projectLevelName(project))}.json`;
  return (
    <>
      <Section label={t("export.files")}>
        <FileList paths={[fileName]} />
      </Section>
      <span className="text-xs text-faint">{t("export.jsonHint")}</span>
    </>
  );
}

function ZipPanel({ project }: { project: OpenProject }) {
  const paths = useMemo(() => previewZipFiles(project).map((f) => f.path), [project]);
  return (
    <>
      <Section label={t("export.files")}>
        <FileList paths={[...paths, "stamps/"]} />
      </Section>
      <span className="text-xs text-faint">{t("export.zipHint", { file: `${project.name}.zip` })}</span>
    </>
  );
}

function TmjPanel({ project, settings, onPick }: { project: OpenProject; settings: ExportSettings; onPick(): void }) {
  const set = useMemo(() => previewFiles("tmj", project), [project]);
  return (
    <>
      <Section label={t("export.folder")}>
        <FolderRow handle={settings.tmjDir} onPick={onPick} />
        <span className="text-xs text-faint">{t("export.tmjFolderHint")}</span>
      </Section>
      <Section label={t("export.files")}>
        <FileList paths={displayOrder(set.files.map((f) => f.path), set.mapFile)} />
      </Section>
      {set.warnings.length > 0 && (
        <Notice tone="warning">
          <span className="font-medium">{t("export.warnings")}</span>
          <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4">
            {set.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Notice>
      )}
    </>
  );
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
