import { availableLocales, t, type Locale } from "../i18n";
import { Segmented } from "../ui/primitives/Segmented";
import { setAppLocale, useAppSettings } from "./appSettings";

export function LanguageSwitch({ size = "sm", value, onValueChange, disabled = false }: { size?: "sm" | "md"; value?: Locale; onValueChange?(locale: Locale): void; disabled?: boolean } = {}) {
  const locale = useAppSettings(s => s.locale);
  return <Segmented size={size} label={t("settings.languageLabel")} value={value ?? locale} disabled={disabled} onValueChange={next => onValueChange ? onValueChange(next) : void setAppLocale(next)}
    items={availableLocales().map(locale => ({ value: locale.id, label: locale.nativeName }))} />;
}
