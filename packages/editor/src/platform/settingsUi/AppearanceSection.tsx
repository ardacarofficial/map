import { t } from "../../i18n";
import type { DockLayout } from "../../ui/layout/dockModel";
import { DialogToggle } from "../../ui/dialogs/DialogFrame";
export function AppearanceSection({ layout, onChange }: { layout: DockLayout; onChange(layout: DockLayout): void }) {
  return <section className="flex flex-col gap-3"><h3 className="text-md font-semibold text-title">{t("settingsUi.canvas")}</h3><div className="flex items-center justify-between gap-3 text-sm">{t("commands.view.toggleRulers")}<DialogToggle label={t("commands.view.toggleRulers")} checked={layout.rulersVisible} onChange={rulersVisible => onChange({ ...layout, rulersVisible })} /></div></section>;
}
