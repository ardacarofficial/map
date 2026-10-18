import type { ReactNode } from "react";
import { DockZone } from "./DockZone";

export interface SectionPanelProps {
  collapsed: boolean;
  onToggleCollapsed(): void;
  extra?: ReactNode;
}
/** Compatibility host; the registry owns the panel list. */
export function RightColumn({ width, visible }: { width: number; visible: boolean }) {
  return <DockZone zone="right" size={width} temporaryHidden={!visible} />;
}
