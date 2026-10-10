/**
 * Proje ayarları (`project.settings`): tabs Genel (name, new-map defaults:
 * tile size, size, layer template, background) · Unity (folder hint, export
 * on save, PPU) · Diğer (shortcuts to entity types, tilesets and the app
 * settings file). Edits apply on "Kaydet" as one settings change, saved with
 * the project by the next (auto)save.
 */
import { Dialog } from "@base-ui/react/dialog";
import { Tabs } from "@base-ui/react/tabs";
import { normalizeProjectSettings, type ProjectSettings } from "@smap/core";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { create } from "zustand";

import { registerCommands, runCommand } from "../../commands/registry";
import { t } from "../../i18n";
import { updateExportSettings } from "../../export/exportSettings";
import { useProjectLibrary } from "../../io/projectLibrary";
import { renameProject, updateProjectSettings } from "../../io/session";
import { useEditorStore } from "../../state/editorStore";
import { useAppSettings } from "../../platform/appSettings";
import type { CommandId } from "../../shortcuts/shortcuts";
import { backdropClass, popupClass } from "../dialogs/styles";
import { Button } from "../primitives/Button";
import { Icon, type IconName } from "../primitives/Icon";
import { inputClass, inputOk } from "../primitives/NativeSelect";
import { Toggle } from "../primitives/Toggle";
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
  const open = useProjectSettingsDialog((s) => s.open);
  return (
    <Dialog.Root open={open} onOpenChange={(next) => useProjectSettingsDialog.setState({ open: next })}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdropClass} />
        <Dialog.Popup
          className={`${popupClass} flex max-h-[calc(100vh-48px)] w-[600px] max-w-[calc(100vw-32px)] flex-col`}
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
      <div className="flex flex-col gap-1 px-5 pt-5">
        <Dialog.Title className="text-lg font-semibold">{t("projectSettings.title")}</Dialog.Title>
        <Dialog.Description className="text-md text-muted">{t("projectSettings.description")}</Dialog.Description>
      </div>

      <Tabs.Root
        value={tab}
        onValueChange={(value) => useProjectSettingsDialog.setState({ tab: value as TabId })}
        className="flex min-h-0 flex-col"
      >
        <Tabs.List className="relative mt-3 flex gap-1 border-b border-line px-5">
          <TabButton value="general">{t("projectSettings.tabGeneral")}</TabButton>
          <TabButton value="unity">{t("projectSettings.tabUnity")}</TabButton>
          <TabButton value="more">{t("projectSettings.tabMore")}</TabButton>
        </Tabs.List>

        <Tabs.Panel value="general" className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 py-4">
          <Section label={t("projectSettings.name")} htmlFor={nameId}>
            <input
              id={nameId}
              value={name}
              onChange={(e) => setName(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              className={`${inputClass} h-8 ${touched && name.trim() === "" ? "border-danger" : inputOk}`}
            />
          </Section>
          <div className="flex flex-col gap-0.5 border-t border-line pt-3">
            <h3 className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">{t("projectSettings.newMapDefaults")}</h3>
            <p className="text-xs text-faint">{t("projectSettings.newMapDefaultsHint")}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
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
        </Tabs.Panel>

        <Tabs.Panel value="unity" className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 py-4">
          <Section label={t("newProject.unityFolder")} htmlFor={hintId} hint={t("projectSettings.unityFolderHint")}>
            <input
              id={hintId}
              value={folderHint}
              onChange={(e) => setFolderHint(e.target.value)}
              placeholder="Assets/Maps"
              spellCheck={false}
              autoComplete="off"
              className={`${inputClass} h-8 font-mono ${inputOk}`}
            />
          </Section>
          <label className="flex items-start gap-2">
            <span className="pt-0.5">
              <Toggle checked={exportOnSave} onChange={setExportOnSave} label={t("newProject.unityExportOnSave")} />
            </span>
            <span className="flex flex-col">
              <span className="text-sm text-text">{t("newProject.unityExportOnSave")}</span>
              <span className="text-xs text-faint">{t("newProject.unityExportOnSaveHint")}</span>
            </span>
          </label>
          <div className="flex flex-col gap-1 rounded-md border border-line bg-panel p-3">
            <span className="text-sm font-medium text-muted">{t("projectSettings.ppu")}</span>
            <span className="font-mono text-md text-text tabular">{doc ? doc.map.tileWidth : "—"}</span>
            <span className="text-xs text-faint">{t("projectSettings.ppuHint")}</span>
          </div>
          <Button className="self-start" onClick={() => go("file.export")}>
            <Icon name="upload" size={14} />
            {t("projectSettings.openExport")}
          </Button>
        </Tabs.Panel>

        <Tabs.Panel value="more" className="flex min-h-0 flex-col gap-2 overflow-y-auto px-5 py-4">
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
        </Tabs.Panel>
      </Tabs.Root>

      <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
        <Dialog.Close render={<Button variant="ghost">{t("common.cancel")}</Button>} />
        <Button type="submit" variant="primary" disabled={touched && !valid}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}

function TabButton({ value, children }: { value: TabId; children: ReactNode }) {
  return (
    <Tabs.Tab
      value={value}
      className="-mb-px h-8 border-b-2 border-transparent px-2.5 text-sm text-muted transition-colors hover:text-text data-active:border-accent data-active:text-text"
    >
      {children}
    </Tabs.Tab>
  );
}

function LinkRow({ icon, title, hint, onClick }: { icon: IconName; title: string; hint: string; onClick(): void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-3 rounded-md border border-line bg-panel px-3 py-2.5 text-left transition-colors hover:border-line-strong hover:bg-hover"
    >
      <Icon name={icon} size={16} className="shrink-0 text-muted group-hover:text-accent" />
      <span className="flex min-w-0 flex-col">
        <span className="text-md text-text">{title}</span>
        <span className="truncate text-xs text-faint">{hint}</span>
      </span>
      <Icon name="chevronRight" size={14} className="ml-auto shrink-0 text-faint" />
    </button>
  );
}
