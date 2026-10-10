import { Menu } from "@base-ui/react/menu";

import { getCommand, isEnabled, runCommand } from "../../commands/registry";
import { ExportIcon } from "../../export/ExportDialog";
import { getLocale, t } from "../../i18n";
import { endProjectRename, startProjectRename, useProjectRename } from "../../io/projectRename";
import { useSaveIndicator } from "../../io/saveIndicator";
import { openRecentProject, renameProject } from "../../io/session";
import { forgetRecentProject, useRecentProjects } from "../../platform/recentProjects";
import { useEditorStore } from "../../state/editorStore";
import { MenuBar } from "../menu/MenuBar";
import { Button } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { menuItemClass, menuPopupClass, menuPositionerClass, menuSeparatorClass } from "../primitives/menuStyles";
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
      <span role="status" aria-label={label} data-save-state={state} className={`flex min-w-0 items-center gap-1.5 text-md ${state === "failed" ? "text-danger" : "text-muted"}`}>
        {state === "saved" && <Icon name="check" size={15} className="shrink-0 rounded-full text-accent" />}
        {state === "unsaved" && <span aria-hidden className="mx-1 size-1.5 shrink-0 rounded-full bg-warning" />}
        {state === "saving" && <span aria-hidden className="mx-1 size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />}
        {state === "failed" && <Icon name="alert" size={15} className="shrink-0" />}
        <span className="truncate max-lg:hidden">{label}</span>
      </span>
    </Tooltip>
  );
}

/** The centered project name; ▾ opens Yeniden adlandır · Proje ayarları… · Son projeler. Double-click renames. */
function ProjectName() {
  const name = useEditorStore((s) => s.project?.name ?? "");
  const renaming = useProjectRename((s) => s.editing);
  const recent = useRecentProjects();
  if (renaming) {
    return (
      <RenameInput
        initial={name}
        label={t("appBar.projectName")}
        className="h-7 w-[min(320px,40vw)] text-center text-md font-medium"
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
      <Menu.Trigger
        data-project-name=""
        title={t("appBar.renameHint")}
        onDoubleClick={startProjectRename}
        className="flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 text-md font-medium text-title outline-none hover:bg-hover data-popup-open:bg-active"
      >
        <h1 className="min-w-0 truncate">{name}</h1>
        <Icon name="chevronDown" size={13} className="shrink-0 text-faint" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="center" sideOffset={6} className={menuPositionerClass}>
          <Menu.Popup className={`${menuPopupClass} min-w-[240px]`} data-project-menu="">
            <Menu.Item className={`${menuItemClass} py-1 text-sm`} onClick={startProjectRename} data-command="project.rename">
              <Icon name="pencilLine" size={14} className="text-faint" />
              <span className="flex-1">{t("appBar.rename")}</span>
            </Menu.Item>
            <Menu.Item
              className={`${menuItemClass} py-1 text-sm`}
              disabled={!settings || !isEnabled(settings)}
              onClick={() => runCommand("project.settings")}
              data-command="project.settings"
            >
              <Icon name="sliders" size={14} className="text-faint" />
              <span className="flex-1">{t("commands.project.settings")}</span>
            </Menu.Item>
            {recent.supported && (
              <>
                <Menu.Separator className={menuSeparatorClass} />
                <div className="px-2 pt-1 pb-0.5 text-2xs font-semibold tracking-[0.06em] text-faint uppercase">{t("appBar.recentProjects")}</div>
                {recent.entries.length === 0 ? (
                  <Menu.Item disabled className={`${menuItemClass} py-1 text-sm`}>
                    {t("appBar.recentEmpty")}
                  </Menu.Item>
                ) : (
                  recent.entries.slice(0, 8).map((entry) => (
                    <Menu.Item
                      key={entry.key}
                      title={entry.location}
                      data-recent-project={entry.key}
                      className={`${menuItemClass} group py-1 text-sm ${entry.exists ? "" : "opacity-60"}`}
                      onClick={() => void openRecentProject(entry)}
                    >
                      <Icon name="folder" size={14} className="shrink-0 text-faint" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">{entry.name}</span>
                        <span className="truncate text-2xs text-faint">{entry.location}</span>
                      </span>
                      <span
                        role="button"
                        tabIndex={-1}
                        aria-label={t("contextMenu.recentRemove")}
                        title={t("contextMenu.recentRemove")}
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          void forgetRecentProject(entry);
                        }}
                        className="grid size-5 shrink-0 place-items-center rounded-sm text-faint opacity-0 group-data-highlighted:opacity-100 hover:bg-active hover:text-text"
                      >
                        <Icon name="x" size={12} />
                      </span>
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

/**
 * Top bar: logo + menus (left), the project name ▾ (center), the save
 * indicator and the primary "Unity'ye aktar" (right). Tools, undo / redo
 * and search live in the tool bar above the canvas.
 */
export function AppBar() {
  return (
    <header aria-label={t("layout.appBar")} className="grid h-toolbar shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-line bg-bg pr-2.5 pl-2">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex shrink-0 items-center gap-2 pr-2 text-accent">
          <Icon name="logo" size={20} />
          <span className="text-md font-semibold text-title max-xl:hidden">{t("app.name")}</span>
        </div>
        <MenuBar />
      </div>

      <div className="flex min-w-0 items-center justify-center">
        <ProjectName />
      </div>

      <div className="flex min-w-0 items-center justify-end gap-4">
        <SaveIndicator />
        <Tooltip label={t("export.toolbarUnity")} command="file.export">
          <Button variant="primary" className="h-8 shrink-0 gap-2 px-3 text-md" data-export-unity="" onClick={() => runCommand("file.export")}>
            <ExportIcon />
            {t("export.toolbarUnity")}
          </Button>
        </Tooltip>
      </div>
    </header>
  );
}
