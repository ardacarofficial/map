import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useState } from "react";
import { getLocale, t } from "../../i18n";
import type { BackupEntry } from "../../io/backups";
import { listProjectBackups, openBackup } from "../../io/session";
import { useSaveStatus } from "../../io/saveStatus";
import { Button } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { useUiStore } from "../uiStore";
import { backdropClass, popupClass } from "./styles";

/** "Yedekten aç": the backups of the open level, newest first. Opening one replaces the map. */
export function BackupsDialog() {
  const open = useUiStore((s) => s.backupsOpen);
  const setOpen = useUiStore((s) => s.setBackupsOpen);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdropClass} />
        <Dialog.Popup className={`${popupClass} flex w-[460px] max-w-[calc(100vw-32px)] flex-col`}>
          <div className="flex flex-col gap-1 px-5 pt-5">
            <Dialog.Title className="text-lg font-semibold">{t("backups.title")}</Dialog.Title>
            <Dialog.Description className="text-md text-muted">{t("backups.description")}</Dialog.Description>
          </div>
          {open && <BackupList onDone={() => setOpen(false)} />}
          <div className="flex justify-end border-t border-line px-5 py-3">
            <Dialog.Close render={<Button variant="ghost">{t("common.close")}</Button>} />
          </div>
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

  if (!hasFolder) return <Empty icon="folder" title={t("backups.noFolder")} />;
  if (!entries) return <div className="px-5 py-10 text-center text-md text-faint">{t("backups.loading")}</div>;
  if (entries.length === 0) return <Empty icon="history" title={t("backups.empty")} hint={t("backups.emptyHint")} />;

  return (
    <ul className="mx-3 my-4 flex max-h-[min(400px,50vh)] flex-col gap-px overflow-y-auto">
      {entries.map((entry, index) => (
        <li key={entry.path}>
          <button
            type="button"
            disabled={opening !== null}
            onClick={() => {
              setOpening(entry.path);
              void openBackup(entry).then((ok) => (ok ? onDone() : setOpening(null)));
            }}
            className="group flex h-11 w-full items-center gap-3 rounded-md px-2.5 text-left transition-colors hover:bg-hover disabled:opacity-60"
          >
            <Icon name="history" size={15} className="shrink-0 text-faint group-hover:text-accent" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-md text-text">
                {entry.date.toLocaleString(locale(), { dateStyle: "medium", timeStyle: "medium" })}
              </span>
              <span className="truncate font-mono text-2xs text-faint">{entry.fileName}</span>
            </span>
            {index === 0 && (
              <span className="rounded-xs bg-accent-soft px-1.5 py-px text-2xs font-medium text-accent">
                {t("backups.latest")}
              </span>
            )}
            <span className="text-sm text-faint tabular">{relative(entry.date, now)}</span>
            <span className="text-sm font-medium text-accent opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              {t("backups.open")}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Empty({ icon, title, hint }: { icon: "folder" | "history"; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
      <Icon name={icon} size={22} className="text-faint" />
      <span className="text-md text-muted">{title}</span>
      {hint && <span className="text-sm text-faint">{hint}</span>}
    </div>
  );
}
