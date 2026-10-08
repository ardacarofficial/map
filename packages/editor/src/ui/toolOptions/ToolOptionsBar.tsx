import { Menu } from "@base-ui/react/menu";
import { Fragment, useRef, useState, useSyncExternalStore } from "react";

import { runCommand } from "../../commands/registry";
import { useWorldView } from "../../commands/worldActions";
import { getLocale, t } from "../../i18n";
import { keysFor, type CommandId } from "../../shortcuts/shortcuts";
import { useEditorStore } from "../../state/editorStore";
import { useStructureVersion } from "../hooks";
import { Icon, type IconName } from "../primitives/Icon";
import { Kbd } from "../primitives/Kbd";
import { menuItemClass, menuPopupClass, menuPositionerClass, menuSeparatorClass } from "../primitives/menuStyles";
import { Toggle } from "../primitives/Toggle";
import { Tooltip } from "../primitives/Tooltip";
import { toolIcon } from "../layout/tools";
import { getCanvasHandle } from "../canvas/canvasHandle";
import { formatZoomPercent, parseZoomPercent } from "./zoomInput";
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

const ZOOM_ITEMS: { command: "view.zoomReset" | "view.frameMap"; icon: IconName }[] = [
  { command: "view.zoomReset", icon: "search" },
  { command: "view.frameMap", icon: "frame" },
];

/** Presets when the canvas is not up yet (it normally supplies its own). */
const FALLBACK_PRESETS: readonly number[] = [0.25, 0.5, 1, 2, 4, 8];

/**
 * − [ 100 % ⌄ ] +: the percentage is a field (type a value, Enter), the
 * chevron opens the presets and "fit / 100 %"; the canvas does the zooming.
 */
function ZoomControl() {
  const zoom = useEditorStore((s) => s.zoom);
  const locale = getLocale();
  const shown = formatZoomPercent(zoom, locale);
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const handle = getCanvasHandle();
  // Labelled with the zoom each preset really gives (what the field then shows).
  const presets = [...new Set((handle?.zoomPresets ?? FALLBACK_PRESETS).map((p) => handle?.effectiveZoom(p) ?? p))];

  const apply = () => {
    const value = draft === null ? null : parseZoomPercent(draft);
    setDraft(null);
    if (value !== null) getCanvasHandle()?.setZoom(value);
  };

  return (
    <div className="flex h-7 items-center rounded-md border border-line bg-raised" data-zoom-control>
      <StepButton icon="minus" label={t("commands.view.zoomOut")} command="view.zoomOut" onClick={() => runCommand("view.zoomOut")} />
      <div className="flex h-full items-center border-x border-line">
        <label className="flex h-full items-center pl-1.5 font-mono text-sm text-text tabular">
          <input
            ref={inputRef}
            aria-label={t("zoomMenu.input")}
            data-zoom-input=""
            inputMode="decimal"
            value={draft ?? shown}
            onFocus={(e) => {
              setDraft(shown);
              e.currentTarget.select();
            }}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={apply}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                apply();
                e.currentTarget.blur();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setDraft(null);
                // Leave without applying: the next blur sees no draft.
                requestAnimationFrame(() => inputRef.current?.blur());
              }
            }}
            spellCheck={false}
            autoComplete="off"
            maxLength={7}
            className="w-[42px] bg-transparent text-right outline-none"
          />
          <span className="pr-0.5 text-faint">%</span>
        </label>
        <Menu.Root>
          <Menu.Trigger
            aria-label={t("zoomMenu.presets")}
            data-zoom-menu=""
            className="grid h-full w-5 place-items-center text-faint outline-none hover:bg-hover hover:text-text data-popup-open:bg-hover data-popup-open:text-text"
          >
            <Icon name="chevronDown" size={12} />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner side="bottom" align="end" sideOffset={4} className={menuPositionerClass}>
              <Menu.Popup className={`${menuPopupClass} min-w-[220px]`}>
                {[...presets].reverse().map((value) => {
                  const on = Math.abs(value - zoom) < 0.001;
                  return (
                    <Menu.Item
                      key={value}
                      data-zoom-preset={value}
                      className={`${menuItemClass} py-1 font-mono text-sm tabular`}
                      onClick={() => getCanvasHandle()?.setZoom(value)}
                    >
                      <span aria-hidden className="grid size-4 shrink-0 place-items-center text-accent">
                        {on && <Icon name="check" size={13} strokeWidth={2.25} />}
                      </span>
                      <span className="flex-1">{formatZoomPercent(value, locale)}%</span>
                    </Menu.Item>
                  );
                })}
                <Menu.Separator className={menuSeparatorClass} />
                {ZOOM_ITEMS.map(({ command, icon }) => {
                  const keys = keysFor(command)[0];
                  return (
                    <Menu.Item key={command} className={`${menuItemClass} py-1 text-sm`} onClick={() => runCommand(command)}>
                      <Icon name={icon} size={14} className="text-faint" />
                      <span className="flex-1">{t(`commands.${command}`)}</span>
                      {keys && <Kbd keys={keys} />}
                    </Menu.Item>
                  );
                })}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </div>
      <StepButton icon="plus" label={t("commands.view.zoomIn")} command="view.zoomIn" onClick={() => runCommand("view.zoomIn")} />
    </div>
  );
}
