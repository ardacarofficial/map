import { Fragment } from "react";

import { runCommand } from "../../commands/registry";
import { useWorldView } from "../../commands/worldActions";
import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { IconButton } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { Tooltip } from "../primitives/Tooltip";
import { useLayoutStore } from "./layoutStore";
import { TOOLS } from "./tools";

/** Drawing tools and picking tools are separated by a divider after this index. */
const GROUP_BREAK = 3;

/**
 * The tools (left edge). The button at the bottom shows / hides the library
 * column, like VS Code's activity bar.
 */
export function ToolRail() {
  const tool = useEditorStore((s) => s.tool);
  const libraryCollapsed = useLayoutStore((s) => s.libraryCollapsed);
  const toggleLibrary = useLayoutStore((s) => s.toggleLibrary);
  // v1.2: the world map only pans (drag empty space) and moves levels; map tools are off.
  const world = useWorldView((s) => s.view === "world");
  const libraryLabel = libraryCollapsed ? t("layout.showLibrary") : t("layout.hideLibrary");
  return (
    <nav
      aria-label={t("status.tool")}
      title={world ? t("world.toolsDisabled") : undefined}
      className="flex w-rail shrink-0 flex-col items-center gap-1 border-r border-line bg-panel py-2"
    >
      {TOOLS.map(({ id, icon, command }, index) => (
        <Fragment key={id}>
          {(index === GROUP_BREAK + 1 || id === "entity") && <div aria-hidden className="my-1 h-px w-5 bg-line" />}
          <Tooltip label={t(`tools.${id}`)} command={command} side="right">
            <IconButton
              aria-label={t(`tools.${id}`)}
              aria-pressed={!world && tool === id}
              active={!world && tool === id}
              disabled={world}
              onClick={() => runCommand(command)}
            >
              <Icon name={icon} size={17} />
            </IconButton>
          </Tooltip>
        </Fragment>
      ))}
      {!world && (
        <div className="mt-auto flex flex-col items-center gap-1">
          <Tooltip label={libraryLabel} side="right">
            <IconButton aria-label={libraryLabel} aria-pressed={!libraryCollapsed} active={false} onClick={toggleLibrary} data-library-toggle>
              <Icon name="panels" size={17} className="-scale-x-100" />
            </IconButton>
          </Tooltip>
        </div>
      )}
    </nav>
  );
}
