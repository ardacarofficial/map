import { Menu } from "@base-ui/react/menu";
import { useRef, useState, useSyncExternalStore } from "react";

import { runCommand } from "../../commands/registry";
import { getLocale, t } from "../../i18n";
import { keysFor } from "../../shortcuts/shortcuts";
import { useEditorStore } from "../../state/editorStore";
import { Icon, type IconName } from "../primitives/Icon";
import { KbdText } from "../primitives/Kbd";
import { menuItemClass, menuPopupClass, menuPositionerClass, menuSeparatorClass, menuShortcutClass } from "../primitives/menuStyles";
import { getCanvasHandle, watchCanvasHandle } from "../canvas/canvasHandle";
import { formatZoomPercent, parseZoomPercent } from "./zoomInput";

const ZOOM_ITEMS: { command: "view.zoomIn" | "view.zoomOut"; icon: IconName }[] = [
  { command: "view.zoomIn", icon: "zoomIn" },
  { command: "view.zoomOut", icon: "zoomOut" },
];

/** The menu's presets (DESIGN.md §4.7): 50, 100, 200 and 400 %. */
const MENU_PRESETS: readonly number[] = [0.5, 1, 2, 4];

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
  const cancelled = useRef(false);
  const handle = useSyncExternalStore(watchCanvasHandle, getCanvasHandle);
  // Labelled with the zoom each preset really gives (what the field then shows).
  const presets = [...new Set(MENU_PRESETS.map((p) => handle?.effectiveZoom(p) ?? p))];
  const resetKeys = keysFor("view.zoomReset")[0];
  const fitKeys = keysFor("view.frameMap")[0];
  const percent = (value: number) => (locale === "tr" ? `%${formatZoomPercent(value, locale)}` : `${formatZoomPercent(value, locale)}%`);

  const apply = () => {
    const value = cancelled.current || draft === null ? null : parseZoomPercent(draft);
    cancelled.current = false;
    setDraft(null);
    if (value !== null) getCanvasHandle()?.setZoom(value);
  };

  return (
    <div className="flex h-5 items-center rounded-sm border border-transparent hover:border-line hover:bg-field focus-within:border-line focus-within:bg-field" data-zoom-control>
      <div className="flex h-full items-center">
        <label className="flex h-full items-center px-1 text-xs text-text tabular">
          {locale === "tr" && <span className="text-faint">%</span>}
          <input
            ref={inputRef}
            aria-label={t("zoomMenu.input")}
            data-zoom-input=""
            inputMode="decimal"
            value={draft ?? shown}
            onFocus={(e) => {
              cancelled.current = false;
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
                cancelled.current = true;
                setDraft(null);
                inputRef.current?.blur();
              }
            }}
            spellCheck={false}
            autoComplete="off"
            maxLength={7}
            className={`h-full w-10 min-h-0 border-0 bg-transparent py-0 text-xs leading-none outline-none ${locale === "tr" ? "text-left" : "text-right"}`}
          />
          {locale === "en" && <span className="text-faint">%</span>}
        </label>
        <Menu.Root>
          <Menu.Trigger
            aria-label={t("zoomMenu.presets")}
            data-zoom-menu=""
            className="grid h-control-sm w-6 self-center place-items-center rounded-r-sm text-faint outline-none hover:bg-hover hover:text-text data-popup-open:bg-hover data-popup-open:text-text"
          >
            <Icon name="chevronDown" size={12} />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner side="top" align="end" sideOffset={4} className={menuPositionerClass}>
              <Menu.Popup className={`${menuPopupClass} min-w-56`}>
                <Menu.Item data-command="view.frameMap" className={menuItemClass} onClick={() => runCommand("view.frameMap")}>
                  <span aria-hidden className="size-4 shrink-0" />
                  <span className="flex-1">{t("zoomMenu.fit")}</span>
                  {fitKeys && <KbdText keys={fitKeys} className={`${menuShortcutClass} shrink-0 pl-6`} />}
                </Menu.Item>
                {presets.map((value) => {
                  const on = Math.abs(value - zoom) < 0.001;
                  return (
                    <Menu.Item
                      key={value}
                      data-zoom-preset={value}
                      className={`${menuItemClass} tabular`}
                      onClick={() => getCanvasHandle()?.setZoom(value)}
                    >
                      <span aria-hidden className="grid size-4 shrink-0 place-items-center text-muted">
                        {on && <Icon name="tick" size={12} />}
                      </span>
                      <span className="flex-1">{percent(value)}</span>
                      {Math.abs(value - (handle?.effectiveZoom(1) ?? 1)) < 0.001 && resetKeys && (
                        <KbdText keys={resetKeys} className={`${menuShortcutClass} shrink-0 pl-6`} />
                      )}
                    </Menu.Item>
                  );
                })}
                <Menu.Separator className={menuSeparatorClass} />
                {ZOOM_ITEMS.map(({ command, icon }) => {
                  const keys = keysFor(command)[0];
                  return (
                    <Menu.Item key={command} data-command={command} className={menuItemClass} onClick={() => runCommand(command)}>
                      <Icon name={icon} size={16} className="text-muted" />
                      <span className="flex-1">{t(`commands.${command}`)}</span>
                      {keys && <KbdText keys={keys} className={`${menuShortcutClass} shrink-0 pl-6`} />}
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
