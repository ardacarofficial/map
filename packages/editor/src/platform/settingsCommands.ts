/** Palette commands for the settings file: language switch and the shortcut JSON. */
import { getLocale, t } from "../i18n";
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
      run: () => void setAppLocale(getLocale() === "tr" ? "en" : "tr").then(() => toast.info(t("settings.languageChanged"))),
    },
    {
      id: "settings.editShortcuts",
      title: "commands.settings.editShortcuts",
      category: "general",
      run: () => useAppSettings.getState().setDialogOpen(true),
    },
  ]);
}
