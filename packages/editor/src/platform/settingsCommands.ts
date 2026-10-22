/** Palette commands open the corresponding application settings category. */
import { registerCommands } from "../commands/registry";
import { useAppSettings } from "./appSettings";

let registered = false;

export function registerSettingsCommands(): void {
  if (registered) return;
  registered = true;
  registerCommands([
    {
      id: "settings.language",
      title: "commands.settings.language",
      category: "general",
      run: () => useAppSettings.setState({ dialogOpen: true, settingsCategory: "language" }),
    },
    {
      id: "settings.editShortcuts",
      title: "commands.settings.editShortcuts",
      category: "general",
      run: () => useAppSettings.getState().setDialogOpen(true),
    },
  ]);
}
