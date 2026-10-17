import { Menu } from "@base-ui/react/menu";

import { t } from "../../../i18n";
import { Button } from "../../primitives/Button";
import { Icon } from "../../primitives/Icon";
import { menuItemClass, menuPopupClass, menuPositionerClass } from "../../primitives/menuStyles";
import { Tooltip } from "../../primitives/Tooltip";
import { ZOOM_STEPS } from "../zoomModel";

export const formattedZoom = (scale: number) => t("tilesetDock.zoomPercent", { value: Math.round(scale * 100) });

export interface ZoomProps {
  override: number | null;
  onResetOverride(): void;
  globalZoom: number | null;
  shownScale: number;
  onZoom(zoom: number | null): void;
}
export function ZoomControl({ override, onResetOverride, globalZoom, shownScale, onZoom, stack }: ZoomProps & { stack: boolean }) {
  const fit = globalZoom === null && override === null;
  return <div className="flex shrink-0 items-center gap-1" data-tileset-zoom>
    {override !== null && <Tooltip label={t("tilesetLib.zoomOverrideReset")}>
      <button type="button" data-tileset-zoom-override onClick={onResetOverride} className="flex h-control-sm shrink-0 items-center gap-1 rounded-sm bg-accent-soft px-1 font-mono text-xs text-accent">
        {formattedZoom(override)}<Icon name="x" size={12} />
      </button>
    </Tooltip>}
    {stack && <Tooltip label={t("tilesetLib.wheelHint")}><span role="img" aria-label={t("tilesetLib.wheelHint")} data-tileset-wheel-hint className="flex size-6 items-center justify-center text-faint"><Icon name="info" /></span></Tooltip>}
    <Menu.Root>
      <Menu.Trigger data-tileset-zoom-label className="h-control-sm w-14 rounded-sm border border-line bg-field px-1 font-mono text-sm text-text hover:border-line-strong">{formattedZoom(shownScale)}</Menu.Trigger>
      <Menu.Portal><Menu.Positioner side="top" align="end" sideOffset={4} className={menuPositionerClass}><Menu.Popup className={menuPopupClass}>
        <Menu.Item className={menuItemClass} onClick={() => onZoom(null)}>{t("tileset.zoomFit")}</Menu.Item>
        {ZOOM_STEPS.filter((step) => [0.5, 1, 2, 4].includes(step)).map((step) => <Menu.Item key={step} className={menuItemClass} onClick={() => onZoom(step)}>{formattedZoom(step)}</Menu.Item>)}
      </Menu.Popup></Menu.Positioner></Menu.Portal>
    </Menu.Root>
    <Tooltip label={t("tilesetPanel.zoomFitTitle")}><Button variant="ghost" size="sm" className="border border-transparent aria-pressed:border-line-strong aria-pressed:bg-active aria-pressed:text-title" aria-pressed={fit} data-tileset-zoom-fit onClick={() => onZoom(null)}>{t("tileset.zoomFit")}</Button></Tooltip>
  </div>;
}
