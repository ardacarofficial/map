import { Dialog } from "@base-ui/react/dialog";
import { normalizeProjectSettings } from "@smap/core";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { create } from "zustand";

import { t } from "../../i18n";
import { confirmDiscard, describeError, newProject, planStartingTileset, type PlannedTileset } from "../../io/session";
import { FolderTakenError, getPlatform, type ProjectLocation } from "../../platform";
import { TextField } from "../primitives/TextField";
import { AdvancedDisclosure, DialogHeader, DialogBody, DialogFooter, dialogLayoutClass } from "./DialogFrame";
import { Button, IconButton } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { DialogToggle as Toggle } from "./DialogFrame";
import { pickFiles } from "../pickFiles";
import {
  BackgroundField,
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
import { backdropClass, popupClass, dialogWidthM } from "./styles";
import { selectAll } from "../primitives/selectAll";

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
  const dialogRef = useRef<HTMLDivElement>(null);
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
          ref={dialogRef}
          initialFocus={() => dialogRef.current?.querySelector<HTMLElement>("input:not(:disabled)") ?? dialogRef.current}
          className={`${popupClass} ${dialogWidthM} ${dialogLayoutClass}`}
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
      <DialogHeader title={t("newProject.title")} subtitle={t("newProject.description")} onClose={onDone} />
      <DialogBody className="flex flex-col gap-3">

          <Section label={t("newProject.name")} htmlFor={nameId}>
            <div className="relative">
              <TextField size="md"
                id={nameId}
                value={name}
                onChange={(e) => { setName(e.target.value); setTouched(true); }}
                onBlur={() => setTouched(true)}
                {...selectAll}
                autoFocus
                spellCheck={false}
                autoComplete="off"
                aria-invalid={touched && !nameOk ? true : undefined}
                className={touched && !nameOk ? "[&>input]:border-danger" : ""}
              />
              <span className="pointer-events-none absolute right-0 bottom-full mb-1.5 max-w-[70%] truncate text-sm leading-4 text-danger" role="status">{touched && !nameOk ? t("newProject.errName") : null}</span>
            </div>
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
            <TileSizePicker value={tile} onChange={setTile} showErrors={true} />
          </Section>

          <Section label={t("newProject.mapSize")}>
            <MapSizePicker value={size} onChange={setSize} showErrors={true} />
          </Section>

          <Section label={t("newProject.layerTemplate")}>
            <LayerTemplatePicker value={layers} onChange={setLayers} />
          </Section>

          <Preview tile={tileSize} size={mapSize} layers={cleanLayers(layerList)} background={background} />

          <Section label={t("newProject.startTileset")}>
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

          <AdvancedDisclosure open={advanced} onChange={setAdvanced} label={t("newProject.advanced")}>
                <Section label={t("newProject.background")}>
                  <BackgroundField value={background} onChange={setBackground} />
                </Section>
                {typeof window !== "undefined" && "showDirectoryPicker" in window && (
                  <Section label={t("newProject.unityFolder")}>
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`min-w-0 flex-1 truncate text-sm ${unityDir ? "text-text" : "text-muted"}`}>
                        {unityDir?.name ?? t("newProject.unityFolderNone")}
                      </span>
                      <Button className="shrink-0" onClick={() => void pickUnityFolder()}>
                        {t("newProject.unityFolderPick")}
                      </Button>
                    </div>
                  </Section>
                )}
                <label className="flex items-start gap-2">
                  <span className="pt-0.5">
                    <Toggle checked={exportOnSave} onChange={setExportOnSave} label={t("newProject.unityExportOnSave")} />
                  </span>
                  <span className="text-sm text-text">{t("newProject.unityExportOnSave")}</span>
                </label>
          </AdvancedDisclosure>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onDone}>{t("common.cancel")}</Button>
        <Button type="submit" variant="primary" disabled={!valid || tilesetBusy}>{t("common.create")}</Button>
      </DialogFooter>
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
  if (!supported) return <Button variant="ghost" className="self-start" title={t("newProject.folderUnsupported")} onClick={onLater}>{t("newProject.pickLater")}</Button>;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-2">
        {state.kind === "picked" ? (
          <>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Icon name="folder" size={16} className="shrink-0 text-muted" />
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
            <Button variant="secondary" onClick={onPick} disabled={busy}>
              <Icon name="folder" size={16} />
              {t("newProject.pickFolder")}
            </Button>
            <Button variant="ghost" onClick={onLater} aria-pressed={state.kind === "later"}>{t("newProject.pickLater")}</Button>
          </>
        )}
      </div>
      {error && <span className="text-sm text-danger">{error}</span>}
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
  const [lastValid, setLastValid] = useState({ tile, size });
  if (tile && size && (tile.width !== lastValid.tile?.width || tile.height !== lastValid.tile?.height || size.width !== lastValid.size?.width || size.height !== lastValid.size?.height)) setLastValid({ tile, size });
  const displayTile = tile ?? lastValid.tile;
  const displaySize = size ?? lastValid.size;
  const ok = displayTile !== null && displaySize !== null;
  const box = ok ? fitPreview(displaySize.width * displayTile.width, displaySize.height * displayTile.height, 80, 56) : { width: 80, height: 56 };
  return <div className="flex items-center gap-3" aria-label={t("newProject.preview")}>
    <div className="grid h-16 w-24 shrink-0 place-items-center rounded-sm bg-canvas">
      <div className="rounded-xs border border-line-strong" style={{ width: box.width, height: box.height, background: background ?? "var(--color-map-bg)" }} />
    </div>
    <div className="flex min-w-0 flex-col gap-1 tabular">
      <span className="text-sm text-text">{ok ? t("newProject.previewSummary", { width: displaySize.width * displayTile.width, height: displaySize.height * displayTile.height, layers: layers.length }) : " "}</span>
      <span className="text-xs text-muted">{ok ? t("newProject.previewCells", { width: displaySize.width, height: displaySize.height, tile: displayTile.width === displayTile.height ? displayTile.width : `${displayTile.width}×${displayTile.height}` }) : " "}</span>
    </div>
  </div>;
}

