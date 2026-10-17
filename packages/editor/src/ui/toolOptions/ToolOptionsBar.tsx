import { Menu } from "@base-ui/react/menu";
import { Fragment, useRef, useState, useSyncExternalStore } from "react";

import { runCommand } from "../../commands/registry";
import { useWorldView } from "../../commands/worldActions";
import { getLocale, t } from "../../i18n";
import { keysFor } from "../../shortcuts/shortcuts";
import { useEditorStore } from "../../state/editorStore";
import { useStructureVersion } from "../hooks";
import { Icon, type IconName } from "../primitives/Icon";
import { Kbd } from "../primitives/Kbd";
import { menuItemClass, menuPopupClass, menuPositionerClass, menuSeparatorClass } from "../primitives/menuStyles";
import { getCanvasHandle } from "../canvas/canvasHandle";
import { formatZoomPercent, parseZoomPercent } from "./zoomInput";
import { registerBrushCommands } from "./brushCommands";
import { registerBuiltinToolOptions } from "./builtins";
import { OptionDivider } from "./parts";
import { subscribeToolOptions, toolOptionsFor, toolOptionsVersion } from "./registry";

registerBuiltinToolOptions();
registerBrushCommands();

/**
 * The active tool's options (from the tool options registry), inline in
 * the tool bar above the canvas, left to right. Nothing on the world map.
 */
export function ToolOptions() {
  const world = useWorldView((s) => s.view === "world");
  const tool = useEditorStore((s) => s.tool);
  const store = useEditorStore((s) => s.project?.store);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  useStructureVersion(store);
  useSyncExternalStore(subscribeToolOptions, toolOptionsVersion);
  if (world) return null;
  const doc = store?.document;
  const layer = activeLayerId ? doc?.getLayer(activeLayerId) : undefined;
  const entries = toolOptionsFor({ tool, doc, layer });
  return (
    <div role="group" aria-label={t("toolOptions.bar")} data-tool-chip={tool} className="flex min-w-0 items-center gap-2 overflow-hidden">
      {entries.map(({ id, Component }, i) => (
        <Fragment key={id}>
          {i > 0 && <OptionDivider />}
          <Component />
        </Fragment>
      ))}
    </div>
  );
}

const ZOOM_ITEMS: { command: "view.zoomIn" | "view.zoomOut" | "view.zoomReset" | "view.frameMap"; icon: IconName }[] = [
  { command: "view.zoomIn", icon: "zoomIn" },
  { command: "view.zoomOut", icon: "zoomOut" },
  { command: "view.zoomReset", icon: "search" },
  { command: "view.frameMap", icon: "frame" },
];

/** Presets when the canvas is not up yet (it normally supplies its own). */
const FALLBACK_PRESETS: readonly number[] = [0.25, 0.5, 1, 2, 4, 8];

/**
 * [ 100 % ⌄ ]: the percentage is a field (type a value, Enter), the
 * chevron opens the presets, zoom in / out and "fit / 100 %"; the canvas
 * does the zooming.
 */
export function ZoomControl() {
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
      <div className="flex h-full items-center">
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
            className="w-[40px] bg-transparent text-right outline-none"
          />
          <span className="pr-0.5 text-faint">%</span>
        </label>
        <Menu.Root>
          <Menu.Trigger
            aria-label={t("zoomMenu.presets")}
            data-zoom-menu=""
            className="grid h-full w-6 place-items-center rounded-r-md text-faint outline-none hover:bg-hover hover:text-text data-popup-open:bg-hover data-popup-open:text-text"
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
                        {on && <Icon name="check" size={13} />}
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
    </div>
  );
}
