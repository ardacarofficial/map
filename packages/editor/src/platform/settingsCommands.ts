/** Palette commands for the settings file: language switch and the shortcut JSON. */
import { availableLocales, getLocale, t } from "../i18n";
import { toast } from "../ui/toast/toastStore";
import { registerCommands } from "../commands/registry";
import { setAppLocale, useAppSettings } from "./appSettings";

let registered = false;

export function registerSettingsCommands(): void {
  if (registered) return;
  registered = true;
  registerCommands([
    {
      id: "settings.language",
      title: "commands.settings.language",
      category: "general",
      run: () => {
        const locales = availableLocales();
        const next = locales[(locales.findIndex(locale => locale.id === getLocale()) + 1) % locales.length]!;
        void setAppLocale(next.id).then(() => toast.info(t("settings.languageSelected", { language: next.nativeName })));
      },
    },
    {
      id: "settings.editShortcuts",
      title: "commands.settings.editShortcuts",
      category: "general",
      run: () => useAppSettings.getState().setDialogOpen(true),
    },
  ]);
}
