import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { useStructureVersion } from "../hooks";
import { Icon } from "../primitives/Icon";
import { PanelSection } from "./PanelSection";

/** v0.1: the level's layer(s), read-only. Layer management arrives in v0.2. */
export function LayersPanel() {
  const store = useEditorStore((s) => s.project?.store);
  const activeId = useEditorStore((s) => s.activeLayerId);
  const setActive = useEditorStore((s) => s.setActiveLayer);
  useStructureVersion(store);
  const layers = [...(store?.document.layers ?? [])].reverse(); // top layer first

  return (
    <PanelSection title={t("panels.layers")} className="shrink-0">
      <ul className="flex flex-col gap-px px-1.5 pb-2">
        {layers.map((layer) => {
          const active = layer.id === activeId;
          return (
            <li key={layer.id}>
              <button
                type="button"
                onClick={() => setActive(layer.id)}
                aria-current={active || undefined}
                className={`flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-md transition-colors ${
                  active ? "bg-active text-text" : "text-muted hover:bg-hover hover:text-text"
                }`}
              >
                <Icon name="layers" size={14} className={active ? "text-accent" : "text-faint"} />
                <span className="min-w-0 flex-1 truncate">{layer.name}</span>
                <span title={t("layers.visible")} className="text-faint">
                  <Icon name="eye" size={14} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </PanelSection>
  );
}
