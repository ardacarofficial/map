import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { Segmented } from "../primitives/Segmented";
import { OptionLabel } from "./parts";

export function SelectionModeOptions() {
  const mode = useEditorStore(s => s.selectionMode);
  return <Segmented data-tool-option="selection-mode" value={mode} onValueChange={v => useEditorStore.getState().setSelectionMode(v)} label={t("connectedSelection.mode")} items={[
    { value: "rectangle", label: t("connectedSelection.rectangle") },
    { value: "connected", label: t("connectedSelection.connected"), tooltip: t("connectedSelection.hint") },
  ]} />;
}
export function LayerPickOptions() {
  const scope = useEditorStore(s => s.pickScope);
  return <div className="flex shrink-0 items-center gap-2" data-tool-option="pick-scope">
    <OptionLabel>{t("layerPick.layer")}</OptionLabel>
    <Segmented value={scope} onValueChange={v => useEditorStore.getState().setPickScope(v)} label={t("layerPick.layer")} items={[
      { value: "active", label: t("layerPick.active"), tooltip: t("layerPick.hint") },
      { value: "all", label: t("layerPick.all"), tooltip: t("layerPick.hint") },
    ]} />
  </div>;
}
