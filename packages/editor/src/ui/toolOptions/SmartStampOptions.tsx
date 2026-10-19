import { emptyMap, remedyBrushGrid } from "../../commands/smartBrushGrid";
import { Button } from "../primitives/Button";
import { formatSmartBrushError } from "../../commands/smartBrushErrors";
import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { activeSmartStamp, useSmartStampSession } from "../stamps/smartStampSession";
import { autoBrush, brushCanEnable, brushDisabled, brushPending, brushSource, brushUnavailable, brushPreparationState, setBrushSmartEnabled } from "../../commands/smartBrushActions";
import { Segmented } from "../primitives/Segmented";
import { Toggle } from "../primitives/Toggle";
import { Tooltip } from "../primitives/Tooltip";
import { OptionLabel } from "./parts";
export function SmartStampOptions() {
  const clip=useEditorStore(s=>s.stamp),tool=useEditorStore(s=>s.tool);
  const {usage,setUsage}=useSmartStampSession(),stamp=activeSmartStamp();
  const enabled=!brushDisabled(clip),border=stamp?.nineSlice?.border ?? autoBrush(clip)?.source.nineSlice?.border ?? 1;
  const source=brushSource(clip),store=useEditorStore.getState().project?.store,failure=brushUnavailable(clip),object=!autoBrush(clip)&&!(clip as {nineSlice?:unknown}|null)?.nineSlice;
  const canEnable=brushCanEnable(clip);
  const reason=failure?.code==="gridMismatch"&&source&&store?t("smartStamp.gridReason",{sourceW:source.tileWidth,sourceH:source.tileHeight,mapW:store.document.map.tileWidth,mapH:store.document.map.tileHeight}):failure?formatSmartBrushError(failure):object?t(canEnable?"smartStamp.forceHint":"smartStamp.bandRequired"):null;
  return <div className="flex shrink-0 items-center gap-2" data-smart-stamp-mode={usage} data-smart-brush-state={brushPreparationState(clip).status}>
    <Tooltip label={reason??(border>1?t("smartBrush.bandHint",{border}):t("smartBrush.hint"))}><span className="flex items-center gap-2">
      <OptionLabel>{t("smartBrush.label")}</OptionLabel>
      <Toggle label={t("smartBrush.label")} data-smart-brush="" data-nine-slice="" disabled={(!!failure&&autoBrush(clip)?.state.status!=="failed")||!canEnable} aria-description={reason??undefined} checked={enabled&&!object} onChange={setBrushSmartEnabled} />
    </span></Tooltip>
    {reason&&<span className="text-sm text-muted" data-smart-brush-reason="">{object&&!failure&&canEnable?t("smartStamp.object"):reason}</span>}
    {failure?.code==="gridMismatch"&&source&&store&&<Button size="sm" variant="secondary" data-smart-grid-remedy="" onClick={remedyBrushGrid}>{t(emptyMap(store)?"smartStamp.adoptGrid":"smartStamp.newGridMap",{size:source.tileWidth})}</Button>}
    {brushPending()&&<span className="text-sm text-muted">{t(autoBrush(clip)?.failed ? "smartBrush.failed" : "smartBrush.preparing")}</span>}
    {enabled&&stamp&&tool!=="fill"&&<>
      <OptionLabel>{t("smartStamp.usage")}</OptionLabel>
      <Segmented label={t("smartStamp.usage")} value={usage} onValueChange={setUsage} items={[
        {value:"area",label:t("smartStamp.area")},
        {value:"road",label:t("smartStamp.road"),disabled:!stamp.nineSlice?.road,...(!stamp.nineSlice?.road?{tooltip:t("smartStamp.singleLayer")}:{})},
      ]}/>
    </>}
  </div>;
}
