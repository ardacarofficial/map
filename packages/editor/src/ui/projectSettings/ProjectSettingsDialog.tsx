/**
 * Proje ayarları (`project.settings`): tabs Genel (name, new-map defaults:
 * tile size, size, layer template, background) · Unity (folder hint, export
 * on save, PPU) · Diğer (shortcuts to entity types, tilesets and the app
 * settings file). Edits apply on "Kaydet" as one settings change, saved with
 * the project by the next (auto)save.
 */
import { Dialog } from "../primitives/Overlays";
import { Tabs } from "../primitives/Tabs";
import { normalizeProjectSettings, type ProjectSettings } from "@smap/core";
import { useId, useRef, useState, type FormEvent } from "react";
import { create } from "zustand";

import { registerCommands, runCommand } from "../../commands/registry";
import { t } from "../../i18n";
import { updateExportSettings } from "../../export/exportSettings";
import { useProjectLibrary } from "../../io/projectLibrary";
import { renameProject, updateProjectSettings } from "../../io/session";
import { useEditorStore } from "../../state/editorStore";
import { useAppSettings } from "../../platform/appSettings";
import type { CommandId } from "../../shortcuts/shortcuts";
import { backdropClass, popupClass, dialogWidthM } from "../dialogs/styles";
import { DialogHeader, DialogBody, DialogFooter, dialogLayoutClass } from "../dialogs/DialogFrame";
import { TextField } from "../primitives/TextField";
import { Button } from "../primitives/Button";
import { Icon, type IconName } from "../primitives/Icon";
import { DialogToggle as Toggle } from "../dialogs/DialogFrame";
import { toast } from "../toast/toastStore";
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
} from "./fields";
import { cleanLayers, singleLayer, templateIdOf } from "./projectTemplates";
import { selectAll } from "../primitives/selectAll";

type TabId = "general" | "unity" | "more";

export const useProjectSettingsDialog = create<{ open: boolean; tab: TabId }>()(() => ({ open: false, tab: "general" }));

export function openProjectSettings(tab: TabId = "general"): void {
  if (!useEditorStore.getState().project) return;
  useProjectSettingsDialog.setState({ open: true, tab });
}

let registered = false;

/** Registers `project.settings` (app bar project menu, palette). */
export function registerProjectSettingsCommands(): void {
  if (registered) return;
  registered = true;
  registerCommands([
    {
      id: "project.settings",
      title: "commands.project.settings",
      category: "file",
      enabled: () => useEditorStore.getState().project !== null,
      run: () => openProjectSettings(),
    },
  ]);
  useEditorStore.subscribe((state) => {
    if (state.project === null && useProjectSettingsDialog.getState().open) useProjectSettingsDialog.setState({ open: false });
  });
}

