import { Fragment } from "react";

import { runCommand } from "../../commands/registry";
import { useWorldView } from "../../commands/worldActions";
import { t } from "../../i18n";
import type { CommandId } from "../../shortcuts/shortcuts";
import { useEditorStore } from "../../state/editorStore";
import { useHistoryState } from "../hooks";
import { Icon, type IconName } from "../primitives/Icon";
import { Tooltip } from "../primitives/Tooltip";
import { ToolOptions, ZoomControl } from "../toolOptions/ToolOptionsBar";
import { registerRulerCommands } from "./rulers";
import { TOOLS } from "./tools";

registerRulerCommands();

function Divider() {
  return <div aria-hidden className="mx-1.5 h-5 w-px shrink-0 bg-line" />;
}

/** A 28×28 icon button of the tool bar. */
function BarButton({
  icon,
  label,
  command,
  on,
  disabled,
  onClick,
}: {
  icon: IconName;
  label: string;
  command: CommandId;
  on?: boolean;
  disabled?: boolean;
  onClick(): void;
}) {
  return (
    <Tooltip label={label} command={command}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={on}
        disabled={disabled}
        onClick={onClick}
        className={`grid size-7 shrink-0 place-items-center rounded-sm transition-colors duration-100 disabled:pointer-events-none disabled:opacity-35 ${
          on ? "bg-accent-soft text-accent shadow-[inset_0_0_0_1px_var(--color-accent-line)]" : "text-muted hover:bg-hover hover:text-text"
        }`}
      >
        <Icon name={icon} size={16} />
      </button>
    </Tooltip>
  );
}

/** A labelled on/off button ("Izgara"). */
function ViewToggleButton({ icon, label, command, on, disabled }: { icon: IconName; label: string; command: CommandId; on: boolean; disabled?: boolean }) {
  return (
    <Tooltip label={label} command={command}>
      <button
        type="button"
        aria-pressed={on}
        disabled={disabled}
        onClick={() => runCommand(command)}
        data-view-toggle={command}
        className={`flex h-7 shrink-0 items-center gap-1.5 rounded-sm px-2 text-sm transition-colors duration-100 disabled:pointer-events-none disabled:opacity-35 ${
          on ? "bg-active text-text" : "text-faint hover:bg-hover hover:text-muted"
        }`}
      >
        <Icon name={icon} size={15} className={on ? "text-accent" : ""} />
        <span className="max-xl:hidden">{label}</span>
      </button>
    </Tooltip>
  );
}

/**
 * The tool bar above the canvas: tools (left), the active tool's options
 * (registry), undo / redo, Izgara and Çarpışma, the zoom field and the
 * command search (right). On the world map the tools are off.
 */
export function ToolBar() {
  const tool = useEditorStore((s) => s.tool);
  const grid = useEditorStore((s) => s.gridVisible);
  const collision = useEditorStore((s) => s.collisionOverlay);
  const store = useEditorStore((s) => s.project?.store);
  const { canUndo, canRedo } = useHistoryState(store);
  const world = useWorldView((s) => s.view === "world");
  return (
    <div
      role="toolbar"
      aria-label={t("layout.toolBar")}
      title={world ? t("world.toolsDisabled") : undefined}
      className="flex h-optionsbar shrink-0 items-center gap-0.5 border-b border-line bg-panel px-2"
    >
      {TOOLS.map(({ id, icon, command, group }) => (
        <Fragment key={id}>
          {group && <Divider />}
          <BarButton icon={icon} label={t(`tools.${id}`)} command={command} on={!world && tool === id} disabled={world} onClick={() => runCommand(command)} />
        </Fragment>
      ))}
      <Divider />
      <div className="flex min-w-0 flex-1 items-center pl-1">
        <ToolOptions />
      </div>
      <BarButton icon="undo" label={t("toolbar.undo")} command="edit.undo" disabled={!canUndo} onClick={() => runCommand("edit.undo")} />
      <BarButton icon="redo" label={t("toolbar.redo")} command="edit.redo" disabled={!canRedo} onClick={() => runCommand("edit.redo")} />
      <Divider />
      <ViewToggleButton icon="grid" label={t("toolOptions.grid")} command="view.toggleGrid" on={grid} disabled={world} />
      <ViewToggleButton icon="shield" label={t("toolOptions.collisionView")} command="view.toggleCollision" on={collision} disabled={world} />
      <Divider />
      <ZoomControl />
      <Divider />
      <BarButton icon="search" label={t("toolbar.searchCommands")} command="palette.open" onClick={() => runCommand("palette.open")} />
    </div>
  );
}
