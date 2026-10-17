import { t } from "../../../i18n";
import { Button } from "../../primitives/Button";
import { Icon } from "../../primitives/Icon";

export function ModeStrip({ mode, fixing, solidCount, onDone }: { mode: "solid" | "terrain"; fixing: boolean; solidCount: number; onDone(): void }) {
  return <div className="flex h-row shrink-0 items-center gap-2 border-b border-line-subtle bg-panel px-2">
    <Icon name={mode === "solid" ? "brick-wall" : "mountain"} className={mode === "solid" ? "text-collision-solid" : "text-terrain-tint"} />
    <span className="shrink-0 text-sm font-medium text-text">{t(mode === "solid" ? "tilesetPanel.modeSolid" : "tilesetPanel.modeTerrain")}</span>
    <span className="min-w-0 truncate text-sm text-muted" data-tileset-hint>{t(mode === "solid" ? "tilesetLib.hintSolid" : fixing ? "terrain.fixHintShort" : "terrain.hintDrag")}</span>
    {mode === "solid" && <span className="shrink-0 font-mono text-xs text-faint">{t("tileset.solidCount", { count: solidCount })}</span>}
    <Button variant="secondary" size="sm" className="ml-auto shrink-0" onClick={onDone}>{t("tileset.done")}</Button>
  </div>;
}
