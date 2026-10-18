/**
 * Random brush extras for the inspector's brush card (round 4): saved
 * sets (load / save / save as / rename / delete), stamp candidates with
 * weights, scatter % and random flip. The card itself shows the tile
 * candidates (weights); the options-bar "Rastgele" toggle makes the brush
 * random (`makeRandomFromStamp`).
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
import { Button, IconButton } from "../primitives/Button";
import { NativeSelect } from "../primitives/NativeSelect";
import { Icon } from "../primitives/Icon";
import { menuItemClass, menuPopupClass, menuPositionerClass, menuSeparatorClass } from "../primitives/menuStyles";
import { PropRow, PropField } from "../primitives/PropRow";
import { Toggle } from "../primitives/Toggle";
import { askText } from "./TextPrompt";

/** Saved random sets as a dropdown ("Kayıtlı setler ▾"): pick = load into the brush. Usable with no random brush active. */
export function RandomSetPicker({ compact = false }: { compact?: boolean }) {
  const store = useEditorStore((s) => s.project?.store);
  useStructureVersion(store);
  const activeSetId = useRandomBrush((s) => s.activeSetId);
  const sets = store?.document.randomSets ?? [];
  const current = activeSetId ? sets.find((s) => s.id === activeSetId) : undefined;
  return (
    <Menu.Root>
      <Menu.Trigger render={<Button size="sm" data-random-set-picker className={`min-w-0 ${compact ? "max-w-40" : "flex-1"}`}>
        <Icon name="dices" size={16} className="text-muted" />
        <span className="min-w-0 flex-1 truncate text-left">{current?.name ?? (sets.length ? t("randomSets.saved") : t("randomSets.none"))}</span>
        <Icon name="chevron-down" size={12} />
      </Button>} />
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={4} className={menuPositionerClass}>
          <Menu.Popup className={`${menuPopupClass} max-h-(--available-height) w-(--anchor-width) min-w-48 overflow-y-auto`}>
            {sets.length === 0 && <div className="px-2 py-1 text-sm text-muted">{t("randomSets.none")}</div>}
            {sets.map((s) => (
              <Menu.Item key={s.id} className={menuItemClass} data-random-set-option={s.id} onClick={() => loadRandomSet(s.id)}>
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <span className="text-xs text-muted tabular">{s.candidates.length}</span>
                {s.id === activeSetId && <Icon name="tick" size={12} className="text-muted" />}
              </Menu.Item>
            ))}
            {current && (
              <>
                <div role="separator" className={menuSeparatorClass} />
                <Menu.Item
                  className={menuItemClass}
                  onClick={() =>
                    void askText({ title: t("randomSets.rename"), label: t("randomSets.saveName"), initial: current.name, confirm: t("randomSets.confirmRename") }).then(
                      (name) => name && renameRandomSet(current.id, name),
                    )
                  }
                >
                  <Icon name="pencilLine" size={16} className="text-muted" />
                  {t("randomSets.rename")}
                </Menu.Item>
                <Menu.Item className={`${menuItemClass} text-danger`} onClick={() => deleteRandomSet(current.id)}>
                  <Icon name="trash" size={16} />
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
        <Button size="sm"
          data-random-set-save
          title={activeSetId ? t("randomSets.save") : t("randomSets.saveAs")}
          onClick={() => (activeSetId ? saveRandomSet() : void saveRandomSetAs())}
        >
          {t("randomSets.save")}
        </Button>
        {activeSetId && (
          <IconButton size="sm"
            aria-label={t("randomSets.saveAs")}
            title={t("randomSets.saveAs")}
            onClick={() => void saveRandomSetAs()}
          >
            <Icon name="plus" size={16} />
          </IconButton>
        )}
      </div>
      {stamps.length > 0 && (
        <div className="flex flex-col gap-0.5" data-random-stamps>
          <span className="flex h-control-md items-center text-xs font-semibold tracking-section text-muted uppercase">{t("randomSets.stamps")}</span>
          {stamps.map((c) => {
            const stamp = library.find((s) => s.id === c.stampId);
            const weight = c.weight ?? 1;
            return (
              <div key={c.stampId} className="group rounded-sm px-1">
                <PropRow label={<span className="flex items-center gap-2" title={stamp?.name ?? c.stampId}><Icon name="stamp" size={16} className={stamp ? "shrink-0 text-muted" : "shrink-0 text-danger"} /><span className="truncate">{stamp?.name ?? c.stampId}</span></span>}>
                  <PropField value={weight} aria-label={t("random.weight")} min={MIN_WEIGHT} max={MAX_WEIGHT} scrub onCommit={(next) => setRandomStampWeight(c.stampId, Math.round(next) - weight)} />
                  <IconButton size="sm" aria-label={t("random.remove")} onClick={() => removeRandomStamp(c.stampId)} className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                    <Icon name="x" size={12} />
                  </IconButton>
                </PropRow>
              </div>
            );
          })}
        </div>
      )}
      <label className="flex h-control-md items-center gap-2 text-sm text-muted" title={t("randomSets.scatterTitle")}>
        <span className="w-proplabel shrink-0">{t("randomSets.scatter")}</span>
        <NativeSelect size="sm" aria-label={t("randomSets.scatter")} value={Math.round(scatter * 100)} onChange={(e) => setRandomScatter(Number(e.target.value))} data-random-scatter className="flex-1">
          {Array.from({ length: 20 }, (_, i) => i * 5).map(percent => <option key={percent} value={percent}>{t("layers.percent", { value: percent })}</option>)}
        </NativeSelect>
      </label>
      <div className="flex h-control-md items-center gap-2 text-sm text-text" title={t("randomSets.flipTitle")}>
        <Toggle checked={randomFlip} onChange={setRandomFlip} label={t("randomSets.flip")} />
        <span className="min-w-0 truncate">{t("randomSets.flip")}</span>
      </div>
    </div>
  );
}
