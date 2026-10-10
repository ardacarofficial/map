import { Dialog } from "@base-ui/react/dialog";
import { normalizeProjectSettings } from "@smap/core";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { create } from "zustand";

import { t } from "../../i18n";
import { confirmDiscard, describeError, newProject, planStartingTileset, type PlannedTileset } from "../../io/session";
import { FolderTakenError, getPlatform, type ProjectLocation } from "../../platform";
import { Button } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { Toggle } from "../primitives/Toggle";
import { pickFiles } from "../pickFiles";
import {
  BackgroundField,
  LayerKindIcon,
  LayerTemplatePicker,
  MapSizePicker,
  Section,
  TileSizePicker,
  layersOf,
  mapSizeFrom,
  parseMapSize,
  parseTileSize,
  tileSizeFrom,
  type LayerTemplateValue,
  type MapSizeValue,
  type TileSizeValue,
} from "../projectSettings/fields";
import { cleanLayers, fitPreview, projectTemplate, templateIdOf, type ProjectTemplateId } from "../projectSettings/projectTemplates";
import { useUiStore } from "../uiStore";
import { backdropClass, popupClass } from "./styles";

export { parseIntInRange } from "../projectSettings/projectTemplates";

/** Which welcome template prefilled the dialog (`null` = the "Boş" defaults). */
const useNewProjectPreset = create<{ template: ProjectTemplateId | null }>()(() => ({ template: null }));

/**
 * Opens the new project dialog, prefilled from a template (welcome screen
 * cards) or with the empty defaults. Asks about unsaved work first.
 */
export function openNewProjectDialog(template: ProjectTemplateId | null = null): void {
  void confirmDiscard().then((ok) => {
    if (!ok) return;
    useNewProjectPreset.setState({ template });
    useUiStore.getState().setNewProjectOpen(true);
  });
}

export function NewProjectDialog() {
  const open = useUiStore((s) => s.newProjectOpen);
  const setOpen = useUiStore((s) => s.setNewProjectOpen);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) useNewProjectPreset.setState({ template: null });
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className={backdropClass} />
        <Dialog.Popup
          className={`${popupClass} flex max-h-[calc(100vh-48px)] w-[640px] max-w-[calc(100vw-32px)] flex-col`}
          data-dialog="new-project"
        >
          {open && <NewProjectForm onDone={() => setOpen(false)} />}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

type FolderState = { kind: "unset" } | { kind: "later" } | { kind: "picked"; location: ProjectLocation };

function supportsFolders(): boolean {
  return getPlatform().kind === "desktop" || (typeof window !== "undefined" && "showDirectoryPicker" in window);
}

