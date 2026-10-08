import { runCommand } from "../../commands/registry";
import { ExportIcon } from "../../export/ExportDialog";
import { t } from "../../i18n";
import { useSaveIndicator } from "../../io/saveIndicator";
import { useEditorStore } from "../../state/editorStore";
import { useHistoryState } from "../hooks";
import { MenuBar } from "../menu/MenuBar";
import { Button, IconButton } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { Tooltip } from "../primitives/Tooltip";
import { ViewToggle } from "./ViewToggle";

/**
 * Top bar: logo + menus (left), project name with the save dot (center),
 * Harita | Dünya, undo / redo, command search and the primary Export button
 * (right). Everything else lives in the menus.
 */
export function AppBar() {
  const name = useEditorStore((s) => s.project?.name ?? "");
  const dirty = useSaveIndicator().unsaved;
  const store = useEditorStore((s) => s.project?.store);
  const { canUndo, canRedo } = useHistoryState(store);
  const saveLabel = dirty ? t("toolbar.unsaved") : t("toolbar.saved");

  return (
    <header aria-label={t("layout.appBar")} className="grid h-toolbar grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-line bg-panel pr-2 pl-1">
      <div className="flex min-w-0 items-center gap-1">
        <div className="grid size-8 shrink-0 place-items-center text-accent">
          <Icon name="logo" size={18} />
        </div>
        <MenuBar />
      </div>

      <div className="flex min-w-0 items-center justify-center gap-2">
        <h1 className="min-w-0 truncate text-md font-medium text-text">{name}</h1>
        <Tooltip label={saveLabel}>
          <span role="status" aria-label={saveLabel} className="grid size-4 shrink-0 place-items-center">
            <span className={`size-1.5 rounded-full transition-colors duration-200 ${dirty ? "bg-warning" : "bg-line-strong"}`} />
          </span>
        </Tooltip>
      </div>

      <div className="flex items-center justify-end gap-0.5">
        <ViewToggle />
        <div aria-hidden className="mx-1.5 h-4 w-px bg-line" />
        <Tooltip label={t("toolbar.undo")} command="edit.undo">
          <IconButton aria-label={t("toolbar.undo")} disabled={!canUndo} onClick={() => runCommand("edit.undo")}>
            <Icon name="undo" />
          </IconButton>
        </Tooltip>
        <Tooltip label={t("toolbar.redo")} command="edit.redo">
          <IconButton aria-label={t("toolbar.redo")} disabled={!canRedo} onClick={() => runCommand("edit.redo")}>
            <Icon name="redo" />
          </IconButton>
        </Tooltip>
        <Tooltip label={t("toolbar.searchCommands")} command="palette.open">
          <IconButton aria-label={t("toolbar.searchCommands")} onClick={() => runCommand("palette.open")}>
            <Icon name="search" />
          </IconButton>
        </Tooltip>
        <div aria-hidden className="mx-1.5 h-4 w-px bg-line" />
        <Tooltip label={t("export.toolbar")} command="file.export">
          <Button variant="primary" className="h-7 gap-1.5 px-2.5 text-sm" onClick={() => runCommand("file.export")}>
            <ExportIcon />
            {t("export.toolbar")}
          </Button>
        </Tooltip>
      </div>
    </header>
  );
}
