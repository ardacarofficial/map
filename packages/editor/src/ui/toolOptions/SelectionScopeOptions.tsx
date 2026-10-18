import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { Segmented } from "../primitives/Segmented";
import { OptionLabel } from "./parts";

export function SelectionScopeOptions() {
  const scope = useEditorStore(s => s.selectionScope);
  return <div className="flex shrink-0 items-center gap-2" data-tool-option="selection-scope">
    <OptionLabel>{t("selectionScope.label")}</OptionLabel>
    <Segmented value={scope} onValueChange={value => useEditorStore.getState().setSelectionScope(value)} label={t("selectionScope.label")} items={[
      { value: "active", label: t("selectionScope.active"), tooltip: t("selectionScope.hint") },
      { value: "visible", label: t("selectionScope.visible"), tooltip: t("selectionScope.hint") },
    ]} />
  </div>;
}
