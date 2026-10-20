import { createPortal } from "react-dom";
import { t } from "../../../i18n";
import { Icon } from "../../primitives/Icon";
import { usePaletteStore } from "../../palettes/paletteStore";

export function TileDragGhost() {
  const drag = usePaletteStore((s) => s.drag);
  if (!drag) return null;
  const moving = drag.move && drag.source.kind === "palette";
  return createPortal(
    <div
      aria-hidden
      data-tile-drag-ghost
      className={`pointer-events-none fixed z-(--overlay-popover) flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs font-medium ${
        drag.target ? "border-accent-line bg-accent-soft text-text" : "border-line-strong bg-popup text-muted"
      }`}
      style={{ left: drag.x + 14, top: drag.y + 12 }}
    >
      <Icon name={moving ? "arrowDown" : "copy"} size={16} />
      {t(moving ? "palettes.ghostMove" : "palettes.ghostCopy", { count: drag.items.length })}
    </div>,
    document.body,
  );
}