function TilesetDrop({ tileset, busy, onPick, onRemove }: { tileset: PlannedTileset | null; busy: boolean; onPick(): void; onRemove(): void }) {
  if (tileset) {
    return (
      <div className="flex h-control-md items-center gap-2">
        <Icon name="image" size={16} className="shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate text-sm text-text" title={tileset.png.file.name}>
          {t("newProject.startTilesetInfo", { name: tileset.name, width: tileset.spec.tileWidth, height: tileset.spec.tileHeight })}
        </span>
        <IconButton size="sm" aria-label={t("newProject.startTilesetRemove")} title={t("newProject.startTilesetRemove")} onClick={onRemove}>
          <Icon name="x" size={16} />
        </IconButton>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={busy}
      className="flex h-12 items-center justify-center gap-2 rounded-md border border-dashed border-line-strong text-sm text-muted transition-colors duration-(--duration-fast) hover:border-line-strong hover:bg-hover hover:text-text disabled:opacity-60"
    >
      <Icon name="upload" size={16} />
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
  return <Section label={label} htmlFor={id}>
    <TextField size="md" id={id} value={value} onChange={e => onChange(e.target.value)} {...selectAll}
      autoFocus={autoFocus} inputMode={numeric ? "numeric" : "text"} spellCheck={false} autoComplete="off"
      aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}
      className={`${numeric ? "tabular" : ""} ${error ? "[&>input]:border-danger" : ""}`}
      trailing={unit ? <span className="text-sm text-muted">{unit}</span> : undefined} />
    {error && <span id={`${id}-error`} className="text-sm text-danger">{error}</span>}
  </Section>;
}
