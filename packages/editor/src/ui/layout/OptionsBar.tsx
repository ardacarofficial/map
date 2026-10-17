import type { Ref } from "react";
import { Menu } from "@base-ui/react/menu";
import { useEffect, useRef, useState } from "react";

import { runCommand } from "../../commands/registry";
import { useWorldView } from "../../commands/worldActions";
import { t } from "../../i18n";
import { keysFor, type CommandId } from "../../shortcuts/shortcuts";
import { useEditorStore } from "../../state/editorStore";
import { IconButton } from "../primitives/Button";
import { Divider } from "../primitives/Divider";
import { Icon, type IconName } from "../primitives/Icon";
import { KbdText } from "../primitives/Kbd";
import { menuItemClass, menuPopupClass, menuPositionerClass, menuShortcutClass } from "../primitives/menuStyles";
import { Tooltip } from "../primitives/Tooltip";
import { ToolOptions } from "../toolOptions/ToolOptionsBar";
import { useLayoutStore } from "./layoutStore";
import { registerRulerCommands } from "./rulers";
import { toolIcon } from "./tools";

registerRulerCommands();

/** Lucide "ruler" (not in the shared Icon set), drawn with the same 1.5 px absolute stroke at 16 px. */
function RulerIcon() {
  return (
    <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z" />
      <path d="m14.5 12.5 2-2" />
      <path d="m11.5 9.5 2-2" />
      <path d="m8.5 6.5 2-2" />
      <path d="m17.5 15.5 2-2" />
    </svg>
  );
}

function ToggleIcon({ icon }: { icon: IconName | "ruler" }) {
  return icon === "ruler" ? <RulerIcon /> : <Icon name={icon} size={16} />;
}

/** Options follow the active tool; view controls fold based on this bar's own width. */
export function OptionsBar() {
  const tool = useEditorStore((s) => s.tool);
  const grid = useEditorStore((s) => s.gridVisible);
  const collision = useEditorStore((s) => s.collisionOverlay);
  const rulers = useLayoutStore((s) => s.rulersVisible);
  const world = useWorldView((s) => s.view === "world");
  const bar = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const element = bar.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setCompact(entry.contentRect.width < 640);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const toggles: { command: CommandId; icon: IconName | "ruler"; label: string; on: boolean }[] = [
    { command: "view.toggleGrid", icon: "grid-3x3", label: t("toolOptions.grid"), on: grid },
    { command: "view.toggleCollision", icon: "brick-wall", label: t("toolOptions.collisionView"), on: collision },
    { command: "view.toggleRulers", icon: "ruler", label: t("toolOptions.rulers"), on: rulers },
  ];
  return (
    <div ref={bar} role="toolbar" aria-label={t("toolOptions.bar")} className="flex h-optionsbar min-w-0 shrink-0 items-center gap-2 border-b border-line bg-panel px-2">
      <div className="flex shrink-0 items-center gap-2 text-sm font-medium text-text">
        <Icon name={world ? "map" : toolIcon(tool)} size={16} className="text-muted" />
        <span>{world ? t("world.world") : t(`tools.${tool}`)}</span>
      </div>
      {!world && <><Divider orientation="vertical" length={16} tone="line" /><div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]"><ToolOptions /></div></>}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {compact ? (
          <Menu.Root>
            <Tooltip label={t("toolOptions.viewOptions")}>
              <Menu.Trigger
                aria-label={t("toolOptions.viewOptions")}
                className="data-popup-open:bg-active data-popup-open:text-text"
                render={({ ref, ...props }) => (
            <IconButton {...props} {...(ref ? { ref: ref as Ref<HTMLButtonElement> } : {})} size="md">
              {props.children}
            </IconButton>
          )}
              >
                <Icon name="ellipsis" size={16} />
              </Menu.Trigger>
            </Tooltip>
            <Menu.Portal>
              <Menu.Positioner side="bottom" align="end" sideOffset={4} className={menuPositionerClass}>
                <Menu.Popup className={menuPopupClass}>
                  {toggles.map(({ command, icon, label, on }) => (
                    <Menu.CheckboxItem key={command} checked={on} disabled={world} closeOnClick data-view-toggle={command} data-command={command} className={menuItemClass} onCheckedChange={() => runCommand(command)}>
                      <span className="grid size-4 place-items-center">{on && <Icon name="tick" size={12} />}</span>
                      <span className="text-muted"><ToggleIcon icon={icon} /></span><span>{label}</span>
                      {keysFor(command)[0] && <KbdText keys={keysFor(command)[0]!} className={`${menuShortcutClass} shrink-0 pl-6`} />}
                    </Menu.CheckboxItem>
                  ))}
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        ) : toggles.map(({ command, icon, label, on }) => (
          <Tooltip key={command} label={label} command={command}>
            <IconButton size="md" aria-label={label} active={on} aria-pressed={on} disabled={world} data-view-toggle={command} onClick={() => runCommand(command)}><ToggleIcon icon={icon} /></IconButton>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}
