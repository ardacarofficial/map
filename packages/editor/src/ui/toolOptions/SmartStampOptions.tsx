import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { activeSmartStamp, useSmartStampSession } from "../stamps/smartStampSession";
import { autoBrush, brushDisabled, brushPending, setBrushSmartEnabled } from "../../commands/smartBrushActions";
import { Segmented } from "../primitives/Segmented";
import { Toggle } from "../primitives/Toggle";
import { Tooltip } from "../primitives/Tooltip";
import { OptionLabel } from "./parts";
export function SmartStampOptions() {
  const clip=useEditorStore(s=>s.stamp),tool=useEditorStore(s=>s.tool);
  const {usage,setUsage}=useSmartStampSession(),stamp=activeSmartStamp();
  const enabled=!brushDisabled(clip),border=stamp?.nineSlice?.border ?? autoBrush(clip)?.source.nineSlice?.border ?? 1;
  return <div className="flex shrink-0 items-center gap-2" data-smart-stamp-mode={usage}>
    <Tooltip label={border>1?t("smartBrush.bandHint",{border}):t("smartBrush.hint")}><span className="flex items-center gap-2">
      <OptionLabel>{t("smartBrush.label")}</OptionLabel>
      <Toggle label={t("smartBrush.label")} data-smart-brush="" data-nine-slice="" checked={enabled} onChange={setBrushSmartEnabled} />
    </span></Tooltip>
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
