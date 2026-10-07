import type { CanvasView } from "../../canvas/mapCanvas";
import { setCanvasView, useWorldView } from "../../commands/worldActions";
import { t } from "../../i18n";
import { Icon, type IconName } from "../primitives/Icon";
import { Tooltip } from "../primitives/Tooltip";

const OPTIONS: { view: CanvasView; icon: IconName; label: "world.level" | "world.world" }[] = [
  { view: "level", icon: "map", label: "world.level" },
  { view: "world", icon: "globe", label: "world.world" },
];

/** "Harita | Dünya": the canvas' two views (v1.2), a segmented control in the toolbar. */
export function ViewToggle() {
  const view = useWorldView((s) => s.view);
  return (
    <div role="group" aria-label={t("world.toggle")} className="flex h-7 items-center rounded-md border border-line bg-raised p-0.5">
      {OPTIONS.map((option) => {
        const selected = view === option.view;
        return (
          <Tooltip key={option.view} label={t("commands.view.world")} command="view.world">
            <button
              type="button"
              aria-pressed={selected}
              data-view={option.view}
              onClick={() => setCanvasView(option.view)}
              className={`flex h-full items-center gap-1.5 rounded-sm px-2 text-sm transition-colors duration-100 ${
                selected ? "bg-active text-text shadow-[inset_0_0_0_1px_var(--color-line-strong)]" : "text-faint hover:text-muted"
              }`}
            >
              <Icon name={option.icon} size={14} className={selected ? "text-accent" : ""} />
              {t(option.label)}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
