import { useIsRandomBrush } from "../../commands/randomBrush";
import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { useStructureVersion } from "../hooks";
import { Icon } from "../primitives/Icon";
import { Tooltip } from "../primitives/Tooltip";
import { RandomSetPicker } from "../tileset/RandomSetControls";
import { triggerClass } from "./parts";
import { canRandomizeClip, toggleRandomBrush } from "./randomBrush";

/** Random painting and its saved-set picker, shared by brush, fill and rectangle. */
export function RandomToggle() {
  const store = useEditorStore((s) => s.project?.store);
  const stamp = useEditorStore((s) => s.stamp);
  const random = useIsRandomBrush();
  useStructureVersion(store);
  const active = random && !stamp;
  const hasSavedSets = (store?.document.randomSets.length ?? 0) > 0;
  const disabled = !active && !canRandomizeClip(stamp) && !hasSavedSets;
  const hint = disabled ? t("toolOptions.randomDisabled") : active ? t("toolOptions.randomRestore") : t("toolOptions.randomHint");
  const button = (
    <button
      type="button"
      className={`${triggerClass} shrink-0 aria-pressed:bg-active aria-pressed:text-title disabled:pointer-events-none disabled:opacity-40`}
      aria-pressed={active}
      disabled={disabled}
      data-action="makeRandom"
      data-tool-option="random"
      onClick={toggleRandomBrush}
    >
      <Icon name="dices" size={16} />
      {t("toolOptions.random")}
    </button>
  );
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Tooltip label={hint}>
        {disabled ? <span className="inline-flex" tabIndex={0}>{button}</span> : button}
      </Tooltip>
      {active && hasSavedSets && <RandomSetPicker compact />}
    </div>
  );
}
