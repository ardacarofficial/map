import type { ReactNode } from "react";

import { formatNumber, t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { useStructureVersion } from "../hooks";

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5">
      <span className="text-faint">{label}</span>
      <span className="font-mono text-muted tabular">{children}</span>
    </div>
  );
}

export function StatusBar() {
  const project = useEditorStore((s) => s.project);
  const hover = useEditorStore((s) => s.hoverCell);
  const zoom = useEditorStore((s) => s.zoom);
  const tool = useEditorStore((s) => s.tool);
  useStructureVersion(project?.store);
  const map = project?.store.document.map;

  return (
    <footer className="flex h-statusbar items-center border-t border-line bg-panel px-1 text-xs [&>*+*]:border-l [&>*+*]:border-line-subtle">
      <Item label={t("status.cell")}>
        <span className="inline-block min-w-[9ch]">{hover ? `${hover.x}, ${hover.y}` : t("status.noCell")}</span>
      </Item>
      <Item label={t("status.zoom")}>
        <span className="inline-block min-w-[5ch]">{formatNumber(Math.round(zoom * 100))}%</span>
      </Item>
      {map && (
        <Item label={t("status.map")}>
          {t("common.cells", { width: map.width, height: map.height })}
          <span className="text-faint"> · {t("common.px", { value: map.tileWidth })}</span>
        </Item>
      )}
      <div className="flex items-center gap-1.5 px-2.5">
        <span className="text-faint">{t("status.tool")}</span>
        <span className="text-muted">{t(`tools.${tool}`)}</span>
      </div>
    </footer>
  );
}
