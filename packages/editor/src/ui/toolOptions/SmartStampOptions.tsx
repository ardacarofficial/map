import { useSmartStampDialog } from "../../commands/smartStampCommands";
import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { activeSmartStamp, useSmartStampSession } from "../stamps/smartStampSession";
import { Segmented } from "../primitives/Segmented";
import { OptionLabel } from "./parts";
export function SmartStampOptions() {
  useEditorStore(s => s.stamp);
  const { usage, setUsage } = useSmartStampSession();
  const stamp = activeSmartStamp();
  return <div className="flex shrink-0 items-center gap-2" data-smart-stamp-mode={usage}>
    <OptionLabel>{t("smartStamp.usage")}</OptionLabel>
    <Segmented label={t("smartStamp.usage")} value={usage} onValueChange={value => { if (value === "road" && !stamp?.nineSlice?.road) { if (stamp) useSmartStampDialog.getState().chooseRoad(stamp.id); } else setUsage(value); }} items={[
      { value: "area", label: t("smartStamp.area") },
      { value: "road", label: t("smartStamp.road"), disabled: !stamp?.nineSlice?.tileLayers.length, ...(!stamp?.nineSlice?.road ? { tooltip: t("smartStamp.singleLayer") } : {}) },
    ]} />
  </div>;
}
