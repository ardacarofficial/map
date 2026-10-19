import { availableLocales, t, type Locale } from "../../i18n";
import { FormField } from "../../ui/dialogs/DialogFrame";
import { NativeSelect } from "../../ui/primitives/NativeSelect";
export function LanguageSection({ locale, onChange }: { locale: Locale; onChange(locale: Locale): void }) {
  const locales = availableLocales();
  const selected = locales.find(item => item.id === locale);
  return <div className="flex flex-col gap-3"><FormField label={t("settings.languageLabel")} htmlFor="settings-locale">
    <NativeSelect id="settings-locale" value={locale} onChange={event => onChange(event.target.value)}>{locales.map(item => <option key={item.id} value={item.id}>{item.nativeName}</option>)}</NativeSelect>
  </FormField><p className="text-sm text-muted">{t("settingsUi.completeness", { percent: Math.round((selected?.completeness ?? 0) * 100) })}</p></div>;
}
