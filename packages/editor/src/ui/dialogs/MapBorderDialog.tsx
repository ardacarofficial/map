import { Dialog } from "../primitives/Overlays";
import { BORDER_SIDES, type BorderGap } from "@smap/core";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { borderPlan, closeMapBorder, commitMapBorder, updateMapBorder, useMapBorder, type BorderDraft } from "../../commands/mapBorder";
import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { useSmartStampSession } from "../stamps/smartStampSession";
import { Button, IconButton } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { NativeSelect } from "../primitives/NativeSelect";
import { TextField } from "../primitives/TextField";
import { DialogBody, DialogFooter, DialogHeader, DialogToggle, FormField, dialogLayoutClass } from "./DialogFrame";
import { backdropClass, dialogWidthM, popupClass } from "./styles";

export function MapBorderDialog() {
  const draft = useMapBorder(s => s.draft);
  const store = useEditorStore(s => s.project?.store);
  useEffect(() => { if (draft && store !== draft.store) closeMapBorder(); }, [draft, store]);
  if (!draft || store !== draft.store) return null;
  return <Dialog.Root open onOpenChange={open => { if (!open) closeMapBorder(); }}>
    <Dialog.Portal><Dialog.Backdrop className={backdropClass} />
      <Dialog.Popup className={`${popupClass} ${dialogWidthM} ${dialogLayoutClass}`} data-map-border-dialog>
        <BorderForm draft={draft} />
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>;
}
function BorderForm({ draft }: { draft: BorderDraft }) {
  useEditorStore(s => s.activeLayerId);
  useEditorStore(s => s.selection);
  useEditorStore(s => s.stamp);
  useEditorStore(s => s.randomSet);
  useSmartStampSession(s => s.orientation);
  useSmartStampSession(s => s.version);
  const subscribe = useCallback((notify: () => void) => draft.store.subscribe(notify), [draft.store]);
  useSyncExternalStore(subscribe, () => draft.store.revision);
  const plan = borderPlan(draft);
  const gaps = draft.gaps ?? [];
  const setGap = (index: number, patch: Partial<BorderGap>) => updateMapBorder({ gaps: gaps.map((gap, i) => i === index ? { ...gap, ...patch } : gap) });
  return <form className="flex min-h-0 flex-col" onSubmit={e => { e.preventDefault(); commitMapBorder(); }}>
    <DialogHeader title={t("mapBorder.title")} onClose={closeMapBorder} />
    <DialogBody className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t("mapBorder.thickness")}><BorderNumber label={t("mapBorder.thickness")} value={draft.thickness} min={1} onChange={thickness => updateMapBorder({ thickness })} /></FormField>
        <FormField label={t("mapBorder.inset")}><BorderNumber label={t("mapBorder.inset")} value={draft.inset} min={0} onChange={inset => updateMapBorder({ inset })} /></FormField>
      </div>
      <fieldset className="flex flex-wrap gap-3"><legend className="mb-2 text-sm text-muted">{t("mapBorder.sides")}</legend>
        {BORDER_SIDES.map(side => <div key={side} className="flex items-center gap-2 text-sm text-text">
          <DialogToggle label={t(`mapBorder.${side}`)} checked={draft.sides?.[side] !== false} onChange={on => updateMapBorder({ sides: { ...draft.sides, [side]: on } })} /><span>{t(`mapBorder.${side}`)}</span>
        </div>)}
      </fieldset>
      <section className="flex flex-col gap-2 border-t border-line-subtle pt-3" title={t("mapBorder.gapHint")}>
        <div className="flex items-center justify-between"><h3 className="text-sm font-medium text-text">{t("mapBorder.gaps")}</h3><Button onClick={() => updateMapBorder({ gaps: [...gaps, { side: "top", start: 0, length: 1 }] })}><Icon name="plus" size={16} />{t("mapBorder.addGap")}</Button></div>
        {gaps.map((gap, index) => <div key={index} data-border-gap={index} className="flex items-end gap-2">
          <FormField label={t("mapBorder.side")}><NativeSelect aria-label={t("mapBorder.side")} value={gap.side} onChange={e => setGap(index, { side: e.target.value as BorderGap["side"] })}>{BORDER_SIDES.map(side => <option key={side} value={side}>{t(`mapBorder.${side}`)}</option>)}</NativeSelect></FormField>
          <FormField label={t("mapBorder.start")}><BorderNumber label={t("mapBorder.start")} min={0} value={gap.start} onChange={start => setGap(index, { start })} /></FormField>
          <FormField label={t("mapBorder.length")}><BorderNumber label={t("mapBorder.length")} min={1} value={gap.length} onChange={length => setGap(index, { length })} /></FormField>
          <IconButton size="md" aria-label={t("mapBorder.removeGap")} onClick={() => updateMapBorder({ gaps: gaps.filter((_, i) => i !== index) })}><Icon name="trash" size={16} /></IconButton>
        </div>)}
      </section>
      <p className="text-sm text-muted" role="status" data-border-status>{plan.reason ? t(plan.reason) : plan.band.clamped ? t("mapBorder.clamped", { thickness: plan.band.thickness, inset: plan.band.inset }) : t("mapBorder.count", { count: plan.cells.length })}</p>
    </DialogBody>
    <DialogFooter><Button size="md" onClick={closeMapBorder}>{t("common.cancel")}</Button><Button size="md" type="submit" variant="primary" disabled={!!plan.reason || !plan.cells.length}>{t("mapBorder.apply")}</Button></DialogFooter>
  </form>;
}
function BorderNumber({ label, value, min, onChange }: { label: string; value: number; min: number; onChange(value: number): void }) {
  return <TextField size="md" type="number" aria-label={label} title={`${label} (${t("newProject.cellsUnit")})`} value={Number.isFinite(value) ? value : ""} min={min} step={1} aria-invalid={!Number.isSafeInteger(value) || value < min || undefined} onChange={e => onChange(e.target.value === "" ? NaN : Number(e.target.value))} />;
}