export function ProjectSettingsDialog() {
  const popupRef = useRef<HTMLDivElement>(null);
  const open = useProjectSettingsDialog((s) => s.open);
  return (
    <Dialog.Root open={open} onOpenChange={(next) => useProjectSettingsDialog.setState({ open: next })}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdropClass} />
        <Dialog.Popup
          ref={popupRef}
          initialFocus={() => popupRef.current?.querySelector<HTMLElement>('input:not(:disabled), [role="tabpanel"] button:not(:disabled), footer button:not(:disabled)') ?? popupRef.current}
          className={`${popupClass} ${dialogWidthM} ${dialogLayoutClass}`}
          data-dialog="project-settings"
        >
          {open && <SettingsForm onDone={() => useProjectSettingsDialog.setState({ open: false })} />}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The form's layer template value for stored settings (empty = one ground layer). */
function templateValue(settings: ProjectSettings): LayerTemplateValue {
  const list = settings.layerTemplate.length > 0 ? [...settings.layerTemplate] : singleLayer();
  return { id: templateIdOf(list), custom: list };
}

function SettingsForm({ onDone }: { onDone(): void }) {
  const project = useEditorStore((s) => s.project);
  const stored = useProjectLibrary((s) => s.settings);
  const tab = useProjectSettingsDialog((s) => s.tab);
  const doc = project?.store.document;
  const [name, setName] = useState(project?.name ?? "");
  const [tile, setTile] = useState<TileSizeValue>(() => tileSizeFrom(stored.tileWidth, stored.tileHeight));
  const [size, setSize] = useState<MapSizeValue>(() => mapSizeFrom(stored.newLevel.width, stored.newLevel.height));
  const [layers, setLayers] = useState<LayerTemplateValue>(() => templateValue(stored));
  const [background, setBackground] = useState<string | null>(stored.background);
  const [folderHint, setFolderHint] = useState(stored.unity.folderHint);
  const [exportOnSave, setExportOnSave] = useState(stored.unity.exportOnSave);
  const [touched, setTouched] = useState(false);
  const nameId = useId();
  const hintId = useId();

  const tileSize = parseTileSize(tile);
  const mapSize = parseMapSize(size);
  const layersOk = layers.id !== "custom" || layers.custom.some((l) => l.name.trim() !== "");
  const valid = name.trim() !== "" && tileSize !== null && mapSize !== null && layersOk;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!valid || !tileSize || !mapSize) return;
    const finalLayers = cleanLayers(layersOf(layers));
    let next: ProjectSettings;
    try {
      next = normalizeProjectSettings({
        tileWidth: tileSize.width,
        tileHeight: tileSize.height,
        newLevel: { width: mapSize.width, height: mapSize.height },
        layerTemplate: templateIdOf(finalLayers) === "single" ? [] : finalLayers,
        background,
        unity: { folderHint: folderHint.trim(), exportOnSave },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      return;
    }
    const changed = JSON.stringify(next) !== JSON.stringify(stored);
    if (changed) updateProjectSettings(next);
    // The export dialog's "export on save" switch follows the project setting.
    if (project && next.unity.exportOnSave !== stored.unity.exportOnSave) void updateExportSettings(project.name, { autoUnity: next.unity.exportOnSave });
    const renamed = renameProject(name);
    if (changed || renamed) toast.success(t("projectSettings.saved"));
    onDone();
  };

  const go = (command: CommandId) => {
    onDone();
    // After the dialog closes, so the next one gets focus.
    setTimeout(() => runCommand(command), 0);
  };

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-col">
      <DialogHeader title={t("projectSettings.title")} subtitle={t("projectSettings.description")} onClose={onDone} />
      <Tabs value={tab} onValueChange={tab => useProjectSettingsDialog.setState({ tab })} label={t("projectSettings.title")}
        items={([{ value: "general", label: t("projectSettings.tabGeneral"), attrs: { id: "project-settings-tab-general", "aria-controls": "project-settings-general" } }, { value: "unity", label: t("projectSettings.tabUnity"), attrs: { id: "project-settings-tab-unity", "aria-controls": "project-settings-unity" } }, { value: "more", label: t("projectSettings.tabMore"), attrs: { id: "project-settings-tab-more", "aria-controls": "project-settings-more" } }] as const)} />
      <DialogBody role="tabpanel" id={`project-settings-${tab}`} aria-labelledby={`project-settings-tab-${tab}`} className="flex flex-col gap-3 pt-3">
        {tab === "general" && <>
          <Section label={t("projectSettings.name")} htmlFor={nameId}>
            <TextField size="md"
              id={nameId}
              value={name}
              {...selectAll}
              onChange={(e) => setName(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={touched && name.trim() === "" || undefined}
              className={touched && name.trim() === "" ? "[&>input]:border-danger" : ""}
            />
          </Section>
          <div className="flex flex-col gap-0.5 border-t border-line-subtle pt-3">
            <h3 className="text-xs font-semibold tracking-section text-muted uppercase">{t("projectSettings.newMapDefaults")}</h3>
          </div>
          <div className="flex flex-col gap-3">
            <Section label={t("newProject.tileSize")}>
              <TileSizePicker value={tile} onChange={setTile} showErrors={touched} />
            </Section>
            <Section label={t("newProject.mapSize")}>
              <MapSizePicker value={size} onChange={setSize} showErrors={touched} />
            </Section>
          </div>
          <Section label={t("newProject.layerTemplate")}>
            <LayerTemplatePicker value={layers} onChange={setLayers} />
          </Section>
          <Section label={t("newProject.background")} hint={t("projectSettings.backgroundHint")}>
            <BackgroundField value={background} onChange={setBackground} />
          </Section>
        </>}
        {tab === "unity" && <>
          <Section label={t("newProject.unityFolder")} htmlFor={hintId} hint={t("projectSettings.unityFolderHint")}>
            <TextField size="md"
              id={hintId}
              value={folderHint}
              onChange={(e) => setFolderHint(e.target.value)}
              placeholder={t("export.outputFolderPlaceholder")}
              spellCheck={false}
              autoComplete="off"
            />
          </Section>
          <label className="flex items-start gap-2">
            <span className="pt-0.5">
              <Toggle checked={exportOnSave} onChange={setExportOnSave} label={t("newProject.unityExportOnSave")} />
            </span>
            <span className="flex flex-col">
              <span className="text-sm text-text">{t("newProject.unityExportOnSave")}</span>
            </span>
          </label>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-muted">{t("projectSettings.ppu")}</span>
            <span className="text-md text-text tabular">{doc ? doc.map.tileWidth : "—"}</span>
          </div>
          <Button className="self-start" onClick={() => go("file.export")}>
            <Icon name="upload" size={16} />
            {t("projectSettings.openExport")}
          </Button>
        </>}
        {tab === "more" && <>
          <LinkRow icon="flag" title={t("projectSettings.entityTypes")} hint={t("projectSettings.entityTypesHint")} onClick={() => go("entity.editTypes")} />
          <LinkRow icon="image" title={t("projectSettings.tilesets")} hint={t("projectSettings.tilesetsHint")} onClick={() => go("tileset.goto")} />
          <LinkRow
            icon="sliders"
            title={t("projectSettings.appSettings")}
            hint={t("projectSettings.appSettingsHint")}
            onClick={() => {
              onDone();
              setTimeout(() => useAppSettings.getState().setDialogOpen(true), 0);
            }}
          />
        </>}
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={onDone}>{t("common.cancel")}</Button>
        <Button type="submit" variant="primary" disabled={touched && !valid}>{t("common.save")}</Button>
      </DialogFooter>
    </form>
  );
}

function LinkRow({ icon, title, hint, onClick }: { icon: IconName; title: string; hint: string; onClick(): void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      className="group flex h-control-md items-center gap-3 rounded-sm px-2 text-left hover:bg-hover-popup"
    >
      <Icon name={icon} size={16} className="shrink-0 text-muted group-hover:text-text" />
      <span className="flex min-w-0 flex-col">
        <span className="text-sm text-text">{title}</span>
      </span>
      <Icon name="chevronRight" size={16} className="ml-auto shrink-0 text-muted" />
    </button>
  );
}
