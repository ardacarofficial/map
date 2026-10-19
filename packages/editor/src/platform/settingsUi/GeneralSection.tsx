import { t } from "../../i18n";
import { getPlatform } from "../index";
export function GeneralSection() {
  return <dl className="flex flex-col gap-2 text-sm"><dt className="text-muted">{t("settingsUi.scope")}</dt><dd>{t("settingsUi.scopeFact")}</dd><dt className="mt-2 text-muted">{t("settings.fileLabel")}</dt><dd className="break-all select-text">{getPlatform().settingsLocation()}</dd></dl>;
}
