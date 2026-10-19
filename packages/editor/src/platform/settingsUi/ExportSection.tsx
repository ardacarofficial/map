import type { ExportSettings } from "../../export/exportSettings";
import { PNG_SCALES } from "../../export/pngComposite";
import { EXPORT_TARGETS, targetOptions } from "../../export/targetRegistry";
import { exportFolderLabel } from "../../export/exportActions";
import { t } from "../../i18n";
import { DialogToggle, FormField } from "../../ui/dialogs/DialogFrame";
import { NativeSelect } from "../../ui/primitives/NativeSelect";
import { TextField } from "../../ui/primitives/TextField";

/** Target selection and defaults share the export dialog's registry and world memory. */
export function ExportSection({ settings, onChange }: { settings: ExportSettings | null; onChange(patch: Partial<ExportSettings>): void }) {
  if (!settings) return <p className="text-sm text-muted">{t("settingsUi.exportNeedsWorld")}</p>;
  const target = EXPORT_TARGETS.find(target => target.id === settings.target)!;
  const options = targetOptions(target.id, settings);
  return <div className="flex flex-col gap-3"><p className="text-sm text-muted">{t("settingsUi.exportWorld", { world: settings.project })}</p>
    <FormField htmlFor="settings-export-target" label={t("settingsUi.exportTarget")}>
      <NativeSelect id="settings-export-target" value={settings.target} onChange={event => onChange({ target: event.target.value as ExportSettings["target"] })}>
        {EXPORT_TARGETS.map(target => <option key={target.id} value={target.id}>{t(target.labelKey)}</option>)}
      </NativeSelect>
    </FormField>
    <p className="text-xs text-muted">{t(target.descriptionKey)}</p>
    {target.preferences.map(option => {
      const label = t(option.settingsLabelKey);
      const id = option.key === "pngScale" ? "settings-png-scale" : `settings-${option.key}`;
      if (option.type === "scale") return <FormField key={option.key} htmlFor={id} label={label}><NativeSelect id={id} value={settings.pngScale} onChange={event => onChange({ pngScale: Number(event.target.value) as ExportSettings["pngScale"] })}>{PNG_SCALES.map(value => <option key={value} value={value}>{value}×</option>)}</NativeSelect></FormField>;
      if (option.type === "text") return <FormField key={option.key} htmlFor={id} label={label}><TextField id={id} value={settings[option.key]} onChange={event => onChange({ [option.key]: event.target.value })} /></FormField>;
      const enabled = option.key !== "autoUnity" || exportFolderLabel(settings, "unity") !== null;
      return <div key={option.key} className="flex flex-col gap-1"><div className="flex items-center justify-between gap-3 text-sm">{label}<DialogToggle label={label} disabled={!enabled} checked={enabled && settings[option.key]} onChange={value => onChange({ [option.key]: value })} /></div>{!enabled && <p className="text-xs text-muted">{t("export.autoUnityNeedsFolder")}</p>}</div>;
    })}
    {target.options.map(option => {
      const label = t(option.labelKey);
      const hint = option.hintKey ? t(option.hintKey) : undefined;
      const change = (value: string | boolean) => onChange({ targetOptions: { ...settings.targetOptions, [target.id]: { ...options, [option.id]: value } } });
      return option.type === "boolean"
        ? <div key={option.id} title={hint} className="flex items-center justify-between gap-3 text-sm">{label}<DialogToggle label={label} checked={options[option.id] === true} onChange={change} /></div>
        : <FormField key={option.id} htmlFor={`settings-export-${option.id}`} label={label} title={hint}><TextField id={`settings-export-${option.id}`} value={String(options[option.id])} onChange={event => change(event.target.value)} spellCheck={false} /></FormField>;
    })}
  </div>;
}