function NewProjectForm({ onDone }: { onDone(): void }) {
  const preset = projectTemplate(useNewProjectPreset.getState().template ?? "empty");
  const [name, setName] = useState(() => (preset.id === "empty" ? t("newProject.defaultName") : t(`templates.${preset.id}`)));
  const [folder, setFolder] = useState<FolderState>(() => (supportsFolders() ? { kind: "unset" } : { kind: "later" }));
  const [folderError, setFolderError] = useState<string | null>(null);
  const [tile, setTile] = useState<TileSizeValue>(() => tileSizeFrom(preset.tileWidth, preset.tileHeight));
  const [size, setSize] = useState<MapSizeValue>(() => mapSizeFrom(preset.width, preset.height));
  const [layers, setLayers] = useState<LayerTemplateValue>(() => {
    const list = preset.layers();
    const id = templateIdOf(list);
    return { id, custom: list };
  });
  const [tileset, setTileset] = useState<PlannedTileset | null>(null);
  const [tilesetBusy, setTilesetBusy] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [background, setBackground] = useState<string | null>(null);
  const [unityDir, setUnityDir] = useState<FileSystemDirectoryHandle | null>(null);
  const [exportOnSave, setExportOnSave] = useState(false);
  const [touched, setTouched] = useState(false);
  const [pickingFolder, setPickingFolder] = useState(false);
  const nameId = useId();

  // A starting tileset that is not used (dialog closed / replaced) frees its bitmap.
  const tilesetRef = useRef<PlannedTileset | null>(null);
  tilesetRef.current = tileset;
  const keepTileset = useRef(false);
  useEffect(
    () => () => {
      if (!keepTileset.current) tilesetRef.current?.png.bitmap.close();
    },
    [],
  );

  const tileSize = parseTileSize(tile);
  const mapSize = parseMapSize(size);
  const layerList = layersOf(layers);
  const layersOk = layers.id !== "custom" || layers.custom.some((l) => l.name.trim() !== "");
  const nameOk = name.trim().length > 0;
  // No folder chosen = "Sonra seç" (asked on the first save).
  const valid = nameOk && tileSize !== null && mapSize !== null && layersOk;

  const pickFolder = async () => {
    setFolderError(null);
    setPickingFolder(true);
    try {
      const location = await getPlatform().pickProjectFolder(name.trim() || t("newProject.defaultName"), null);
      if (location) setFolder({ kind: "picked", location });
    } catch (error) {
      setFolderError(error instanceof FolderTakenError ? t("newProject.folderTaken", { name: error.folder }) : describeError(error));
    } finally {
      setPickingFolder(false);
    }
  };

  const takeTileset = async (files: readonly File[]) => {
    const file = files[0];
    if (!file || tilesetBusy) return;
    setTilesetBusy(true);
    try {
      const planned = await planStartingTileset(file, tileSize?.width === tileSize?.height ? (tileSize?.width ?? null) : null);
      if (!planned) return;
      tilesetRef.current?.png.bitmap.close();
      setTileset(planned);
      // The tileset knows its tile size: the map follows it.
      setTile(tileSizeFrom(planned.spec.tileWidth, planned.spec.tileHeight));
    } finally {
      setTilesetBusy(false);
    }
  };

  const pickUnityFolder = async () => {
    if (!window.showDirectoryPicker) return;
    try {
      setUnityDir(await window.showDirectoryPicker({ id: "smap-unity", mode: "readwrite" }));
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setFolderError(describeError(error));
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!valid || !tileSize || !mapSize) return;
    const finalLayers = cleanLayers(layerList);
    const settings = normalizeProjectSettings({
      tileWidth: tileSize.width,
      tileHeight: tileSize.height,
      newLevel: { width: mapSize.width, height: mapSize.height },
      // One ground layer is the editor's default: nothing to store.
      layerTemplate: templateIdOf(finalLayers) === "single" ? [] : finalLayers,
      background,
      unity: { folderHint: unityDir?.name ?? "", exportOnSave },
    });
    // The tileset is added with the map's tile size (its offsets kept when the size is the guessed one).
    const planned: PlannedTileset[] = [];
    if (tileset) {
      const same = tileset.spec.tileWidth === tileSize.width && tileset.spec.tileHeight === tileSize.height;
      planned.push({
        ...tileset,
        spec: same ? tileset.spec : { tileWidth: tileSize.width, tileHeight: tileSize.height, margin: 0, spacing: 0 },
      });
      keepTileset.current = true;
    }
    void newProject({
      name: name.trim(),
      width: mapSize.width,
      height: mapSize.height,
      tileSize: tileSize.width,
      tileHeight: tileSize.height,
      layers: finalLayers,
      settings,
      folder: folder.kind === "picked" ? folder.location : null,
      tilesets: planned,
      unityDir,
    });
    onDone();
  };

  // Drops anywhere on the dialog are the starting tileset (never the window-wide "new project from PNG").
  const popupRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const el = popupRef.current;
    if (!el) return;
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    };
    // The window-wide handler (FileDropOverlay) still sees the event to reset its drag state; it ignores drops while this dialog is open.
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      void takeTileset([...e.dataTransfer.files]);
    };
    el.addEventListener("dragover", over);
    el.addEventListener("drop", drop);
    return () => {
      el.removeEventListener("dragover", over);
      el.removeEventListener("drop", drop);
    };
  });

  return (
    <form ref={popupRef} onSubmit={submit} noValidate className="flex min-h-0 flex-col">
      <div className="flex flex-col gap-1 px-5 pt-5">
        <Dialog.Title className="text-lg font-semibold">{t("newProject.title")}</Dialog.Title>
        <Dialog.Description className="text-md text-muted">{t("newProject.description")}</Dialog.Description>
      </div>

      <div className="grid min-h-0 grid-cols-[1fr_232px] gap-5 overflow-y-auto px-5 py-4">
        <div className="flex min-w-0 flex-col gap-4">
          <Section label={t("newProject.name")} htmlFor={nameId}>
            <input
              id={nameId}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              autoFocus
              spellCheck={false}
              autoComplete="off"
              aria-invalid={touched && !nameOk ? true : undefined}
              className={`h-8 w-full rounded-md border bg-panel px-2.5 text-md text-text transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:outline-none ${
                touched && !nameOk ? "border-danger" : "border-line hover:border-line-strong"
              }`}
            />
            {touched && !nameOk && <span className="text-xs text-danger">{t("newProject.errName")}</span>}
          </Section>

          <Section label={t("newProject.location")}>
            <FolderRow
              state={folder}
              busy={pickingFolder}
              supported={supportsFolders()}
              onPick={() => void pickFolder()}
              onLater={() => setFolder({ kind: "later" })}
              error={folderError}
            />
          </Section>

          <Section label={t("newProject.tileSize")}>
            <TileSizePicker value={tile} onChange={setTile} showErrors={touched} />
          </Section>

          <Section label={t("newProject.mapSize")}>
            <MapSizePicker value={size} onChange={setSize} showErrors={touched} />
          </Section>

          <Section label={t("newProject.layerTemplate")}>
            <LayerTemplatePicker value={layers} onChange={setLayers} />
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Preview tile={tileSize} size={mapSize} layers={cleanLayers(layerList)} background={background} />

          <Section label={t("newProject.startTileset")} hint={tileset ? null : t("newProject.startTilesetHint")}>
            <TilesetDrop
              tileset={tileset}
              busy={tilesetBusy}
              onPick={() => void pickFiles("image/png", false).then(takeTileset)}
              onRemove={() => {
                tileset?.png.bitmap.close();
                setTileset(null);
              }}
            />
          </Section>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setAdvanced((v) => !v)}
              aria-expanded={advanced}
              className="flex items-center gap-1 self-start text-sm font-medium text-muted hover:text-text"
            >
              <Icon name="chevronRight" size={13} className={`transition-transform ${advanced ? "rotate-90" : ""}`} />
              {t("newProject.advanced")}
            </button>
            {advanced && (
              <div className="flex flex-col gap-3 rounded-md border border-line bg-panel p-3">
                <Section label={t("newProject.background")}>
                  <BackgroundField value={background} onChange={setBackground} />
                </Section>
                {typeof window !== "undefined" && "showDirectoryPicker" in window && (
                  <Section label={t("newProject.unityFolder")}>
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`min-w-0 flex-1 truncate text-sm ${unityDir ? "text-text" : "text-faint"}`}>
                        {unityDir?.name ?? t("newProject.unityFolderNone")}
                      </span>
                      <Button className="h-7 shrink-0 px-2 text-sm" onClick={() => void pickUnityFolder()}>
                        {t("newProject.unityFolderPick")}
                      </Button>
                    </div>
                  </Section>
                )}
                <label className="flex items-start gap-2">
                  <span className="pt-0.5">
                    <Toggle checked={exportOnSave} onChange={setExportOnSave} label={t("newProject.unityExportOnSave")} />
                  </span>
                  <span className="flex flex-col">
                    <span className="text-sm text-text">{t("newProject.unityExportOnSave")}</span>
                    <span className="text-xs text-faint">{t("newProject.unityExportOnSaveHint")}</span>
                  </span>
                </label>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-line px-5 py-3">
        <div className="ml-auto flex gap-2">
          <Dialog.Close render={<Button variant="ghost">{t("common.cancel")}</Button>} />
          <Button type="submit" variant="primary" disabled={touched && !valid}>
            {t("common.create")}
          </Button>
        </div>
      </div>
    </form>
  );
}

