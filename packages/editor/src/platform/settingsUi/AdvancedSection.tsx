import { t } from "../../i18n";
import { Button } from "../../ui/primitives/Button";
import { FormField } from "../../ui/dialogs/DialogFrame";
import { getPlatform } from "../index";
export function AdvancedSection({ text, onChange, onReset }: { text: string; onChange(text: string): void; onReset(): void }) {
  return <div className="flex flex-col gap-3"><p className="break-all text-sm text-muted select-text">{getPlatform().settingsLocation()}</p><FormField label={t("settings.fileLabel")} htmlFor="settings-json"><textarea id="settings-json" aria-label={t("settings.dialogTitle")} spellCheck={false} value={text} onChange={event => onChange(event.target.value)} className="h-64 min-h-32 w-full resize-y rounded-sm border border-line bg-field p-2 font-mono text-sm text-text outline-none focus:border-accent-line" /></FormField><Button className="self-start" onClick={onReset}>{t("settings.dialogDefaults")}</Button></div>;
}
