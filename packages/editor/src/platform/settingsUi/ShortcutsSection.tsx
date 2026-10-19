import { useState } from "react";
import { getCommand } from "../../commands/registry";
import { formatChord, type KeyEventLike } from "../../commands/keymap";
import { t, type MessageKey } from "../../i18n";
import { SHORTCUTS, type CommandId } from "../../shortcuts/shortcuts";
import { Button } from "../../ui/primitives/Button";
import { TextField } from "../../ui/primitives/TextField";
import { PANELS } from "../../ui/layout/panels";
import type { PanelId } from "../../ui/layout/dockModel";
import { mergeShortcuts } from "../settings";
import { KeyRecorder } from "./KeyRecorder";
import { assignKeys, conflictsFor, reservedChord, resetCommand, type Overrides } from "./shortcutDraft";

function commandLabel(id: CommandId): string {
  const command = getCommand(id);
  const label = command ? t(command.title) : t("settingsUi.pan");
  return id.startsWith("panel.") ? `${t(PANELS[id.split(".")[1] as PanelId].label)} · ${label}` : label;
}
const searchText = (text: string) => text.toLocaleLowerCase("tr").normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i");
export function ShortcutsSection({ overrides, onChange }: { overrides: Overrides; onChange(overrides: Overrides): void }) {
  const [search, setSearch] = useState("");
  const [recording, setRecording] = useState<CommandId | null>(null);
  const [pending, setPending] = useState<{ command: CommandId; keys: string[]; conflicts: CommandId[]; reset?: boolean; recorded?: KeyEventLike | undefined } | null>(null);
  const [resetting, setResetting] = useState(false);
  const [reserved, setReserved] = useState(false);
  const assign = (command: CommandId, keys: string[], recorded?: KeyEventLike) => {
    setRecording(null);
    if (keys.some(reservedChord)) { setReserved(true); return; }
    setReserved(false);
    const conflicts = conflictsFor(overrides, command, keys, recorded);
    if (conflicts.length) setPending({ command, keys, conflicts, recorded });
    else onChange(assignKeys(overrides, command, keys, false, recorded));
  };
  return <div className="flex flex-col gap-3">
    <TextField aria-label={t("settingsUi.shortcutSearch")} placeholder={t("settingsUi.shortcutSearch")} value={search} onChange={event => { setSearch(event.target.value); setRecording(null); setPending(null); }} />
    {reserved && <p role="alert" className="text-sm text-danger">{t("settingsUi.reserved")}</p>}
    {pending && <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-line pb-3"><p className="w-full text-sm">{t("settingsUi.conflict", { commands: pending.conflicts.map(commandLabel).join(", ") })}</p><Button onClick={() => { onChange(pending.reset ? resetCommand(overrides, pending.command) : assignKeys(overrides, pending.command, pending.keys, true, pending.recorded)); setPending(null); }}>{t("settingsUi.replace")}</Button><Button variant="ghost" onClick={() => setPending(null)}>{t("settings.dialogCancel")}</Button></div>}
    {mergeShortcuts(SHORTCUTS, overrides).filter(row => {
      const command = getCommand(row.command);
      return searchText(`${commandLabel(row.command)} ${row.command === "tool.brush" ? t("settingsUi.brushAlias") : ""} ${command ? t(`categories.${command.category}` as MessageKey) : t("categories.view")} ${row.keys.join(" ")} ${row.keys.map(key => formatChord(key)).join(" ")} ${row.command === "view.pan" ? t("settingsUi.fixedPan") : ""}`).includes(searchText(search));
    }).map(row => <div key={row.command} data-shortcut-row={row.command} className="flex flex-wrap items-center gap-2 border-b border-line-subtle pb-2">
      <div className="min-w-0 flex-1"><p className="text-sm text-title">{commandLabel(row.command)}</p><p className="text-xs text-muted">{t("settingsUi.defaults", { keys: SHORTCUTS.find(def => def.command === row.command)!.keys.map(key => formatChord(key)).join(" / ") || t("settingsUi.unbound") })}</p><p className="text-xs text-muted">{getCommand(row.command) ? t(`categories.${getCommand(row.command)!.category}` as MessageKey) : t("categories.view")}</p></div>
      <span className="text-sm font-mono">{row.keys.map(key => formatChord(key)).join(" / ") || t("settingsUi.unbound")}</span>
      {row.command === "view.pan" ? <span className="text-xs text-muted">{t("settingsUi.fixedPan")}</span> : <>
        {recording === row.command ? <KeyRecorder onCancel={() => setRecording(null)} onKey={(key, event) => assign(row.command, key ? [key] : [], event)} /> : <Button size="sm" onClick={() => { setPending(null); setRecording(row.command); }}>{t("settingsUi.record")}</Button>}
        <Button size="sm" variant="ghost" onClick={() => assign(row.command, [])}>{t("settingsUi.clear")}</Button>
        <Button size="sm" variant="ghost" disabled={!overrides.has(row.command)} onClick={() => {
          const keys = SHORTCUTS.find(def => def.command === row.command)!.keys;
          const conflicts = conflictsFor(overrides, row.command, keys);
          if (conflicts.length) setPending({ command: row.command, keys, conflicts, reset: true });
          else onChange(resetCommand(overrides, row.command));
        }}>{t("settingsUi.reset")}</Button>
      </>}
    </div>)}
    {resetting ? <div className="flex flex-wrap gap-2"><p className="w-full text-sm">{t("settingsUi.resetConfirm")}</p><Button onClick={() => { onChange(new Map()); setResetting(false); }}>{t("settingsUi.resetAll")}</Button><Button variant="ghost" onClick={() => setResetting(false)}>{t("settings.dialogCancel")}</Button></div> : <Button className="self-start" onClick={() => { setRecording(null); setPending(null); setResetting(true); }}>{t("settingsUi.resetAll")}</Button>}
  </div>;
}