function FolderRow({
  state,
  busy,
  supported,
  onPick,
  onLater,
  error,
}: {
  state: FolderState;
  busy: boolean;
  supported: boolean;
  onPick(): void;
  onLater(): void;
  error: string | null;
}) {
  if (!supported) return <div className="text-xs text-faint">{t("newProject.folderUnsupported")}</div>;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-2">
        {state.kind === "picked" ? (
          <>
            <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-raised px-2.5">
              <Icon name="folder" size={14} className="shrink-0 text-accent" />
              <span className="min-w-0 truncate text-sm text-text" title={state.location.label}>
                {state.location.label}
              </span>
            </div>
            <Button className="shrink-0" onClick={onPick} disabled={busy}>
              {t("newProject.changeFolder")}
            </Button>
          </>
        ) : (
          <>
            <Button variant={state.kind === "unset" ? "primary" : "secondary"} onClick={onPick} disabled={busy}>
              <Icon name="folder" size={14} />
              {t("newProject.pickFolder")}
            </Button>
            <button
              type="button"
              onClick={onLater}
              aria-pressed={state.kind === "later"}
              className={`h-8 rounded-md px-2.5 text-sm transition-colors ${
                state.kind === "later" ? "bg-active text-text" : "text-muted hover:bg-hover hover:text-text"
              }`}
            >
              {t("newProject.pickLater")}
            </button>
          </>
        )}
      </div>
      {error ? (
        <span className="text-xs text-danger">{error}</span>
      ) : (
        <span className="text-xs text-faint">{state.kind === "later" ? t("newProject.laterHint") : t("newProject.folderHint")}</span>
      )}
    </div>
  );
}

