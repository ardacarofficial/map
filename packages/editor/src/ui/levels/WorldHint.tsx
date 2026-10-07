import { t } from "../../i18n";
import { Icon } from "../primitives/Icon";
import { Kbd } from "../primitives/Kbd";

/** Right column below the level list while the world map (v1.2) is shown: what the view does. */
export function WorldHint() {
  return (
    <section aria-label={t("world.hintTitle")} data-world-hint="" className="flex flex-col gap-2 px-3 py-3 text-sm">
      <div className="flex items-center gap-2 text-muted">
        <Icon name="globe" size={14} className="text-accent" />
        <span className="font-medium text-text">{t("world.hintTitle")}</span>
      </div>
      <p className="leading-relaxed text-faint">{t("world.hint")}</p>
      <p className="flex items-center gap-1.5 text-faint">
        <Kbd keys="Escape" />
        <span>{t("world.back")}</span>
      </p>
    </section>
  );
}
