import { Dialog } from "@base-ui/react/dialog";
import { useCallback, useEffect, useSyncExternalStore } from "react";

import { beginReplacementPick, cancelReplacementPick, closeTileReplacement, commitTileReplacement, replacementPlan, updateTileReplacement, useTileReplacement, type ReplacementDraft } from "../../commands/replaceTiles";
import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { useUiStore } from "../uiStore";
import { useLayoutStore } from "../layout/layoutStore";
import { Button } from "../primitives/Button";
import { Segmented } from "../primitives/Segmented";
import { TileSwatch } from "../primitives/TileSwatch";
import { backdropClass, popupClass, dialogWidthM } from "./styles";
import { DialogBody, DialogFooter, DialogHeader, FormField, dialogLayoutClass } from "./DialogFrame";

export function ReplaceTilesDialog() {
  const draft = useTileReplacement(s => s.draft);
  const store = useEditorStore(s => s.project?.store);
  useEffect(() => {
    if (draft && store !== draft.store) closeTileReplacement();
  }, [draft, store]);
  useEffect(() => {
    if (!draft?.picking) return;
    const cancel = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); cancelReplacementPick(); }
    };
    window.addEventListener("keydown", cancel, true);
    return () => window.removeEventListener("keydown", cancel, true);
  }, [draft?.picking]);
  if (!draft || store !== draft.store) return null;
  if (draft.picking) return <div data-replace-picking="" role="status" className="fixed bottom-8 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-md border border-line-strong bg-popup px-3 py-2 text-sm text-text shadow-popup">
    {t("replaceTiles.picking", { target: t(draft.picking === "from" ? "replaceTiles.from" : "replaceTiles.to") })}
    <Button onClick={cancelReplacementPick}>{t("common.cancel")}</Button>
  </div>;
  return <Dialog.Root open onOpenChange={open => { if (!open) closeTileReplacement(); }}>
    <Dialog.Portal>
      <Dialog.Backdrop className={backdropClass} />
      <Dialog.Popup className={`${popupClass} ${dialogWidthM} ${dialogLayoutClass}`} data-testid="replace-tiles-dialog">
        <ReplacementForm draft={draft} />
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>;
}

function ReplacementForm({ draft }: { draft: ReplacementDraft }) {
  const region = useEditorStore(s => s.region);
  useEditorStore(s => s.activeLayerId);
  const subscribe = useCallback((notify: () => void) => draft.store.subscribe(notify), [draft.store]);
  useSyncExternalStore(subscribe, () => draft.store.revision);
  const count = replacementPlan(draft).reduce((sum, p) => sum + p.cells.length, 0);
  return <>
    <DialogHeader title={t("replaceTiles.title")} onClose={closeTileReplacement} />
    <DialogBody className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-4">{(["from", "to"] as const).map(target => {
        const tile = draft[target];
        const tileset = tile ? draft.store.document.getTileset(tile.tilesetId) : undefined;
        return <FormField key={target} label={t(`replaceTiles.${target}`)}>
          <button type="button" data-replace-swatch={target} aria-label={t(`replaceTiles.${target}`)} title={t("replaceTiles.pickHint")} onClick={() => {
            const ui = useUiStore.getState();
            if (ui.panelsHidden) ui.togglePanels();
            useLayoutStore.getState().setRecentHidden(false);
            useLayoutStore.getState().setDockTab("tileset");
            beginReplacementPick(target);
          }} className="flex min-w-0 items-center gap-2 rounded-sm border border-line bg-field p-2 text-sm text-text hover:border-line-strong focus-visible:outline-2 focus-visible:outline-accent">
            {tileset && tile ? <><TileSwatch tileset={tileset} tileId={tile.tileId} size={32} /><span className="truncate" title={`${tileset.name} · ${tile.tileId}`}>{tileset.name} · {tile.tileId}</span></> : <span>{t("replaceTiles.empty")}</span>}
          </button>
        </FormField>;
      })}</div>
      <FormField label={t("replaceTiles.scope")}>
        <Segmented size="md" label={t("replaceTiles.scope")} value={draft.scope} onValueChange={scope => updateTileReplacement({ scope })} items={[
          { value: "selection", label: t("replaceTiles.selection"), disabled: !region },
          { value: "active", label: t("replaceTiles.active") },
          { value: "visible", label: t("replaceTiles.visible") },
        ]} />
      </FormField>
      <p className="text-sm text-muted" aria-live="polite" data-replace-count="">{t("replaceTiles.count", { count })}</p>
    </DialogBody>
    <DialogFooter>
      <Button size="md" onClick={closeTileReplacement}>{t("common.cancel")}</Button>
      <Button variant="primary" size="md" disabled={count === 0} onClick={() => commitTileReplacement()}>{t("replaceTiles.apply")}</Button>
    </DialogFooter>
  </>;
}