/** Proportional map box with its grid, the layer stack and the pixel size. */
function Preview({
  tile,
  size,
  layers,
  background,
}: {
  tile: { width: number; height: number } | null;
  size: { width: number; height: number } | null;
  layers: readonly { name: string; kind: "tile" | "collision" | "entity" }[];
  background: string | null;
}) {
  const BOX_W = 232;
  const BOX_H = 150;
  const ok = tile !== null && size !== null;
  const box = ok ? fitPreview(size.width * tile.width, size.height * tile.height, BOX_W, BOX_H) : { width: BOX_W, height: BOX_H };
  // Grid lines every `step` cells so they never get denser than ~5 px.
  const cellW = ok ? box.width / size.width : 0;
  const cellH = ok ? box.height / size.height : 0;
  const step = ok ? Math.max(1, Math.ceil(5 / Math.max(0.01, Math.min(cellW, cellH)))) : 1;
  const gridStyle = ok
    ? {
        backgroundImage:
          "linear-gradient(to right, var(--color-tile-grid) 1px, transparent 1px), linear-gradient(to bottom, var(--color-tile-grid) 1px, transparent 1px)",
        backgroundSize: `${cellW * step}px ${cellH * step}px`,
      }
    : {};
  return (
    <div className="flex flex-col gap-2" aria-label={t("newProject.preview")}>
      <div className="grid h-[150px] place-items-center rounded-md border border-line bg-bg">
        <div
          className="rounded-[2px] border border-line-strong"
          style={{ width: box.width, height: box.height, background: background ?? "var(--color-canvas)", ...gridStyle }}
        />
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-xs text-text tabular">
          {ok ? t("newProject.previewSummary", { width: size.width * tile.width, height: size.height * tile.height, layers: layers.length }) : " "}
        </span>
        <span className="font-mono text-xs text-faint tabular">
          {ok ? t("newProject.previewCells", { width: size.width, height: size.height, tile: tile.width === tile.height ? tile.width : `${tile.width}×${tile.height}` }) : " "}
        </span>
      </div>
      <ul className="flex flex-col gap-px">
        {[...layers].reverse().map((layer, i) => (
          <li key={i} className="flex h-6 items-center gap-2 rounded-sm px-1.5 text-sm text-muted">
            <LayerKindIcon kind={layer.kind} className="shrink-0 text-faint" />
            <span className="truncate">{layer.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TilesetDrop({ tileset, busy, onPick, onRemove }: { tileset: PlannedTileset | null; busy: boolean; onPick(): void; onRemove(): void }) {
  if (tileset) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-line bg-raised p-2">
        <Icon name="image" size={15} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate text-sm text-text" title={tileset.png.file.name}>
          {t("newProject.startTilesetInfo", { name: tileset.name, width: tileset.spec.tileWidth, height: tileset.spec.tileHeight })}
        </span>
        <button
          type="button"
          aria-label={t("newProject.startTilesetRemove")}
          title={t("newProject.startTilesetRemove")}
          onClick={onRemove}
          className="grid size-6 shrink-0 place-items-center rounded-sm text-faint hover:bg-hover hover:text-text"
        >
          <Icon name="x" size={13} />
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={busy}
      className="flex h-16 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-line-strong text-sm text-muted transition-colors hover:border-faint hover:bg-hover hover:text-text disabled:opacity-60"
    >
      <Icon name="upload" size={15} />
      {t("newProject.startTilesetDrop")}
    </button>
  );
}

export function Field({
  label,
  value,
  onChange,
  unit,
  numeric = false,
  error,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  unit?: string;
  numeric?: boolean;
  error: string | null;
  autoFocus?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-muted">
        {label}
      </label>
      <div
        className={`flex h-8 items-center rounded-md border bg-panel px-2.5 transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft ${
          error ? "border-danger" : "border-line hover:border-line-strong"
        }`}
      >
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          autoFocus={autoFocus}
          inputMode={numeric ? "numeric" : "text"}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`h-full min-w-0 flex-1 bg-transparent text-md text-text focus-visible:outline-none ${numeric ? "font-mono tabular" : ""}`}
        />
        {unit && <span className="pl-2 text-sm text-faint">{unit}</span>}
      </div>
      {error && (
        <span id={`${id}-error`} className="text-xs text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
