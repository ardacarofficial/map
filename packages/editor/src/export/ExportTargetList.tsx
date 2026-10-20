import { t } from "../i18n";
import type { ExportTarget } from "./exportSettings";
import { EXPORT_TARGETS } from "./targetRegistry";

/** One accessible home for target selection, with plain-language descriptions. */
export function ExportTargetList({ value, onChange }: { value: ExportTarget; onChange(value: ExportTarget): void }) {
  return (
    <div role="radiogroup" aria-label={t("export.targets")} className="export-targets grid grid-cols-2 gap-1">
      {EXPORT_TARGETS.map(item => (
        <label key={item.id} className={`flex cursor-pointer items-start gap-2 rounded-sm p-2 ${value === item.id ? "bg-active" : "hover:bg-hover"}`}>
          <input type="radio" name="export-target" value={item.id} checked={value === item.id} aria-checked={value === item.id} aria-label={t(item.labelKey)}
            onChange={() => onChange(item.id)} className="mt-1 accent-muted" />
          <span className="flex min-w-0 flex-col"><span className="text-sm text-text">{t(item.labelKey)}</span><span className="text-xs text-muted [overflow-wrap:anywhere]">{t(item.descriptionKey)}</span></span>
        </label>
      ))}
    </div>
  );
}
