import { runCommand } from "../../commands/registry";
import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { IconButton } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { CommandKbd } from "../primitives/Kbd";
import { Tooltip } from "../primitives/Tooltip";
import { useUiStore } from "../uiStore";
import { useHistoryState } from "../hooks";

export function Toolbar() {
  const name = useEditorStore((s) => s.project?.name ?? "");
  const dirty = useEditorStore((s) => s.dirty);
  const busy = useUiStore((s) => s.busy);
  const panelsHidden = useUiStore((s) => s.panelsHidden);
  const store = useEditorStore((s) => s.project?.store);
  const { canUndo, canRedo } = useHistoryState(store);

  return (
    <header className="grid h-toolbar grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-line bg-panel px-2">
      <div className="flex min-w-0 items-center gap-2">
        <div className="grid size-8 shrink-0 place-items-center text-accent">
          <Icon name="logo" size={18} />
        </div>
        <h1 className="min-w-0 truncate text-md font-medium text-text">{name}</h1>
        <Tooltip label={dirty ? t("toolbar.unsaved") : t("toolbar.saved")}>
          <span
            role="status"
            aria-label={dirty ? t("toolbar.unsaved") : t("toolbar.saved")}
            className="grid size-4 shrink-0 place-items-center"
          >
            <span
              className={`size-1.5 rounded-full transition-colors duration-200 ${dirty ? "bg-accent" : "bg-line-strong"}`}
            />
          </span>
        </Tooltip>
      </div>

      <button
        type="button"
        onClick={() => runCommand("palette.open")}
        className="flex h-7 w-[320px] max-w-[40vw] items-center gap-2 rounded-md border border-line bg-raised pr-1.5 pl-2.5 text-sm text-faint transition-colors hover:border-line-strong hover:text-muted"
      >
        <Icon name="search" size={14} />
        <span className="truncate">{t("toolbar.searchCommands")}</span>
        <CommandKbd command="palette.open" className="ml-auto" />
      </button>

      <div className="flex items-center justify-end gap-0.5">
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
        <div aria-hidden className="mx-1 h-4 w-px bg-line" />
        <Tooltip label={t("toolbar.save")} command="file.save">
          <IconButton aria-label={t("toolbar.save")} disabled={busy} onClick={() => runCommand("file.save")}>
            <Icon name="save" />
          </IconButton>
        </Tooltip>
        <Tooltip label={t("toolbar.togglePanels")} command="view.togglePanels">
          <IconButton
            aria-label={t("toolbar.togglePanels")}
            active={!panelsHidden}
            aria-pressed={!panelsHidden}
            onClick={() => runCommand("view.togglePanels")}
          >
            <Icon name="panels" />
          </IconButton>
        </Tooltip>
      </div>
    </header>
  );
}
