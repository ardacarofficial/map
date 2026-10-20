import { useSaveStatus } from '../../io/saveStatus';
import { ModeSelector, PixelOptions } from "../pixel/PixelOptions";
import { usePixelUi } from "../../state/pixelUi";
import { GridControl, GridSettings } from "../toolOptions/GridControl";
import type { Ref } from "react";
import { Menu } from "../primitives/Overlays";
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

/** Options follow the active tool; view controls fold based on this bar's own width. */
export function OptionsBar() {
  const hasFolder = useSaveStatus(s => s.hasFolder);
  const pixelMode = usePixelUi(s => s.mode === "pixel");
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
    const measure = () => {
      const options = element.querySelector<HTMLElement>("[data-tool-chip]");
      const leading = options ? options.getBoundingClientRect().left - element.getBoundingClientRect().left : 0;
      setCompact(element.clientWidth < leading + (options?.scrollWidth ?? 0) + 140);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const options = element.querySelector<HTMLElement>("[data-tool-chip]");
    if (options) observer.observe(options);
    const mutations = new MutationObserver(measure);
    mutations.observe(element, { childList: true, subtree: true });
    measure();
    return () => { observer.disconnect(); mutations.disconnect(); };
  }, []);
  const toggles: { command: CommandId; icon: IconName; label: string; on: boolean }[] = [
    { command: "view.toggleGrid", icon: "grid-3x3", label: t("toolOptions.grid"), on: grid },
    { command: "view.toggleCollision", icon: "brick-wall", label: t("toolOptions.collisionView"), on: collision },
    { command: "view.toggleRulers", icon: "ruler", label: t("toolOptions.rulers"), on: rulers },
  ];
  return (
    <div ref={bar} role="toolbar" aria-label={t("toolOptions.bar")} className="flex h-optionsbar min-w-0 shrink-0 items-center gap-2 border-b border-line bg-panel px-2">
      <ModeSelector disabled={world} />
      <div className="flex shrink-0 items-center gap-2 text-sm font-medium text-text">
        <Icon name={world ? "map" : toolIcon(tool)} size={16} className="text-muted" />
        <span>{world ? t("world.world") : tool === "line" ? t("pixel.line") : t(`tools.${tool}`)}</span>
      </div>
      {!world && <><Divider orientation="vertical" length={16} tone="line" /><div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">{pixelMode ? <PixelOptions /> : <ToolOptions />}</div></>}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {(compact || pixelMode) ? (
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
              <Menu.Positioner side="bottom" align="end" className={menuPositionerClass}>
                <Menu.Popup className={menuPopupClass}>
                  {pixelMode && <Menu.Item className={menuItemClass} data-command="pixel.applyPng" disabled={world || !hasFolder} title={!hasFolder ? t("pngWriteback.saveFirst") : undefined} onClick={() => runCommand('pixel.applyPng')}>{t('pngWriteback.apply')}</Menu.Item>}
                  {pixelMode && <Menu.Item className={menuItemClass} data-command="pixel.restorePng" disabled={world || !hasFolder} title={!hasFolder ? t("pngWriteback.saveFirst") : undefined} onClick={() => runCommand('pixel.restorePng')}>{t('pngWriteback.restore')}</Menu.Item>}
                  {toggles.map(({ command, icon, label, on }) => (
                    <Menu.CheckboxItem key={command} checked={on} disabled={world} closeOnClick data-view-toggle={command} data-command={command} className={menuItemClass} onCheckedChange={() => runCommand(command)}>
                      <span className="grid size-4 place-items-center">{on && <Icon name="tick" size={12} />}</span>
                      <span className="text-muted"><Icon name={icon} size={16} /></span><span>{label}</span>
                      {keysFor(command)[0] && <KbdText keys={keysFor(command)[0]!} className={`${menuShortcutClass} shrink-0 pl-6`} />}
                    </Menu.CheckboxItem>
                  ))}
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        ) : toggles.map(({ command, icon, label, on }) => command === "view.toggleGrid" ? <GridControl key={command} disabled={world} /> : (
          <Tooltip key={command} label={label} command={command}>
            <IconButton size="md" aria-label={label} active={on} aria-pressed={on} disabled={world} data-view-toggle={command} onClick={() => runCommand(command)}><Icon name={icon} size={16} /></IconButton>
          </Tooltip>
        ))}
        {(compact || pixelMode) && <GridSettings disabled={world} />}
      </div>
    </div>
  );
}
