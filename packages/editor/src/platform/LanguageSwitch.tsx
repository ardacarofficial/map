import { t, type Locale } from "../i18n";
import { setAppLocale, useAppSettings } from "./appSettings";

const OPTIONS: { locale: Locale; label: "settings.languageTr" | "settings.languageEn" }[] = [
  { locale: "tr", label: "settings.languageTr" },
  { locale: "en", label: "settings.languageEn" },
];

/** Small TR / EN switch (welcome screen footer). */
export function LanguageSwitch() {
  const locale = useAppSettings((s) => s.locale);
  return (
    <div role="radiogroup" aria-label={t("settings.languageLabel")} className="inline-flex items-center gap-0.5">
      {OPTIONS.map((option) => (
        <button
          key={option.locale}
          type="button"
          role="radio"
          aria-checked={locale === option.locale}
          onClick={() => void setAppLocale(option.locale)}
          className={`rounded-sm px-1.5 py-0.5 transition-colors ${
            locale === option.locale ? "bg-active text-text" : "text-faint hover:bg-hover hover:text-muted"
          }`}
        >
          {t(option.label)}
        </button>
      ))}
    </div>
  );
}
