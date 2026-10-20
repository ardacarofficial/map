import { formatUiError } from "../errorMessages";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { loadExportSettings, updateExportSettings, type ExportSettings } from "../../export/exportSettings";
import { useExportStore } from "../../export/exportStore";
import { getLocale, setLocale, t, type MessageKey } from "../../i18n";
import { SHORTCUTS } from "../../shortcuts/shortcuts";
import { useEditorStore } from "../../state/editorStore";
import { DialogHeader, DialogFooter } from "../../ui/dialogs/DialogFrame";
import { useDockStore } from "../../ui/layout/dockStore";
import { defaultDockLayout, type DockLayout } from "../../ui/layout/dockModel";
import { Button } from "../../ui/primitives/Button";
import { NativeSelect } from "../../ui/primitives/NativeSelect";
import { toast } from "../../ui/toast/toastStore";
import { useAppSettings, beginSettingsPreview } from "../appSettings";
import { defaultSettingsText, parseSettings } from "../settings";
import { AiSection } from "./AiSection";
import { AiSettingsError, commitAiSettings, useAiSettingsDraft } from "./aiSettingsDraft";
import { validAgentPort } from "../../ui/agent/connectionSnippet";
import { AdvancedSection } from "./AdvancedSection";
import { AppearanceSection } from "./AppearanceSection";
import { ExportSection } from "./ExportSection";
import { GeneralSection } from "./GeneralSection";
import { LanguageSection } from "./LanguageSection";
import { PanelsSection } from "./PanelsSection";
import { ShortcutsSection } from "./ShortcutsSection";
import { draftObject, editDraft, editShortcutDraft } from "./settingsDraft";

