/**
 * Random brush extras for the inspector's brush card (round 4): saved
 * sets (load / save / save as / rename / delete), stamp candidates with
 * weights, scatter % and random flip. The card itself shows the tile
 * candidates (weights) and the "Rastgele yap" button
 * (`makeRandomFromStamp`).
 */
import { Menu } from "@base-ui/react/menu";

import {
  deleteRandomSet,
  loadRandomSet,
  MAX_WEIGHT,
  MIN_WEIGHT,
  removeRandomStamp,
  renameRandomSet,
  saveRandomSet,
  saveRandomSetAs,
  setRandomFlip,
  setRandomScatter,
  setRandomStampWeight,
  useRandomBrush,
} from "../../commands/randomBrush";
import { t } from "../../i18n";
import { useProjectLibrary } from "../../io/projectLibrary";
import { useEditorStore } from "../../state/editorStore";
import { useStructureVersion } from "../hooks";
import { Icon } from "../primitives/Icon";
import { menuItemClass, menuPopupClass, menuPositionerClass, menuSeparatorClass } from "../primitives/menuStyles";
import { Toggle } from "../primitives/Toggle";
import { askText } from "./TextPrompt";

/** Saved random sets as a dropdown ("Kayıtlı setler ▾"): pick = load into the brush. Usable with no random brush active. */
export function RandomSetPicker() {
  const store = useEditorStore((s) => s.project?.store);
  useStructureVersion(store);
  const activeSetId = useRandomBrush((s) => s.activeSetId);
  const sets = store?.document.randomSets ?? [];
  const current = activeSetId ? sets.find((s) => s.id === activeSetId) : undefined;
  return (
    <Menu.Root>
      <Menu.Trigger
        data-random-set-picker
        className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-line bg-raised px-2 text-left text-sm transition-colors hover:border-line-strong data-popup-open:border-line-strong"
      >
        <Icon name="dice" size={13} className="shrink-0 text-accent" />
        <span className={`min-w-0 flex-1 truncate ${current ? "text-text" : "text-faint"}`}>{current?.name ?? (sets.length ? t("randomSets.saved") : t("randomSets.none"))}</span>
        <Icon name="chevronDown" size={13} className="shrink-0 text-faint" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={4} className={menuPositionerClass}>
          <Menu.Popup className={`${menuPopupClass} max-h-[min(360px,var(--available-height))] w-(--anchor-width) min-w-[200px] overflow-y-auto`}>
            {sets.length === 0 && <div className="px-2 py-1.5 text-xs text-faint">{t("randomSets.none")}</div>}
            {sets.map((s) => (
              <Menu.Item key={s.id} className={menuItemClass} data-random-set-option={s.id} onClick={() => loadRandomSet(s.id)}>
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <span className="font-mono text-2xs text-faint tabular">{s.candidates.length}</span>
                {s.id === activeSetId && <Icon name="check" size={14} className="text-accent" />}
              </Menu.Item>
            ))}
            {current && (
              <>
                <div role="separator" className={menuSeparatorClass} />
                <Menu.Item
                  className={menuItemClass}
                  onClick={() =>
                    void askText({ title: t("randomSets.rename"), label: t("randomSets.saveName"), initial: current.name, confirm: t("palettes.rename") }).then(
                      (name) => name && renameRandomSet(current.id, name),
                    )
                  }
                >
                  <Icon name="pencilLine" size={15} className="text-muted" />
                  {t("randomSets.rename")}
                </Menu.Item>
                <Menu.Item className={`${menuItemClass} text-danger`} onClick={() => deleteRandomSet(current.id)}>
                  <Icon name="trash" size={15} />
                  {t("randomSets.delete")}
                </Menu.Item>
              </>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Saved set picker + save, stamp candidates, scatter, random flip (show while the brush is random). */
export function RandomSetControls() {
  const stamps = useRandomBrush((s) => s.stamps);
  const scatter = useRandomBrush((s) => s.scatter);
  const randomFlip = useRandomBrush((s) => s.randomFlip);
  const activeSetId = useRandomBrush((s) => s.activeSetId);
  const library = useProjectLibrary((s) => s.stamps);
  return (
    <div className="flex flex-col gap-2" data-random-set-controls>
      <div className="flex items-center gap-1">
        <RandomSetPicker />
        <button
          type="button"
          data-random-set-save
          title={activeSetId ? t("randomSets.save") : t("randomSets.saveAs")}
          onClick={() => (activeSetId ? saveRandomSet() : void saveRandomSetAs())}
          className="h-7 shrink-0 rounded-md border border-line px-2 text-xs text-muted transition-colors hover:border-line-strong hover:text-text"
        >
          {t("randomSets.save")}
        </button>
        {activeSetId && (
          <button
            type="button"
            aria-label={t("randomSets.saveAs")}
            title={t("randomSets.saveAs")}
            onClick={() => void saveRandomSetAs()}
            className="grid size-7 shrink-0 place-items-center rounded-md text-faint hover:bg-hover hover:text-text"
          >
            <Icon name="plus" size={13} />
          </button>
        )}
      </div>
      {stamps.length > 0 && (
        <div className="flex flex-col gap-0.5" data-random-stamps>
          <span className="text-2xs font-semibold tracking-[.06em] text-faint uppercase">{t("randomSets.stamps")}</span>
          {stamps.map((c) => {
            const stamp = library.find((s) => s.id === c.stampId);
            const weight = c.weight ?? 1;
            return (
              <div key={c.stampId} className="group flex h-7 items-center gap-2 rounded-md bg-panel/60 pr-1 pl-1.5">
                <Icon name="stamp" size={13} className={stamp ? "text-muted" : "text-danger"} />
                <span className="min-w-0 flex-1 truncate text-xs text-muted">{stamp?.name ?? c.stampId}</span>
                <span className="flex shrink-0 items-center rounded-sm border border-line">
                  <button type="button" aria-label={t("random.dec")} disabled={weight <= MIN_WEIGHT} onClick={() => setRandomStampWeight(c.stampId, -1)} className="grid size-5 place-items-center text-muted hover:text-text disabled:opacity-30">
                    <Icon name="minus" size={11} />
                  </button>
                  <span className="w-4 text-center font-mono text-xs text-text tabular">{weight}</span>
                  <button type="button" aria-label={t("random.inc")} disabled={weight >= MAX_WEIGHT} onClick={() => setRandomStampWeight(c.stampId, 1)} className="grid size-5 place-items-center text-muted hover:text-text disabled:opacity-30">
                    <Icon name="plus" size={11} />
                  </button>
                </span>
                <button type="button" aria-label={t("random.remove")} onClick={() => removeRandomStamp(c.stampId)} className="grid size-5 shrink-0 place-items-center rounded-sm text-faint hover:bg-hover hover:text-text">
                  <Icon name="x" size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <label className="flex items-center gap-2 text-xs text-muted" title={t("randomSets.scatterTitle")}>
        <span className="w-20 shrink-0">{t("randomSets.scatter")}</span>
        <input
          type="range"
          min={0}
          max={95}
          step={5}
          value={Math.round(scatter * 100)}
          onChange={(e) => setRandomScatter(Number(e.target.value))}
          data-random-scatter
          className="h-5 min-w-0 flex-1 accent-(--color-accent)"
        />
        <span className="w-9 shrink-0 text-right font-mono tabular">%{Math.round(scatter * 100)}</span>
      </label>
      <div className="flex items-center gap-2 text-xs text-muted" title={t("randomSets.flipTitle")}>
        <span className="flex-1">{t("randomSets.flip")}</span>
        <Toggle checked={randomFlip} onChange={setRandomFlip} label={t("randomSets.flip")} />
      </div>
    </div>
  );
}
