import { Menu } from "@base-ui/react/menu";

import { getCommand, isEnabled, runCommand } from "../../commands/registry";
import { openExportDialog } from "../../export/exportStore";
import { getLocale, t } from "../../i18n";
import { endProjectRename, startProjectRename, useProjectRename } from "../../io/projectRename";
import { useSaveIndicator } from "../../io/saveIndicator";
import { openRecentProject, renameProject } from "../../io/session";
import { forgetRecentProject, useRecentProjects } from "../../platform/recentProjects";
import { useEditorStore } from "../../state/editorStore";
import { DocumentTabs } from "../levels/DocumentTabs";
import { Divider } from "../primitives/Divider";
import { MenuBar } from "../menu/MenuBar";
import { Button } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { menuItemClass, menuPopupClass, menuPositionerClass, menuSeparatorClass, menuGroupLabelClass } from "../primitives/menuStyles";
import { RenameInput } from "../primitives/RenameInput";
import { Tooltip } from "../primitives/Tooltip";

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(getLocale() === "tr" ? "tr-TR" : "en-US", { hour: "2-digit", minute: "2-digit" });
}

/**
 * The one save indicator: "✓ Tüm değişiklikler kaydedildi" (time in the
 * tooltip), "● Kaydedilmemiş değişiklikler", "Kaydediliyor…" or
 * "Kaydedilemedi". Same source as the window title (`io/saveIndicator`).
 */
function SaveIndicator() {
  const indicator = useSaveIndicator();
  const state = indicator.text === "saving" ? "saving" : indicator.text === "saveFailed" ? "failed" : indicator.unsaved ? "unsaved" : indicator.text === "savedAt" ? "saved" : null;
  if (state === null) return null;
  const label =
    state === "saving" ? t("status.saving") : state === "failed" ? t("status.saveFailed") : state === "unsaved" ? t("toolbar.unsaved") : t("toolbar.saved");
  const tip = state === "saved" && indicator.lastSavedAt !== null ? t("status.savedAt", { time: formatTime(indicator.lastSavedAt) }) : label;
  return (
    <Tooltip label={tip}>
      <span role="status" aria-label={label} data-save-state={state} className={`flex min-w-0 items-center gap-1.5 text-sm ${state === "failed" ? "text-danger" : "text-muted"}`}>
        {state === "saved" && <Icon name="tick" size={16} className="shrink-0 text-muted" />}
        {state === "unsaved" && <span aria-hidden className="mx-1 size-1.5 shrink-0 rounded-full bg-warning" />}
        {state === "saving" && <span aria-hidden className="mx-1 size-1.5 shrink-0 animate-pulse rounded-full bg-muted" />}
        {state === "failed" && <Icon name="alert" size={16} className="shrink-0" />}
        <span className="hidden xl:inline">{t(state === "saved" ? "appBar.savedShort" : state === "unsaved" ? "appBar.unsavedShort" : state === "saving" ? "appBar.savingShort" : "appBar.failedShort")}</span>
      </span>
    </Tooltip>
  );
}

/** The project name; ▾ opens Yeniden adlandır · Proje ayarları… · Son projeler. Double-click renames. */
function ProjectName() {
  const name = useEditorStore((s) => s.project?.name ?? "");
  const renaming = useProjectRename((s) => s.editing);
  const recent = useRecentProjects();
  if (renaming) {
    return (
      <RenameInput
        initial={name}
        label={t("appBar.projectName")}
        className="h-control-md w-50 text-sm font-medium"
        onDone={(next) => {
          endProjectRename();
          if (next !== null) renameProject(next);
        }}
      />
    );
  }
  const settings = getCommand("project.settings");
  return (
    <Menu.Root>
      <Tooltip label={t("appBar.renameHint")}><Menu.Trigger
        data-project-name=""
        onDoubleClick={startProjectRename}
        className="flex h-control-md w-full min-w-0 max-w-50 items-center gap-1.5 rounded-sm px-2 text-sm font-medium text-title outline-none hover:bg-hover data-popup-open:bg-active"
      >
        <h1 className="min-w-0 truncate">{name}</h1>
        <Icon name="chevronDown" size={12} className="shrink-0 text-faint" />
      </Menu.Trigger></Tooltip>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={4} className={menuPositionerClass}>
          <Menu.Popup className={`${menuPopupClass} min-w-56`} data-project-menu="">
            <Menu.Item className={menuItemClass} onClick={startProjectRename} data-command="project.rename">
              <Icon name="pencilLine" size={16} className="text-muted" />
              <span className="flex-1">{t("appBar.rename")}</span>
            </Menu.Item>
            <Menu.Item
              className={menuItemClass}
              disabled={!settings || !isEnabled(settings)}
              onClick={() => runCommand("project.settings")}
              data-command="project.settings"
            >
              <Icon name="sliders" size={16} className="text-muted" />
              <span className="flex-1">{t("commands.project.settings")}</span>
            </Menu.Item>
            {recent.supported && (
              <>
                <Menu.Separator className={menuSeparatorClass} />
                <div className={menuGroupLabelClass}>{t("appBar.recentProjects")}</div>
                {recent.entries.length === 0 ? (
                  <Menu.Item disabled className={menuItemClass}>
                    {t("appBar.recentEmpty")}
                  </Menu.Item>
                ) : (
                  recent.entries.slice(0, 8).map((entry) => (
                    <Menu.Item
                      key={entry.key}
                      data-recent-project={entry.key}
                      className={`${menuItemClass} group h-auto min-h-row py-1 ${entry.exists ? "" : "opacity-60"}`}
                      onClick={() => void openRecentProject(entry)}
                    >
                      <Icon name="folder" size={16} className="shrink-0 text-faint" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">{entry.name}</span>
                        <span className="truncate text-xs text-faint">{entry.location}</span>
                      </span>
                      <Tooltip label={t("contextMenu.recentRemove")}><span
                        role="button"
                        tabIndex={-1}
                        aria-label={t("contextMenu.recentRemove")}
                        data-recent-forget=""
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          void forgetRecentProject(entry);
                        }}
                        className="grid size-5 shrink-0 place-items-center rounded-sm text-faint opacity-0 group-data-highlighted:opacity-100 hover:bg-active hover:text-text"
                      >
                        <Icon name="x" size={12} />
                      </span></Tooltip>
                    </Menu.Item>
                  ))
                )}
              </>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Menus, project, scrollable document tabs and the persistent save/export actions. */
export function AppBar() {
  return (
    <header aria-label={t("layout.appBar")} className="flex h-toolbar shrink-0 items-center gap-2 border-b border-line bg-bg px-2">
      <Icon name="logo" size={16} className="shrink-0 text-accent" />
      <div className="h-full shrink-0"><MenuBar /></div>
      <Divider orientation="vertical" length={16} tone="line" />
      <div className="min-w-0 max-w-50 shrink"><ProjectName /></div>
      <span aria-hidden className="text-faint">/</span>
      <DocumentTabs />
      <div className="ml-auto flex shrink-0 items-center gap-3">
        <SaveIndicator />
        <Tooltip label={t("export.toolbarUnity")} command="file.export">
          <Button variant="primary" size="md" data-export-unity="" onClick={() => openExportDialog({ target: "unity" })}>
            <Icon name="upload" size={16} />
            {t("export.toolbarUnity")}
          </Button>
        </Tooltip>
      </div>
    </header>
  );
}
