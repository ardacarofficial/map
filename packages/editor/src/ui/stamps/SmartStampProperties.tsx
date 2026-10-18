import { nineSliceProblem, type Stamp } from "@smap/core";
import { useEffect, useRef } from "react";
import { disableSmartStamp, useSmartStampDialog } from "../../commands/smartStampCommands";
import { t } from "../../i18n";
import { useProjectLibrary } from "../../io/projectLibrary";
import { sameBakeRecipe } from "../../io/smartStampRecipes";
import { useEditorStore } from "../../state/editorStore";
import { Button } from "../primitives/Button";
import { PropRow } from "../primitives/PropRow";
import { Toggle } from "../primitives/Toggle";
import { Tooltip } from "../primitives/Tooltip";
import { useStampLibrary } from "./stampLibraryStore";

export function SmartStampProperties({ stamp }: { stamp: Stamp }) {
  const ref = useRef<HTMLButtonElement>(null);
  const tick = useStampLibrary(s => s.focusField === "nineSlice" && s.selectedId === stamp.id ? s.focusTick : 0);
  const doc = useEditorStore(s => s.project?.store.document);
  const recipes = useProjectLibrary(s => s.generatedRecipes);
  // An explicitly disabled, unchanged stamp needs no maintenance. Edited source cells do.
  const bakedRecipes = recipes.filter(r => doc?.getTileset(r.tilesetId)?.generated?.stampId === stamp.id);
  const needsBake = !stamp.nineSlice && bakedRecipes.length > 0 && !bakedRecipes.some(r => sameBakeRecipe(r.stamp, stamp));
  useEffect(() => { if (tick) { const timer = setTimeout(() => ref.current?.focus(), 30); return () => clearTimeout(timer); } }, [tick]);
  const eligible = !nineSliceProblem(stamp);
  return <PropRow label={t("smartStamp.nineSlice")}>
    <Tooltip label={t("smartStamp.hint")}><span className="flex items-center gap-2">
      <Toggle ref={ref} label={t("smartStamp.nineSlice")} data-nine-slice="" checked={!!stamp.nineSlice} disabled={!eligible} onChange={on => on ? useSmartStampDialog.getState().open(stamp.id) : disableSmartStamp(stamp.id)} />
      {needsBake && eligible && <Button size="sm" variant="ghost" onClick={() => useSmartStampDialog.getState().open(stamp.id)}>{t("smartStamp.rebuild")}</Button>}
    </span></Tooltip>
  </PropRow>;
}
