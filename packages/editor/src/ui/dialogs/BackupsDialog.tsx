import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useRef, useState } from "react";
import { getLocale, t } from "../../i18n";
import type { BackupEntry } from "../../io/backups";
import { listProjectBackups, openBackup } from "../../io/session";
import { useSaveStatus } from "../../io/saveStatus";
import { Button } from "../primitives/Button";
import { useUiStore } from "../uiStore";
import { DialogHeader, DialogBody, DialogFooter, dialogLayoutClass } from "./DialogFrame";
import { backdropClass, popupClass, dialogWidthM } from "./styles";

/** "Yedekten aç": the backups of the open level, newest first. Opening one replaces the map. */
export function BackupsDialog() {
  const popupRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const open = useUiStore((s) => s.backupsOpen);
  const setOpen = useUiStore((s) => s.setBackupsOpen);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdropClass} />
        <Dialog.Popup ref={popupRef} initialFocus={() => popupRef.current?.querySelector<HTMLButtonElement>("[data-backup-row]:not(:disabled)") ?? closeRef.current} className={`${popupClass} ${dialogWidthM} ${dialogLayoutClass}`}>
          <DialogHeader title={t("backups.title")} subtitle={t("backups.description")} onClose={() => setOpen(false)} />
          <DialogBody>{open && <BackupList onDone={() => setOpen(false)} />}</DialogBody>
          <DialogFooter><Button ref={closeRef} variant="secondary" onClick={() => setOpen(false)}>{t("common.close")}</Button></DialogFooter>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function locale(): string {
  return getLocale() === "tr" ? "tr-TR" : "en-US";
}

function relative(date: Date, now: number): string {
  const seconds = Math.round((date.getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: "auto" });
  const abs = Math.abs(seconds);
  if (abs < 60) return rtf.format(seconds, "second");
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
  return rtf.format(Math.round(seconds / 86400), "day");
}

function BackupList({ onDone }: { onDone(): void }) {
  const hasFolder = useSaveStatus((s) => s.hasFolder);
  const [entries, setEntries] = useState<BackupEntry[] | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    listProjectBackups()
      .then((list) => !cancelled && setEntries(list))
      .catch(() => !cancelled && setEntries([]));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!hasFolder) return <Empty title={t("backups.noFolder")} />;
  if (!entries) return <div className="text-sm text-muted">{t("backups.loading")}</div>;
  if (entries.length === 0) return <Empty title={t("backups.empty")} />;

  return (
    <ul className="flex flex-col gap-px">
      {entries.map((entry, index) => (
        <li key={entry.path}>
          <button
            type="button"
            disabled={opening !== null}
            data-backup-row
            // The list arrives after the dialog opened (focus went to "Kapat"); the newest backup takes it.
            autoFocus={index === 0}
            onClick={() => {
              setOpening(entry.path);
              void openBackup(entry).then((ok) => (ok ? onDone() : setOpening(null)));
            }}
            className="flex h-control-md w-full items-center gap-3 rounded-sm px-2 text-left hover:bg-hover-popup disabled:opacity-60"
          >
            <span className="min-w-0 flex-1 truncate text-sm text-text tabular" title={entry.fileName}>
              {entry.date.toLocaleString(locale(), { dateStyle: "medium", timeStyle: "medium" })}
            </span>
            {index === 0 && <span className="text-xs text-muted">{t("backups.latest")}</span>}
            <span className="text-xs text-muted tabular">{relative(entry.date, now)}</span>
            <span className="text-sm text-muted">{t("backups.open")}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Empty({ title }: { title: string }) {
  return <p className="text-sm text-muted">{title}</p>;
}
