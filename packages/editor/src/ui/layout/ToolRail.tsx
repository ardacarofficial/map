import { Fragment } from "react";
import { runCommand } from "../../commands/registry";
import { t } from "../../i18n";
import type { CommandId } from "../../shortcuts/shortcuts";
import { useEditorStore, type ToolId } from "../../state/editorStore";
import { IconButton } from "../primitives/Button";
import { Icon, type IconName } from "../primitives/Icon";
import { Tooltip } from "../primitives/Tooltip";

const TOOLS: { id: ToolId; icon: IconName; command: CommandId }[] = [
  { id: "brush", icon: "pencil", command: "tool.brush" },
  { id: "eraser", icon: "eraser", command: "tool.eraser" },
  { id: "fill", icon: "fill", command: "tool.fill" },
  { id: "rect", icon: "rect", command: "tool.rect" },
  { id: "select", icon: "select", command: "tool.select" },
  { id: "eyedropper", icon: "eyedropper", command: "tool.eyedropper" },
];

/** Drawing tools and picking tools are separated by a divider after this index. */
const GROUP_BREAK = 3;

export function ToolRail() {
  const tool = useEditorStore((s) => s.tool);
  const grid = useEditorStore((s) => s.gridVisible);
  const collision = useEditorStore((s) => s.collisionOverlay);
  return (
    <nav
      aria-label={t("status.tool")}
      className="flex w-rail shrink-0 flex-col items-center gap-1 border-r border-line bg-panel py-2"
    >
      {TOOLS.map(({ id, icon, command }, index) => (
        <Fragment key={id}>
          {index === GROUP_BREAK + 1 && <div aria-hidden className="my-1 h-px w-5 bg-line" />}
          <Tooltip label={t(`tools.${id}`)} command={command} side="right">
          <IconButton
            aria-label={t(`tools.${id}`)}
            aria-pressed={tool === id}
            active={tool === id}
            onClick={() => runCommand(command)}
          >
            <Icon name={icon} size={17} />
          </IconButton>
          </Tooltip>
        </Fragment>
      ))}
      <div className="mt-auto flex flex-col items-center gap-1">
        <Tooltip label={t("commands.view.toggleGrid")} command="view.toggleGrid" side="right">
          <IconButton
            aria-label={t("commands.view.toggleGrid")}
            aria-pressed={grid}
            active={grid}
            onClick={() => runCommand("view.toggleGrid")}
          >
            <Icon name="grid" size={17} />
          </IconButton>
        </Tooltip>
        <Tooltip label={t("commands.view.toggleCollision")} command="view.toggleCollision" side="right">
          <IconButton
            aria-label={t("commands.view.toggleCollision")}
            aria-pressed={collision}
            active={collision}
            onClick={() => runCommand("view.toggleCollision")}
          >
            <Icon name="shield" size={17} />
          </IconButton>
        </Tooltip>
        <Tooltip label={t("commands.view.frameMap")} command="view.frameMap" side="right">
          <IconButton aria-label={t("commands.view.frameMap")} onClick={() => runCommand("view.frameMap")}>
            <Icon name="frame" size={17} />
          </IconButton>
        </Tooltip>
      </div>
    </nav>
  );
}
