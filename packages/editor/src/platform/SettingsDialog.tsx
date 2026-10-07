import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useState, type FormEvent } from "react";

import { t } from "../i18n";
import { SHORTCUTS } from "../shortcuts/shortcuts";
import { backdropClass, popupClass } from "../ui/dialogs/styles";
import { Button } from "../ui/primitives/Button";
import { toast } from "../ui/toast/toastStore";
import { getLocale } from "../i18n";
import { readSettingsText, saveSettingsText, useAppSettings } from "./appSettings";
import { getPlatform } from "./index";
import { defaultSettingsText } from "./settings";

/**
 * The settings file as plain JSON (CLAUDE.md: no shortcut editor screen, a
 * settings file is enough). On the desktop this edits `settings.json` in the
 * app config folder; in the browser the same JSON lives in localStorage.
 */
export function SettingsDialog() {
  const open = useAppSettings((s) => s.dialogOpen);
  const setOpen = useAppSettings((s) => s.setDialogOpen);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdropClass} />
        <Dialog.Popup className={`${popupClass} flex max-h-[calc(100vh-64px)] w-[640px] max-w-[calc(100vw-32px)] flex-col`}>
          {open && <SettingsForm onDone={() => setOpen(false)} />}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SettingsForm({ onDone }: { onDone(): void }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void readSettingsText()
      .catch(() => defaultSettingsText(SHORTCUTS, getLocale()))
      .then((value) => alive && setText(value));
    return () => {
      alive = false;
    };
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (text === null) return;
    try {
      const problems = await saveSettingsText(text);
      if (problems.length === 0) toast.success(t("settings.saved"));
      onDone();
    } catch (e) {
      setError(t("settings.invalidJson", { detail: e instanceof Error ? e.message : String(e) }));
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex min-h-0 flex-col">
      <div className="flex flex-col gap-1 px-5 pt-5">
        <Dialog.Title className="text-lg font-semibold">{t("settings.dialogTitle")}</Dialog.Title>
        <Dialog.Description className="text-md text-muted">{t("settings.dialogDescription")}</Dialog.Description>
        <span className="truncate font-mono text-xs text-faint" title={getPlatform().settingsLocation()}>
          {t("settings.dialogLocation", { path: getPlatform().settingsLocation() })}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-5 pt-4">
        <textarea
          aria-label={t("settings.dialogTitle")}
          spellCheck={false}
          value={text ?? ""}
          disabled={text === null}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          className="h-[420px] min-h-[160px] w-full resize-none rounded-md border border-line bg-panel p-3 font-mono text-sm text-text outline-none focus:border-accent-line"
        />
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
      <div className="flex justify-between gap-2 px-5 py-4">
        <Button variant="ghost" onClick={() => setText(defaultSettingsText(SHORTCUTS, getLocale()))}>
          {t("settings.dialogDefaults")}
        </Button>
        <div className="flex gap-2">
          <Button onClick={onDone}>{t("settings.dialogCancel")}</Button>
          <Button variant="primary" type="submit" disabled={text === null}>
            {t("settings.dialogSave")}
          </Button>
        </div>
      </div>
    </form>
  );
}
