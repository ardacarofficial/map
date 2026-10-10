import { Menu } from "@base-ui/react/menu";

import { getCommand, isEnabled, runCommand } from "../../commands/registry";
import { setCanvasView, useWorldView } from "../../commands/worldActions";
import { t, type MessageKey } from "../../i18n";
import type { CommandId } from "../../shortcuts/shortcuts";
import { keysFor } from "../../shortcuts/shortcuts";
import { Icon, type IconName } from "../primitives/Icon";
import { Kbd } from "../primitives/Kbd";
import { menuItemClass, menuPopupClass, menuPositionerClass } from "../primitives/menuStyles";
import { Tooltip } from "../primitives/Tooltip";
import { useLayoutStore, type LeftPanel } from "./layoutStore";

function RailButton({
  icon,
  label,
  on,
  command,
  onClick,
  data,
}: {
  icon: IconName;
  label: string;
  on: boolean;
  command?: CommandId;
  onClick(): void;
  data: string;
}) {
  return (
    <Tooltip label={label} side="right" {...(command ? { command } : {})}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={on}
        data-rail={data}
        onClick={onClick}
        className={`relative grid size-9 place-items-center rounded-md transition-colors duration-100 ${
          on ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover hover:text-text"
        }`}
      >
        {on && <span aria-hidden className="absolute top-1.5 bottom-1.5 -left-[6px] w-0.5 rounded-full bg-accent" />}
        <Icon name={icon} size={18} />
      </button>
    </Tooltip>
  );
}

const SETTINGS: readonly { command: CommandId; fallback: MessageKey }[] = [
  { command: "project.settings", fallback: "commands.project.settings" },
  { command: "settings.editShortcuts", fallback: "commands.settings.editShortcuts" },
  { command: "settings.language", fallback: "commands.settings.language" },
];

/** Ayarlar (bottom of the rail): project settings, app settings (shortcut file), language. */
function SettingsMenu() {
  return (
    <Menu.Root>
      <Tooltip label={t("rail.settings")} side="right">
        <Menu.Trigger
          aria-label={t("rail.settings")}
          data-rail="settings"
          className="grid size-9 place-items-center rounded-md text-muted outline-none transition-colors duration-100 hover:bg-hover hover:text-text data-popup-open:bg-active data-popup-open:text-text"
        >
          <Icon name="sliders" size={18} />
        </Menu.Trigger>
      </Tooltip>
      <Menu.Portal>
        <Menu.Positioner side="right" align="end" sideOffset={8} className={menuPositionerClass}>
          <Menu.Popup className={`${menuPopupClass} min-w-[220px]`}>
            {SETTINGS.map(({ command, fallback }) => {
              const cmd = getCommand(command);
              const keys = keysFor(command)[0];
              return (
                <Menu.Item
                  key={command}
                  data-command={command}
                  disabled={!cmd || !isEnabled(cmd)}
                  className={`${menuItemClass} py-1 text-sm`}
                  onClick={() => runCommand(command)}
                >
                  <span className="min-w-0 flex-1 truncate">{t(cmd?.title ?? fallback)}</span>
                  {keys && <Kbd keys={keys} className="ml-6 shrink-0" />}
                </Menu.Item>
              );
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * The left rail: which panel the left column shows (Kütüphane, Proje), the
 * world map (Dünya, W) and Ayarlar at the bottom. Pressing the shown panel
 * again hides the column (Ctrl+B does too). Tools live in the tool bar.
 */
export function PanelRail() {
  const panel = useLayoutStore((s) => s.leftPanel);
  const collapsed = useLayoutStore((s) => s.libraryCollapsed);
  const world = useWorldView((s) => s.view === "world");
  const show = (p: LeftPanel) => {
    if (world) setCanvasView("level");
    useLayoutStore.getState().showLeftPanel(p);
  };
  const shown = (p: LeftPanel) => !world && !collapsed && panel === p;
  return (
    <nav aria-label={t("layout.panelRail")} className="flex w-rail shrink-0 flex-col items-center gap-1.5 border-r border-line bg-bg py-2">
      <RailButton icon="layers" label={t("layout.library")} on={shown("library")} command="view.toggleLibrary" onClick={() => show("library")} data="library" />
      <RailButton icon="folder" label={t("project.title")} on={shown("project")} onClick={() => show("project")} data="project" />
      <RailButton icon="globe" label={t("world.world")} on={world} command="view.world" onClick={() => runCommand("view.world")} data="world" />
      <div className="mt-auto flex flex-col items-center">
        <SettingsMenu />
      </div>
    </nav>
  );
}
