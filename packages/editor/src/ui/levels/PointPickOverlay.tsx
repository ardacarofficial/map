import { useEffect } from "react";

import { cancelPointPick, finishPointPick, useLevelUi } from "../../commands/levelActions";
import { t } from "../../i18n";
import { useProjectLibrary } from "../../io/projectLibrary";
import { useEditorStore } from "../../state/editorStore";
import { CANVAS_HOST_ATTR } from "../canvas/canvasHandle";
import { Button } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { toast } from "../toast/toastStore";

/**
 * Portal target point picking (v1.1): while active, a banner sits on top of
 * the canvas, a left click on a cell of the target level chooses the point
 * and Esc (or "Vazgeç") cancels. Panning and zooming keep working; the click
 * is taken before the canvas tools see it.
 */
export function PointPickOverlay() {
  const pick = useLevelUi((s) => s.pick);
  const levelName = useProjectLibrary((s) => s.levels.find((l) => l.id === pick?.targetLevelId)?.name ?? "");
  const hover = useEditorStore((s) => (pick ? s.hoverCell : null));

  useEffect(() => {
    if (!pick) return;
    const host = document.querySelector<HTMLElement>(`[${CANVAS_HOST_ATTR}]`);
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      // Capture phase on the host: the canvas never starts a tool gesture.
      event.preventDefault();
      event.stopPropagation();
      // The hovered cell is updated on the canvas's next frame; a click right
      // after entering the canvas waits for it.
      const take = (retries: number) => {
        const cell = useEditorStore.getState().hoverCell;
        if (cell) void finishPointPick(cell);
        else if (retries > 0) requestAnimationFrame(() => take(retries - 1));
        else toast.warning(t("levels.pickOutside"));
      };
      take(3);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      void cancelPointPick();
    };
    host?.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    if (host) host.style.cursor = "crosshair";
    return () => {
      host?.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      if (host) host.style.cursor = "";
    };
  }, [pick]);

  if (!pick) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-4" data-point-pick="">
      <div
        role="status"
        className="pointer-events-auto flex items-center gap-3 rounded-lg border border-accent-line bg-raised py-1.5 pr-1.5 pl-3 text-md text-text shadow-popup"
      >
        <Icon name="crosshair" size={15} className="shrink-0 text-accent" />
        <span>{t("levels.pickBanner", { level: levelName })}</span>
        <span className="w-16 font-mono text-xs text-faint tabular">{hover ? `${hover.x}, ${hover.y}` : "—"}</span>
        <Button variant="ghost" className="h-7 px-2" onClick={() => void cancelPointPick()}>
          {t("levels.pickCancel")}
          <kbd className="font-mono text-2xs text-faint">Esc</kbd>
        </Button>
      </div>
    </div>
  );
}
