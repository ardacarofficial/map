import { nineSliceProblem, type Stamp } from "@smap/core";
import { useEffect, useRef } from "react";
import { disableSmartStamp, useSmartStampDialog } from "../../commands/smartStampCommands";
import { t } from "../../i18n";
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
  const needsBake = !stamp.nineSlice && doc?.tilesets.some(t => t.generated?.stampId === stamp.id);
  useEffect(() => { if (tick) { const timer = setTimeout(() => ref.current?.focus(), 30); return () => clearTimeout(timer); } }, [tick]);
  const eligible = !nineSliceProblem(stamp);
  return <PropRow label={t("smartStamp.nineSlice")}>
    <Tooltip label={t("smartStamp.hint")}><span className="flex items-center gap-2">
      <Toggle ref={ref} label={t("smartStamp.nineSlice")} data-nine-slice="" checked={!!stamp.nineSlice} disabled={!eligible} onChange={on => on ? useSmartStampDialog.getState().open(stamp.id) : disableSmartStamp(stamp.id)} />
      {!stamp.nineSlice && eligible && <Button size="sm" variant="ghost" onClick={() => useSmartStampDialog.getState().open(stamp.id)}>{t(needsBake ? "smartStamp.rebuild" : "smartStamp.nineSlice")}</Button>}
    </span></Tooltip>
  </PropRow>;
}
