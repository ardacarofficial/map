/**
 * "Tileset kaldırılsın mı?" — asked only when the tileset is painted
 * somewhere: how much of the project uses it (over every level), then
 * "Hücreleri temizle ve sil" / "Vazgeç". `askRemoveTileset()` resolves with
 * the choice.
 */
import { AlertDialog } from "../primitives/Overlays";
import { create } from "zustand";

import { t } from "../../i18n";
import { backdropClass, popupClass } from "../dialogs/styles";
import { Button } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { registerTilesetModal } from "../tilesetImport/importStore";
import type { UsageSummary } from "./libraryModel";

export interface RemoveRequest {
  readonly name: string;
  readonly usage: UsageSummary;
}

interface RemoveState {
  request: RemoveRequest | null;
  resolve: ((remove: boolean) => void) | null;
}

const useRemove = create<RemoveState>()(() => ({ request: null, resolve: null }));
registerTilesetModal(() => useRemove.getState().request !== null);

function finish(remove: boolean): void {
  const { resolve } = useRemove.getState();
  useRemove.setState({ request: null, resolve: null });
  resolve?.(remove);
}

export function askRemoveTileset(request: RemoveRequest): Promise<boolean> {
  finish(false);
  return new Promise((resolve) => useRemove.setState({ request, resolve }));
}

export function usageText(usage: UsageSummary): string {
  const parts: string[] = [];
  if (usage.cells > 0) parts.push(t("tilesetLib.usageCells", { count: usage.cells }));
  const what = parts.join(t("tilesetLib.usageAnd"));
  const stamps = usage.stamps > 0 ? t("smartStamp.usageStamps", { count: usage.stamps }) : "";
  if (usage.levels === 0) return stamps;
  const maps = usage.levels > 1
    ? t("tilesetLib.usageLevels", { levels: usage.levels, what })
    : t("tilesetLib.usageOneLevel", { what });
  return [maps, stamps].filter(Boolean).join(" ");
}

export function RemoveTilesetDialog() {
  const request = useRemove((s) => s.request);
  return (
    <AlertDialog.Root open={request !== null} onOpenChange={(open) => !open && finish(false)}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={backdropClass} />
        <AlertDialog.Popup className={`${popupClass} w-100 max-w-[calc(100vw-32px)] p-4`} data-dialog="remove-tileset">
          {request && (
            <>
              <AlertDialog.Title className="text-lg font-semibold">{t("tilesetLib.removeTitle", { name: request.name })}</AlertDialog.Title>
              <AlertDialog.Description className="mt-1.5 text-md text-muted">{t("tilesetLib.removeDescription")}</AlertDialog.Description>
              <div className="mt-4 flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2.5 text-sm leading-5 text-danger" data-remove-usage>
                <Icon name="warning" size={16} className="mt-0.5 shrink-0" />
                <span>{usageText(request.usage)}</span>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => finish(false)}>
                  {t("tilesetLib.removeCancel")}
                </Button>
                <Button variant="danger" autoFocus onClick={() => finish(true)}>
                  <Icon name="trash" size={16} />
                  {t("tilesetLib.removeConfirm")}
                </Button>
              </div>
            </>
          )}
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
