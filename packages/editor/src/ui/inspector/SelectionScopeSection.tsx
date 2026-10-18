import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { PropRow, PropValue } from "../primitives/PropRow";

export function SelectionScopeSection() {
  const scope = useEditorStore(s => s.selectionScope);
  return <PropRow label={t("selectionScope.label")} className="px-3" data-selection-scope-fact=""><PropValue>{t(scope === "active" ? "selectionScope.active" : "selectionScope.visible")}</PropValue></PropRow>;
}
