import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { getLocale, t } from "../i18n";
import { SHORTCUTS } from "../shortcuts/shortcuts";
import { backdropClass, popupClass, dialogWidthM } from "../ui/dialogs/styles";
import { DialogHeader, DialogBody, DialogFooter, FormField, dialogLayoutClass } from "../ui/dialogs/DialogFrame";
import { LanguageSwitch } from "./LanguageSwitch";
import { Button } from "../ui/primitives/Button";
import { toast } from "../ui/toast/toastStore";
import { readSettingsText, saveSettingsText, useAppSettings } from "./appSettings";
import { getPlatform } from "./index";
import { defaultSettingsText, parseSettings, withLocale } from "./settings";

const SETTINGS_FOCUS_SELECTOR = '[role="radio"][aria-checked="true"]:not(:disabled), textarea:not(:disabled)';

/**
 * The settings file as plain JSON (CLAUDE.md: no shortcut editor screen, a
 * settings file is enough). On the desktop this edits `settings.json` in the
 * app config folder; in the browser the same JSON lives in localStorage.
 */
export function SettingsDialog() {
  const popupRef = useRef<HTMLDivElement>(null);
  const open = useAppSettings((s) => s.dialogOpen);
  const setOpen = useAppSettings((s) => s.setDialogOpen);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdropClass} />
        <Dialog.Popup
          ref={popupRef}
          initialFocus={() => popupRef.current?.querySelector<HTMLElement>(SETTINGS_FOCUS_SELECTOR) ?? popupRef.current}
          onFocus={(event) => {
            // Loading can finish before Base UI applies its queued initial focus.
            if (event.target === event.currentTarget) event.currentTarget.querySelector<HTMLElement>(SETTINGS_FOCUS_SELECTOR)?.focus();
          }}
          className={`${popupClass} ${dialogWidthM} ${dialogLayoutClass}`}
        >
          {open && <SettingsForm onDone={() => setOpen(false)} />}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SettingsForm({ onDone }: { onDone(): void }) {
  const formRef = useRef<HTMLFormElement>(null);
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

  // The settings load asynchronously. Focus the first control once it is enabled,
  // provided the user has not already moved focus away from the popup itself.
  useEffect(() => {
    if (text === null) return;
    const popup = formRef.current?.closest('[role="dialog"]');
    if (document.activeElement === popup) {
      formRef.current?.querySelector<HTMLElement>(SETTINGS_FOCUS_SELECTOR)?.focus();
    }
  }, [text]);

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
    <form ref={formRef} onSubmit={(e) => void submit(e)} noValidate className="flex min-h-0 flex-col">
      <DialogHeader title={t("settings.dialogTitle")} subtitle={t("settings.dialogDescription")} onClose={onDone} />
      <DialogBody className="flex flex-col gap-3">
        <FormField label={t("settings.languageLabel")}><LanguageSwitch size="md" value={parseSettings(text ?? "", SHORTCUTS, getLocale()).settings.locale} disabled={text === null || withLocale(text, getLocale(), SHORTCUTS) === null} onValueChange={locale => setText(withLocale(text, locale, SHORTCUTS))} /></FormField>
        <FormField label={t("settings.fileLabel")} title={t("settings.dialogLocation", { path: getPlatform().settingsLocation() })}>
        <textarea
          aria-label={t("settings.dialogTitle")}
          spellCheck={false}
          value={text ?? ""}
          disabled={text === null}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          className="h-64 min-h-32 w-full resize-none rounded-sm border border-line bg-field p-2 font-mono text-sm text-text outline-none focus:border-accent-line"
        />
        </FormField>
        {error && <p className="text-sm text-danger">{error}</p>}
      </DialogBody>
      <DialogFooter left={<Button variant="ghost" onClick={() => setText(defaultSettingsText(SHORTCUTS, getLocale()))}>{t("settings.dialogDefaults")}</Button>}>
        <Button variant="secondary" onClick={onDone}>{t("settings.dialogCancel")}</Button>
        <Button variant="primary" type="submit" disabled={text === null}>{t("settings.dialogSave")}</Button>
      </DialogFooter>
    </form>
  );
}
