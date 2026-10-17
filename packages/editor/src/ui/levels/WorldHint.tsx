import { t } from "../../i18n";
import { SectionHeader } from "../primitives/SectionHeader";
import { Kbd } from "../primitives/Kbd";

/** Right column below the level list while the world map (v1.2) is shown: what the view does. */
export function WorldHint() {
  return (
    <section aria-label={t("world.hintTitle")} data-world-hint="" className="flex flex-col">
      <SectionHeader title={t("world.hintTitle")} padding={12} />
      <div className="flex flex-col gap-2 px-3 pb-3 text-sm text-muted">
        <p>{t("world.hint")}</p>
        <p className="flex items-center gap-2">
          <Kbd keys="Escape" />
          <span>{t("world.back")}</span>
        </p>
      </div>
    </section>
  );
}
