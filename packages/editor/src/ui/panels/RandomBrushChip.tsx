import type { MapDocument } from "@smap/core";

import { clearRandomSet, MAX_WEIGHT, MIN_WEIGHT, randomChances, removeRandomTile, setRandomWeight } from "../../commands/randomBrush";
import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { Icon } from "../primitives/Icon";
import { TileSwatch } from "../primitives/TileSwatch";

/** Özellik while the brush is random: its tiles with weights (+/-), remove, clear. */
export function RandomBrushChip({ doc }: { doc: MapDocument }) {
  const set = useEditorStore((s) => s.randomSet);
  const chances = randomChances(set);
  return (
    <div className="mx-3 mb-3 flex flex-col gap-1.5 rounded-lg border border-accent-line bg-accent-soft p-1.5" data-random-brush>
      <div className="flex items-center gap-1.5 pl-1">
        <Icon name="dice" size={14} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{t("random.chip", { count: set.length })}</span>
        <button
          type="button"
          onClick={clearRandomSet}
          className="h-6 shrink-0 rounded-sm px-1.5 text-xs text-muted transition-colors hover:bg-hover hover:text-text"
        >
          {t("random.clear")}
        </button>
      </div>
      <ul className="flex max-h-[148px] flex-col gap-0.5 overflow-y-auto">
        {set.map((tile, i) => {
          const tileset = doc.getTileset(tile.tilesetId);
          const weight = tile.weight ?? 1;
          return (
            <li key={`${tile.tilesetId}:${tile.tileId}`} className="group flex h-7 items-center gap-2 rounded-md bg-panel/60 pr-1 pl-1">
              {tileset ? (
                <TileSwatch tileset={tileset} tileId={tile.tileId} size={20} className="rounded-xs" />
              ) : (
                <span className="size-5 rounded-xs bg-line" />
              )}
              <span className="min-w-0 flex-1 truncate text-2xs text-faint">
                <span className="font-mono tabular">#{tile.tileId}</span>
                {doc.tilesets.length > 1 && <span className="ml-1.5">{tileset?.name ?? tile.tilesetId}</span>}
              </span>
              <span className="w-9 shrink-0 text-right font-mono text-xs text-muted tabular">{t("random.chance", { percent: chances[i] ?? 0 })}</span>
              <span className="flex shrink-0 items-center rounded-sm border border-line">
                <StepButton icon="minus" label={t("random.dec")} disabled={weight <= MIN_WEIGHT} onClick={() => setRandomWeight(tile, -1)} />
                <span className="w-4 text-center font-mono text-xs text-text tabular" aria-label={`${weight}`}>
                  {weight}
                </span>
                <StepButton icon="plus" label={t("random.inc")} disabled={weight >= MAX_WEIGHT} onClick={() => setRandomWeight(tile, 1)} />
              </span>
              <button
                type="button"
                aria-label={t("random.remove")}
                title={t("random.remove")}
                onClick={() => removeRandomTile(tile)}
                className="grid size-5 shrink-0 place-items-center rounded-sm text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:bg-hover hover:text-text focus-visible:opacity-100"
              >
                <Icon name="x" size={12} />
              </button>
            </li>
          );
        })}
      </ul>
      <span className="px-1 text-2xs leading-[14px] text-faint">{t("random.hint")}</span>
    </div>
  );
}

function StepButton({ icon, label, disabled, onClick }: { icon: "plus" | "minus"; label: string; disabled: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-5 place-items-center text-muted transition-colors hover:text-text disabled:opacity-30"
    >
      <Icon name={icon} size={11} strokeWidth={2.25} />
    </button>
  );
}
