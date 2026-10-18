import { Popover } from "@base-ui/react/popover";
import { useState } from "react";
import { runCommand } from "../../commands/registry";
import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { useMajorGrid } from "../../state/majorGridSettings";
import { IconButton } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { NativeSelect } from "../primitives/NativeSelect";
import { TextField } from "../primitives/TextField";
import { Toggle } from "../primitives/Toggle";
import { Tooltip } from "../primitives/Tooltip";
import { FormField } from "../dialogs/DialogFrame";
import { menuPopupClass, menuPositionerClass } from "../primitives/menuStyles";

/** Existing grid toggle keeps its home; the adjacent disclosure owns its view settings. */
export function GridControl({ disabled = false }: { disabled?: boolean }) {
  const grid = useEditorStore(s => s.gridVisible);
  return <div className="flex items-center">
    <Tooltip label={t("toolOptions.grid")} command="view.toggleGrid"><IconButton size="md" aria-label={t("toolOptions.grid")} active={grid} aria-pressed={grid} disabled={disabled} data-view-toggle="view.toggleGrid" onClick={() => runCommand("view.toggleGrid")}><Icon name="grid-3x3" size={16} /></IconButton></Tooltip>
    <GridSettings disabled={disabled} />
  </div>;
}
export function GridSettings({ disabled = false }: { disabled?: boolean }) {
  return <Popover.Root>
    <Tooltip label={t("majorGrid.title")}><Popover.Trigger disabled={disabled} aria-label={t("majorGrid.title")} className="grid size-control-md place-items-center rounded-sm text-muted hover:bg-hover hover:text-text data-popup-open:bg-active"><Icon name="chevron-down" size={12} /></Popover.Trigger></Tooltip>
    <Popover.Portal><Popover.Positioner side="bottom" align="end" sideOffset={4} className={menuPositionerClass}>
      <Popover.Popup className={`${menuPopupClass} flex w-64 flex-col gap-3 p-3!`} data-major-grid-popover>
        <Popover.Title className="text-sm font-medium text-title">{t("majorGrid.title")}</Popover.Title>
        <GridFields />
      </Popover.Popup>
    </Popover.Positioner></Popover.Portal>
  </Popover.Root>;
}
function GridFields() {
  const { settings, update } = useMajorGrid();
  const visible = useEditorStore(s => s.gridVisible);
  return <>
    <div className="flex items-center justify-between text-sm text-muted">{t("majorGrid.visible")}<Toggle label={t("majorGrid.visible")} checked={visible} onChange={() => runCommand("view.toggleGrid")} /></div>
    <FormField label={t("majorGrid.interval")}><NativeSelect size="sm" aria-label={t("majorGrid.interval")} value={settings.interval} onChange={e => update({ interval: Number(e.target.value) })}>
      <option value={0}>{t("majorGrid.off")}</option>{Array.from({ length: 63 }, (_, i) => i + 2).map(n => <option key={n} value={n}>{n}</option>)}
    </NativeSelect></FormField>
    <fieldset title={t("majorGrid.hint")}><legend className="mb-2 text-sm text-muted">{t("majorGrid.origin")}</legend><div className="grid grid-cols-2 gap-2">
      <OriginField label={t("majorGrid.x")} value={settings.x} onChange={x => update({ x })} />
      <OriginField label={t("majorGrid.y")} value={settings.y} onChange={y => update({ y })} />
    </div></fieldset>
  </>;
}
function OriginField({ label, value, onChange }: { label: string; value: number; onChange(value: number): void }) {
  const [text, setText] = useState(String(value));
  const valid = text.trim() !== "" && Number.isSafeInteger(Number(text)) && Math.abs(Number(text)) <= 1_000_000;
  return <FormField label={label}><TextField size="sm" type="number" step={1} min={-1_000_000} max={1_000_000} aria-label={label} value={text} aria-invalid={!valid || undefined} onChange={e => { const next = e.target.value; setText(next); if (next.trim() !== "") onChange(Number(next)); }} onBlur={() => setText(String(value))} /></FormField>;
}
