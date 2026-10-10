import { t } from "../../i18n";
import { InspectorBody } from "../inspector/Inspector";
import type { SectionPanelProps } from "../layout/RightColumn";
import { PanelSection } from "./PanelSection";

/**
 * Denetçi (inspector) as a foldable right-column section. The content is
 * `InspectorBody` (ui/inspector): contextual cards — entity, marquee
 * region, brush, terrain, collision kind or the map. A tabbed host
 * (Denetçi | Geçmiş) can mount `InspectorBody` directly.
 */
export function PropertiesPanel({ collapsed = false, onToggleCollapsed, extra }: Partial<SectionPanelProps> = {}) {
  return (
    <PanelSection
      title={t("layout.inspector")}
      className="min-h-0 flex-auto"
      collapsed={collapsed}
      extra={extra}
      {...(onToggleCollapsed ? { onToggleCollapsed } : {})}
    >
      <InspectorBody />
    </PanelSection>
  );
}
