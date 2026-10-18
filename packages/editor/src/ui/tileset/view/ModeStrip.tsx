import { t } from "../../../i18n";
import { Button } from "../../primitives/Button";
import { Tooltip } from "../../primitives/Tooltip";

/** Inline instruction and exit action in the 32px dock header. */
export function ModeStrip({ mode, fixing, onDone }: { mode: "solid" | "terrain"; fixing: boolean; onDone(): void }) {
  const hint = t(mode === "solid" ? "tilesetLib.hintSolid" : fixing ? "terrain.fixHintShort" : "terrain.hintDrag");
  return <div data-header-flexible className="flex min-w-0 flex-1 items-center gap-2">
    <Tooltip label={hint}><span title={hint} className="min-w-0 flex-1 truncate text-sm text-muted" data-tileset-hint>{hint}</span></Tooltip>
    <Button variant="secondary" size="sm" className="shrink-0" onClick={onDone}>{t("tileset.done")}</Button>
  </div>;
}
