import type { ExportSettings } from "../../export/exportSettings";
import { t, type MessageKey } from "../../i18n";
import { DialogToggle, FormField } from "../../ui/dialogs/DialogFrame";
import { NativeSelect } from "../../ui/primitives/NativeSelect";
/** Existing export defaults; new exporter options can contribute rows here. */
export const exportPreferenceRows: { key: "autoUnity" | "unityTiles" | "unityCollision" | "copyTextures"; label: MessageKey; enabled?(settings: ExportSettings): boolean; unavailable?: MessageKey }[] = [
  { key: "autoUnity", label: "settingsUi.autoUnity", enabled: settings => settings.unityDir !== null, unavailable: "export.autoUnityNeedsFolder" },
  { key: "unityTiles", label: "settingsUi.unityTiles" },
  { key: "unityCollision", label: "settingsUi.unityCollision" },
  { key: "copyTextures", label: "settingsUi.copyTextures" },
];
export function ExportSection({ settings, onChange }: { settings: ExportSettings | null; onChange(patch: Partial<ExportSettings>): void }) {
  if (!settings) return <p className="text-sm text-muted">{t("settingsUi.exportNeedsWorld")}</p>;
  return <div className="flex flex-col gap-3"><p className="text-sm text-muted">{t("settingsUi.exportWorld", { world: settings.project })}</p>
    <FormField htmlFor="settings-png-scale" label={t("settingsUi.pngScale")}><NativeSelect id="settings-png-scale" value={settings.pngScale} onChange={event => onChange({ pngScale: Number(event.target.value) as ExportSettings["pngScale"] })}>{[1, 2, 4].map(value => <option key={value} value={value}>{value}×</option>)}</NativeSelect></FormField>
    {exportPreferenceRows.map(row => {
      const enabled = row.enabled?.(settings) ?? true;
      return <div key={row.key} className="flex flex-col gap-1"><div className="flex items-center justify-between gap-3 text-sm">{t(row.label)}<DialogToggle label={t(row.label)} disabled={!enabled} checked={enabled && settings[row.key]} onChange={value => onChange({ [row.key]: value })} /></div>{!enabled && row.unavailable && <p className="text-xs text-muted">{t(row.unavailable)}</p>}</div>;
    })}
  </div>;
}
