import { usePixelUi } from "../../state/pixelUi";
import type { Ref } from "react";
import { Menu } from "@base-ui/react/menu";
import { Fragment } from "react";

import { getCommand, isEnabled, runCommand } from "../../commands/registry";
import { useWorldView } from "../../commands/worldActions";
import { t, type MessageKey } from "../../i18n";
import { keysFor, type CommandId } from "../../shortcuts/shortcuts";
import { useEditorStore } from "../../state/editorStore";
import { IconButton } from "../primitives/Button";
import { Divider } from "../primitives/Divider";
import { Icon } from "../primitives/Icon";
import { KbdText } from "../primitives/Kbd";
import { menuItemClass, menuPopupClass, menuPositionerClass, menuShortcutClass } from "../primitives/menuStyles";
import { Tooltip } from "../primitives/Tooltip";
import { TOOLS, PIXEL_TOOLS } from "./tools";

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
          className="data-popup-open:bg-active data-popup-open:text-text"
          render={({ ref, ...props }) => (
            <IconButton {...props} {...(ref ? { ref: ref as Ref<HTMLButtonElement> } : {})} size="rail">
              {props.children}
            </IconButton>
          )}
        >
          <Icon name="settings-2" size={20} />
        </Menu.Trigger>
      </Tooltip>
      <Menu.Portal>
        <Menu.Positioner side="right" align="end" sideOffset={8} className={menuPositionerClass}>
          <Menu.Popup className={`${menuPopupClass} min-w-56`}>
            {SETTINGS.map(({ command, fallback }) => {
              const cmd = getCommand(command);
              const keys = keysFor(command)[0];
              return (
                <Menu.Item
                  key={command}
                  data-command={command}
                  disabled={!cmd || !isEnabled(cmd)}
                  className={menuItemClass}
                  onClick={() => runCommand(command)}
                >
                  <span className="min-w-0 flex-1 truncate">{t(cmd?.title ?? fallback)}</span>
                  {keys && <KbdText keys={keys} className={`${menuShortcutClass} shrink-0 pl-6`} />}
                </Menu.Item>
              );
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Editing tools, with settings anchored at the bottom. */
export function ToolRail() {
  const pixelMode = usePixelUi(s => s.mode === "pixel");
  const tool = useEditorStore((s) => s.tool);
  const world = useWorldView((s) => s.view === "world");
  return (
    <nav role="toolbar" aria-label={t("layout.toolRail")} aria-orientation="vertical" className="flex w-rail shrink-0 flex-col items-center gap-1 border-r border-line bg-bg py-1">
      {(pixelMode ? PIXEL_TOOLS : TOOLS).map(({ id, icon, command, group }) => (
        <Fragment key={id}>
          {group && <div className="my-1 w-4"><Divider /></div>}
          <Tooltip label={world ? t("world.toolsDisabled") : (id === "line" ? t("pixel.line") : t(`tools.${id}`))} command={command} side="right">
            <span className="flex"><IconButton size="rail" aria-label={(id === "line" ? t("pixel.line") : t(`tools.${id}`))} aria-pressed={!world && tool === id} active={!world && tool === id} disabled={world} data-tool-button={id} onClick={() => runCommand(command)}>
              <Icon name={icon} size={20} />
            </IconButton></span>
          </Tooltip>
        </Fragment>
      ))}
      <div className="mt-auto flex flex-col items-center gap-1 pt-2">
        <SettingsMenu />
      </div>
    </nav>
  );
}
