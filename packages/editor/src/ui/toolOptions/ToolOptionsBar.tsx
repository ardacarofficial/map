import { Menu } from "@base-ui/react/menu";
import { Fragment, useSyncExternalStore } from "react";

import { runCommand } from "../../commands/registry";
import { useWorldView } from "../../commands/worldActions";
import { formatNumber, t } from "../../i18n";
import { keysFor, type CommandId } from "../../shortcuts/shortcuts";
import { useEditorStore } from "../../state/editorStore";
import { useStructureVersion } from "../hooks";
import { Icon, type IconName } from "../primitives/Icon";
import { Kbd } from "../primitives/Kbd";
import { menuItemClass, menuPopupClass, menuPositionerClass, menuSeparatorClass } from "../primitives/menuStyles";
import { Toggle } from "../primitives/Toggle";
import { Tooltip } from "../primitives/Tooltip";
import { toolIcon } from "../layout/tools";
import { registerBrushCommands } from "./brushCommands";
import { registerBuiltinToolOptions } from "./builtins";
import { OptionDivider, StepButton } from "./parts";
import { subscribeToolOptions, toolOptionsFor, toolOptionsVersion } from "./registry";

registerBuiltinToolOptions();
registerBrushCommands();

/**
 * The strip under the menu bar: the active tool and only its options (left,
 * from the tool options registry), view switches and zoom (right, always).
 */
export function ToolOptionsBar() {
  const world = useWorldView((s) => s.view === "world");
  return (
    <div
      role="toolbar"
      aria-label={t("toolOptions.bar")}
      className="flex h-optionsbar shrink-0 items-center gap-2 border-b border-line bg-panel pr-2 pl-2"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">{world ? <WorldOptions /> : <ToolOptions />}</div>
      <ViewControls world={world} />
    </div>
  );
}

function ToolOptions() {
  const tool = useEditorStore((s) => s.tool);
  const store = useEditorStore((s) => s.project?.store);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  useStructureVersion(store);
  useSyncExternalStore(subscribeToolOptions, toolOptionsVersion);
  const doc = store?.document;
  const layer = activeLayerId ? doc?.getLayer(activeLayerId) : undefined;
  const entries = toolOptionsFor({ tool, doc, layer });
  return (
    <>
      <div className="flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-accent-soft pr-2.5 pl-2 text-sm font-medium text-accent" data-tool-chip={tool}>
        <Icon name={toolIcon(tool)} size={14} />
        {t(`tools.${tool}`)}
      </div>
      {entries.map(({ id, Component }) => (
        <Fragment key={id}>
          <OptionDivider />
          <Component />
        </Fragment>
      ))}
    </>
  );
}

function WorldOptions() {
  return (
    <>
      <div className="flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-accent-soft pr-2.5 pl-2 text-sm font-medium text-accent">
        <Icon name="globe" size={14} />
        {t("world.world")}
      </div>
      <OptionDivider />
      <span className="truncate text-sm text-faint">{t("world.hint")}</span>
    </>
  );
}

function ViewSwitch({ label, command, checked, disabled }: { label: string; command: CommandId; checked: boolean; disabled?: boolean }) {
  return (
    <Tooltip label={label} command={command}>
      <label className={`flex h-7 shrink-0 cursor-default items-center gap-1.5 rounded-md px-1.5 text-sm text-muted hover:text-text ${disabled ? "pointer-events-none opacity-40" : ""}`}>
        <Toggle checked={checked} onChange={() => runCommand(command)} label={label} />
        <span className="hidden lg:inline">{label}</span>
      </label>
    </Tooltip>
  );
}

function ViewControls({ world }: { world: boolean }) {
  const grid = useEditorStore((s) => s.gridVisible);
  const collision = useEditorStore((s) => s.collisionOverlay);
  return (
    <div className="flex shrink-0 items-center gap-1">
      <ViewSwitch label={t("toolOptions.collisionView")} command="view.toggleCollision" checked={collision} disabled={world} />
      <ViewSwitch label={t("toolOptions.grid")} command="view.toggleGrid" checked={grid} disabled={world} />
      <OptionDivider />
      <ZoomControl />
    </div>
  );
}

const ZOOM_ITEMS: { command: "view.zoomIn" | "view.zoomOut" | "view.zoomReset" | "view.frameMap"; icon: IconName }[] = [
  { command: "view.zoomIn", icon: "zoomIn" },
  { command: "view.zoomOut", icon: "zoomOut" },
  { command: "view.zoomReset", icon: "search" },
  { command: "view.frameMap", icon: "frame" },
];

/** − [ 100% ▾ ] +: the dropdown runs the zoom commands (the canvas does the zooming). */
function ZoomControl() {
  const zoom = useEditorStore((s) => s.zoom);
  return (
    <div className="flex h-7 items-center rounded-md border border-line bg-raised" data-zoom-control>
      <StepButton icon="minus" label={t("commands.view.zoomOut")} command="view.zoomOut" onClick={() => runCommand("view.zoomOut")} />
      <Menu.Root>
        <Menu.Trigger
          aria-label={t("status.zoom")}
          className="flex h-full min-w-[64px] items-center justify-center gap-1 border-x border-line px-1.5 font-mono text-sm text-text tabular outline-none hover:bg-hover data-popup-open:bg-hover"
        >
          {formatNumber(Math.round(zoom * 100))}%
          <Icon name="chevronDown" size={12} className="text-faint" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="end" sideOffset={4} className={menuPositionerClass}>
            <Menu.Popup className={`${menuPopupClass} min-w-[220px]`}>
              {ZOOM_ITEMS.map(({ command, icon }, i) => {
                const keys = keysFor(command)[0];
                return (
                  <Fragment key={command}>
                    {i === 2 && <Menu.Separator className={menuSeparatorClass} />}
                    <Menu.Item className={`${menuItemClass} py-1 text-sm`} onClick={() => runCommand(command)}>
                      <Icon name={icon} size={14} className="text-faint" />
                      <span className="flex-1">{t(`commands.${command}`)}</span>
                      {keys && <Kbd keys={keys} />}
                    </Menu.Item>
                  </Fragment>
                );
              })}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <StepButton icon="plus" label={t("commands.view.zoomIn")} command="view.zoomIn" onClick={() => runCommand("view.zoomIn")} />
    </div>
  );
}
