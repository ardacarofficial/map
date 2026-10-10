/**
 * Stamp editor chrome (round 5): the "Stamp: <ad>" document tab, the banner
 * under the tabs while it is active, and the "save the stamp?" question.
 * Mounted by `DocumentTabs`.
 */
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useEffect } from "react";

import { useWorldView } from "../../commands/worldActions";
import { t } from "../../i18n";
import { useProjectLibrary } from "../../io/projectLibrary";
import { backdropClass, popupClass } from "../dialogs/styles";
import { Button } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { Tooltip } from "../primitives/Tooltip";
import {
  closeStampEditor,
  discardStampEditor,
  installStampEditor,
  isStampSessionDirty,
  openStampEditor,
  saveStampEditor,
  sessionStampName,
  useStampCloseAsk,
  useStampEditor,
} from "./stampEditorSession";

/** Wires the stamp editor session to the app while the tabs row is mounted. */
export function useStampEditorInstall(): void {
  useEffect(() => installStampEditor(), []);
}

function useSessionView() {
  const session = useStampEditor((s) => s.session);
  const active = useStampEditor((s) => s.active);
  useStampEditor((s) => s.version);
  useProjectLibrary((s) => s.stamps);
  const world = useWorldView((s) => s.view === "world");
  return { session, active: active && !world, dirty: isStampSessionDirty(session), name: session ? sessionStampName(session) : "" };
}

/** The open stamp's document tab (after the map tabs). */
export function StampDocTab({ disabled }: { disabled: boolean }) {
  const { session, active, dirty, name } = useSessionView();
  if (!session) return null;
  const label = t("stampEditor.tab", { name });
  return (
    <div
      role="tab"
      aria-selected={active}
      data-doc-tab={`stamp:${session.stampId}`}
      data-stamp-tab=""
      title={label}
      tabIndex={0}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button") || disabled) return;
        void openStampEditor(session.stampId);
      }}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && !disabled) {
          e.preventDefault();
          void openStampEditor(session.stampId);
        }
      }}
      onAuxClick={(e) => {
        if (e.button === 1 && !disabled) {
          e.preventDefault();
          void closeStampEditor();
        }
      }}
      className={`group relative flex max-w-[240px] min-w-0 shrink-0 cursor-default items-center gap-2 border-r border-line pr-1.5 pl-3 text-md transition-colors duration-100 outline-none focus-visible:bg-hover ${
        active ? "bg-panel text-title" : "text-muted hover:bg-hover hover:text-text"
      }`}
    >
      <Icon name="stamp" size={13} className={active ? "shrink-0 text-accent" : "shrink-0 text-faint"} />
      <span className="min-w-0 truncate">{label}</span>
      {dirty && <span role="img" aria-label={t("levels.unsaved")} title={t("levels.unsaved")} className="size-1.5 shrink-0 rounded-full bg-warning" />}
      <button
        type="button"
        aria-label={t("stampEditor.close", { name })}
        title={t("docTabs.close")}
        disabled={disabled}
        onClick={() => void closeStampEditor()}
        className={`grid size-5 shrink-0 place-items-center rounded-sm text-faint hover:bg-active hover:text-text disabled:invisible ${
          active ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        }`}
      >
        <Icon name="x" size={12} />
      </button>
      {active && <span aria-hidden className="absolute right-0 bottom-0 left-0 h-0.5 bg-accent" />}
    </div>
  );
}

/** "Stamp düzenleniyor · Kaydet · Vazgeç" under the tabs while the stamp tab is shown. */
export function StampEditorBanner() {
  const { session, active, dirty, name } = useSessionView();
  if (!session || !active) return null;
  return (
    <div
      role="region"
      aria-label={t("stampEditor.banner")}
      data-stamp-banner=""
      className="flex h-9 shrink-0 items-center gap-3 border-b border-accent-line bg-accent-soft pr-2 pl-3 text-md"
    >
      <Icon name="stamp" size={15} className="shrink-0 text-accent" />
      <span className="shrink-0 font-semibold text-title">{t("stampEditor.banner")}</span>
      <span className="min-w-0 shrink truncate text-text">{name}</span>
      <span aria-hidden className="text-faint">·</span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-muted">
        <Icon name="info" size={13} className="shrink-0" />
        <span className="truncate">{t("stampEditor.note")}</span>
      </span>
      <Tooltip label={t("stampEditor.discardHint")}>
        <Button variant="ghost" className="h-7 shrink-0 px-2.5 text-sm" onClick={() => discardStampEditor()} data-stamp-discard="">
          {t("stampEditor.discard")}
        </Button>
      </Tooltip>
      <Tooltip label={t("stampEditor.saveHint")}>
        <Button variant="primary" className="h-7 shrink-0 px-3 text-sm" onClick={() => saveStampEditor()} data-stamp-save="">
          <Icon name="check" size={14} />
          {dirty ? t("stampEditor.save") : t("stampEditor.done")}
        </Button>
      </Tooltip>
    </div>
  );
}

/** "Stamp'teki değişiklikler kaydedilsin mi?" when closing a changed stamp tab. */
export function StampCloseDialog() {
  const request = useStampCloseAsk((s) => s.request);
  return (
    <AlertDialog.Root open={request !== null} onOpenChange={(open) => !open && request?.resolve("cancel")}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={backdropClass} />
        <AlertDialog.Popup className={`${popupClass} w-[420px] max-w-[calc(100vw-32px)] p-5`} data-stamp-close-dialog="">
          <AlertDialog.Title className="text-lg font-semibold">{t("stampEditor.closeTitle")}</AlertDialog.Title>
          <AlertDialog.Description className="mt-1.5 text-md text-muted">{t("stampEditor.closeDescription", { name: request?.name ?? "" })}</AlertDialog.Description>
          <div className="mt-5 flex gap-2">
            <Button variant="ghost" onClick={() => request?.resolve("discard")}>
              {t("common.dontSave")}
            </Button>
            <div className="ml-auto flex gap-2">
              <Button onClick={() => request?.resolve("cancel")}>{t("common.cancel")}</Button>
              <Button variant="primary" autoFocus onClick={() => request?.resolve("save")}>
                {t("common.save")}
              </Button>
            </div>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