export const SETTINGS_CATEGORIES = ["general", "appearance", "panels", "shortcuts", "language", "export", "ai", "advanced"] as const;
type Category = typeof SETTINGS_CATEGORIES[number];
type Preview = Awaited<ReturnType<typeof beginSettingsPreview>>;
export function SettingsShell({ onDone, onBusyChange }: { onDone(): void; onBusyChange(busy: boolean): void }) {
  const session = useRef<Preview | null>(null);
  const sidebar = useRef<HTMLDivElement>(null);
  const [text, setText] = useState<string | null>(null);
  const [category, setCategory] = useState<Category>(useAppSettings.getState().settingsCategory ?? "general");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportSettings, setExportSettings] = useState<ExportSettings | null>(null);
  const [exportPatch, setExportPatch] = useState<Partial<ExportSettings>>({});
  const aiDraft = useAiSettingsDraft();
  const project = useEditorStore(s => s.project);
  const layout = useDockStore(s => s.layout);
  useEffect(() => {
    let alive = true;
    void beginSettingsPreview().then(preview => {
      if (!alive) { preview.cancel(); return; }
      session.current = preview;
      setText(editDraftSafe(preview.text, useDockStore.getState().layout));
    }).catch(error => { if (alive) setError(t("settings.unreadable", { detail: formatUiError(error) })); });
    if (project) void loadExportSettings(project.name).then(settings => { if (alive) setExportSettings(settings); });
    return () => { alive = false; session.current?.cancel(); };
  // The world cannot change behind the modal; its starting identity owns export defaults.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const change = (next: string) => {
    setText(next); setError(null);
    try {
      draftObject(next);
      const parsed = parseSettings(next, SHORTCUTS, getLocale());
      if (parsed.settings.layout) useDockStore.getState().update(parsed.settings.layout, false);
      setLocale(parsed.settings.locale);
    } catch { /* Advanced retains invalid text until fixed or cancelled. */ }
  };
  const patch = (value: Record<string, unknown>) => { if (text !== null) change(editDraft(text, value)); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (text === null || !session.current || busy) return;
    if (aiDraft.connection && (!aiDraft.snapshot || !validAgentPort(aiDraft.port))) { setError(t("ai.settings.invalidPort")); return; }
    setBusy(true); onBusyChange(true); setError(null);
    let aiReceipt: Awaited<ReturnType<typeof commitAiSettings>> = null;
    try {
      draftObject(text);
      if (aiDraft.connection && aiDraft.snapshot) aiReceipt = await commitAiSettings(aiDraft.connection, aiDraft.snapshot, { enabled: aiDraft.enabled, port: Number(aiDraft.port) });
      const problems = await session.current.save(text);
      if (aiReceipt) aiDraft.acceptSnapshot(aiReceipt.snapshot);
      if (exportSettings && Object.keys(exportPatch).length) { await updateExportSettings(exportSettings.project, exportPatch); useExportStore.getState().bump(); }
      if (!problems.length) toast.success(t("settings.saved"));
      onDone();
    } catch (error) {
      if (aiReceipt) {
        try { await aiReceipt.rollback(); if (aiDraft.connection) aiDraft.acceptSnapshot(await aiDraft.connection.getSettings()); }
        catch { setError(t("ai.settings.saveFailed")); return; }
      }
      if (error instanceof AiSettingsError) {
        if (error.snapshot) aiDraft.acceptSnapshot(error.snapshot);
        setError(error.code === "CONFLICT" ? t("ai.settings.conflict") : error.code === "PORT_IN_USE" ? t("ai.settings.portInUse", { port: Number(aiDraft.port) }) : error.code === "INVALID_ARGUMENT" ? t("ai.settings.invalidPort") : t("ai.settings.saveFailed"));
      } else setError(t(error instanceof SyntaxError ? "settings.invalidJson" : "settingsUi.saveFailed", { detail: formatUiError(error) }));
    }
    finally { setBusy(false); onBusyChange(false); }
  };
  let valid = true;
  if (text !== null) { try { draftObject(text); } catch { valid = false; } }
  const parsed = parseSettings(text ?? "{}", SHORTCUTS, getLocale());
  const title = (id: Category) => id === "ai" ? t("ai.title") : t(`settingsUi.${id}` as MessageKey);
  return <form onSubmit={event => void submit(event)} className="settings-form flex min-h-0 flex-1 flex-col" noValidate>
    <DialogHeader title={t("settings.dialogTitle")} subtitle={t("settings.dialogDescription")} onClose={() => { if (!busy) onDone(); }} />
    <div className="settings-content flex min-h-0 flex-1">
      <div ref={sidebar} role="tablist" aria-label={t("settingsUi.categories")} aria-orientation="vertical" className="settings-sidebar shrink-0 overflow-y-auto border-r border-line-subtle p-2" onKeyDown={event => {
        const current = SETTINGS_CATEGORIES.indexOf(category);
        const next = event.key === "Home" ? 0 : event.key === "End" ? SETTINGS_CATEGORIES.length - 1 : event.key === "ArrowDown" ? (current + 1) % SETTINGS_CATEGORIES.length : event.key === "ArrowUp" ? (current + SETTINGS_CATEGORIES.length - 1) % SETTINGS_CATEGORIES.length : null;
        if (next === null) return;
        event.preventDefault(); setCategory(SETTINGS_CATEGORIES[next]!); sidebar.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
      }}>{SETTINGS_CATEGORIES.map(id => <button key={id} type="button" role="tab" id={`settings-tab-${id}`} data-settings-category={id} aria-selected={category === id} aria-controls="settings-section" tabIndex={category === id ? 0 : -1} onClick={() => setCategory(id)} className={`flex min-h-control-md w-full items-center rounded-sm px-2 text-left text-sm ${category === id ? "bg-active text-title" : "text-muted hover:bg-hover hover:text-text"}`}>{title(id)}</button>)}</div>
      <div className="settings-narrow-category px-4 pb-2"><NativeSelect aria-label={t("settingsUi.categories")} value={category} onChange={event => setCategory(event.target.value as Category)}>{SETTINGS_CATEGORIES.map(id => <option key={id} value={id}>{title(id)}</option>)}</NativeSelect></div>
      <div id="settings-section" role="tabpanel" aria-label={title(category)} data-dialog-body="" className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pt-2 pb-4" tabIndex={0}>
        <h2 className="mb-3 flex min-h-control-md items-center text-md font-semibold text-title">{title(category)}</h2>
        {text === null ? <p className="text-sm text-muted">{t("settingsUi.loading")}</p> : <fieldset disabled={busy} className="min-w-0">
          {!valid && category !== "advanced" ? <p role="alert" className="text-sm text-danger">{t("settingsUi.fixJson")}</p> : <>
            {category === "ai" && <AiSection draft={aiDraft} onBusyChange={value => { setBusy(value); onBusyChange(value); }} />}
            {category === "general" && <GeneralSection />}
            {category === "appearance" && <AppearanceSection layout={layout} onChange={layout => patch({ layout })} />}
            {category === "panels" && <PanelsSection layout={layout} onChange={layout => patch({ layout })} />}
            {category === "shortcuts" && <ShortcutsSection overrides={parsed.settings.shortcuts} onChange={overrides => { if (text !== null) change(editShortcutDraft(text, overrides)); }} />}
            {category === "language" && <LanguageSection locale={parsed.settings.locale} onChange={locale => patch({ locale })} />}
            {category === "export" && <ExportSection settings={exportSettings} onChange={value => { setExportPatch(current => ({ ...current, ...value })); setExportSettings(current => current ? { ...current, ...value } : null); }} />}
            {category === "advanced" && <AdvancedSection text={text} onChange={change} onReset={() => change(editDraft(defaultSettingsText(SHORTCUTS, getLocale()), { layout: defaultDockLayout() }))} />}
          </>}
        </fieldset>}
      </div>
    </div>
    {error && <p role="alert" className="shrink-0 px-4 pb-2 text-sm text-danger">{error}</p>}
    <DialogFooter><Button variant="secondary" disabled={busy} onClick={onDone}>{t("settings.dialogCancel")}</Button><Button variant="primary" type="submit" disabled={text === null || busy || !!aiDraft.connection && (!aiDraft.snapshot || !validAgentPort(aiDraft.port))}>{t("settings.dialogSave")}</Button></DialogFooter>
  </form>;
}
function editDraftSafe(text: string, layout: DockLayout): string {
  try { return editDraft(text, { layout }); } catch { return text; }
}
