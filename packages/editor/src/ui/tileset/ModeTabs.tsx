import { t, type MessageKey } from "../../i18n";
import { Icon, type IconName } from "../primitives/Icon";
import type { TilesetMode } from "../uiStore";

const MODES: readonly { mode: TilesetMode; icon: IconName; label: MessageKey; title: MessageKey }[] = [
  { mode: "pick", icon: "select", label: "tilesetPanel.modeSelect", title: "tilesetPanel.modeSelectTitle" },
  { mode: "solid", icon: "bricks", label: "tilesetPanel.modeSolid", title: "tilesetPanel.modeSolidTitle" },
  { mode: "terrain", icon: "terrain", label: "tilesetPanel.modeTerrain", title: "tilesetPanel.modeTerrainTitle" },
  { mode: "random", icon: "dice", label: "tilesetPanel.modeRandom", title: "tilesetPanel.modeRandomTitle" },
];

const TONE: Record<TilesetMode, string> = {
  pick: "text-accent",
  solid: "text-collision-solid",
  terrain: "text-terrain-tint",
  random: "text-accent",
};

/** Labelled segmented control: what a click in the tileset does. */
export function ModeTabs({ mode, onChange }: { mode: TilesetMode; onChange(mode: TilesetMode): void }) {
  return (
    <div role="radiogroup" aria-label={t("tilesetPanel.modes")} className="mx-2 mb-1.5 flex shrink-0 gap-0.5 rounded-md bg-raised p-0.5" data-tileset-modes>
      {MODES.map((m) => {
        const on = m.mode === mode;
        return (
          <button
            key={m.mode}
            type="button"
            role="radio"
            aria-checked={on}
            title={t(m.title)}
            data-tileset-mode={m.mode}
            onClick={() => onChange(m.mode)}
            className={`flex h-6 min-w-0 flex-auto items-center justify-center gap-1 rounded-sm px-1.5 text-xs font-medium transition-colors ${
              on ? "bg-active text-text shadow-[inset_0_0_0_1px_var(--color-line)]" : "text-faint hover:bg-hover hover:text-muted"
            }`}
          >
            <Icon name={m.icon} size={13} className={`shrink-0 ${on ? TONE[m.mode] : ""}`} />
            <span className="truncate">{t(m.label)}</span>
          </button>
        );
      })}
    </div>
  );
}
