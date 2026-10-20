import { useState, useSyncExternalStore } from "react";
import type { AgentConnection, AgentConnectionStatus } from "@smap/agent";
import { t } from "../../i18n";
import { Button } from "../../ui/primitives/Button";
import { Segmented } from "../../ui/primitives/Segmented";
import { TextField } from "../../ui/primitives/TextField";
import { DialogToggle, FormField } from "../../ui/dialogs/DialogFrame";
import { toast } from "../../ui/toast/toastStore";
import { agentEndpoint, connectionSnippet, validAgentPort, type AgentClientFormat } from "../../ui/agent/connectionSnippet";
import { useAgentUi } from "../../ui/agent/agentUiAdapter";
import type { AiSettingsDraft } from "./aiSettingsDraft";

export function AiSection({ draft, onBusyChange }: { draft: AiSettingsDraft; onBusyChange(busy: boolean): void }) {
  if (!draft.connection) return <p data-ai-host-required className="text-sm text-muted">{t("ai.settings.hostRequired")}</p>;
  return <ConnectedAiSection draft={draft} connection={draft.connection} onBusyChange={onBusyChange} />;
}
function ConnectedAiSection({ draft, connection, onBusyChange }: { draft: AiSettingsDraft; connection: AgentConnection; onBusyChange(busy: boolean): void }) {
  const agentState = useAgentUi(s => s.state);
  const status = useSyncExternalStore(listener => connection.subscribeStatus(listener), () => connection.status);
  const [client, setClient] = useState<AgentClientFormat>("claude");
  const [token, setToken] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const run = async (operation: () => Promise<void>, failure: "ai.settings.copyFailed" | "ai.settings.regenerateFailed" | "ai.settings.secretUnavailable") => {
    if (working) return;
    setWorking(true); onBusyChange(true); setNotice(null);
    try { await operation(); } catch { setNotice(t(failure)); }
    finally { setWorking(false); onBusyChange(false); }
  };
  return <section className="flex flex-col gap-3" data-ai-settings>
    <fieldset disabled={working || !draft.snapshot} className="flex min-w-0 flex-col gap-3">
      <div className="flex min-h-control-md items-center justify-between gap-3 text-sm"><span>{t("ai.settings.enabled")}</span><DialogToggle label={t("ai.settings.enabled")} checked={draft.enabled} onChange={draft.setEnabled} /></div>
      <FormField label={t("ai.settings.port")} htmlFor="ai-port" error={!validAgentPort(draft.port) ? t("ai.settings.invalidPort") : undefined}>
        <TextField id="ai-port" inputMode="numeric" value={draft.port} aria-invalid={!validAgentPort(draft.port)} onChange={event => draft.setPort(event.target.value)} />
      </FormField>
      <FormField label={t("ai.settings.endpoint")}><p className="break-all text-sm text-text" data-ai-endpoint>{agentEndpoint(status.port)}</p></FormField>
      <p role="status" aria-live="polite" className={`text-sm ${status.state === "failed" || status.state === "portInUse" ? "text-danger" : "text-muted"}`}>{agentState.transaction ? t(`ai.status.${agentState.phase}`) : connectionStatusText(status)}</p>
      {agentState.transaction && <p className="truncate text-sm text-muted">{t("ai.client.writer")}: {agentState.transaction.owner.clientInfo.name}</p>}
      {status.clients.length > 0 && <ul aria-label={t("ai.client.count", { count: status.clients.length })} className="text-sm text-text">{status.clients.map((entry, index) => <li key={index} className="truncate" title={t("ai.client.nameVersion", { ...entry })}>{t("ai.client.nameVersion", { name: entry.name.slice(0, 128), version: entry.version.slice(0, 64) })}</li>)}</ul>}
      <FormField label={t("ai.settings.token")}>
        <div className="flex flex-wrap items-center gap-2">
          <TextField aria-label={t("ai.settings.token")} type={token === null ? "password" : "text"} readOnly value={token ?? "••••••••••••••••"} className="min-w-0 flex-1" autoComplete="off" spellCheck={false} />
          <Button aria-pressed={token !== null} onClick={() => {
            if (token !== null) setToken(null);
            else void run(async () => setToken(await connection.revealToken()), "ai.settings.secretUnavailable");
          }}>{t(token === null ? "ai.settings.reveal" : "ai.settings.hide")}</Button>
          <Button onClick={() => void run(() => connection.copyToken(), "ai.settings.copyFailed")}>{t("ai.settings.copyToken")}</Button>
          <Button onClick={() => setConfirming(true)}>{t("ai.settings.regenerate")}</Button>
        </div>
      </FormField>
      {confirming && <div role="group" aria-label={t("ai.settings.regenerate")} className="flex flex-wrap items-center gap-2 text-sm">
        <p className="w-full text-muted">{t("ai.settings.regenerateConfirm")}</p>
        <Button onClick={() => setConfirming(false)}>{t("common.cancel")}</Button>
        <Button onClick={() => void run(async () => {
          if (!draft.snapshot) return;
          try {
            const latest = await connection.regenerateToken(draft.snapshot.revision);
            // Rotation updates the revision without committing the listener draft.
            draft.acceptSnapshot(latest); draft.setEnabled(draft.enabled); draft.setPort(draft.port);
            setToken(null); setConfirming(false); toast.info(t("ai.settings.tokenRegenerated"));
          } catch (error) {
            // Re-read the revision, retaining the user's unsaved listener fields.
            const latest = await connection.getSettings();
            draft.acceptSnapshot(latest); draft.setEnabled(draft.enabled); draft.setPort(draft.port);
            throw error;
          }
        }, "ai.settings.regenerateFailed")}>{t("ai.settings.regenerate")}</Button>
      </div>}
      <FormField label={t("ai.settings.clientFormat")}>
        <Segmented<AgentClientFormat> size="md" label={t("ai.settings.clientFormat")} value={client} onValueChange={setClient} items={[{ value: "claude", label: t("ai.settings.clientClaude") }, { value: "codex", label: t("ai.settings.clientCodex") }]} />
      </FormField>
      <Button className="self-start" onClick={() => void run(async () => {
        const secret = await connection.revealToken();
        await navigator.clipboard.writeText(connectionSnippet(client, status.port, secret));
        toast.success(t("ai.settings.copied"));
      }, "ai.settings.copyFailed")}>{t("ai.settings.copy")}</Button>
      <p className="text-sm text-muted">{t("ai.settings.previewsShared")}</p>
    </fieldset>
    {draft.loadFailed && <p role="alert" className="text-sm text-danger">{t("ai.settings.saveFailed")}</p>}
    {notice && <p role="alert" className="text-sm text-danger">{notice}</p>}
  </section>;
}
function connectionStatusText(status: AgentConnectionStatus): string {
  if (status.state === "portInUse") return t("ai.settings.portInUse", { port: status.port });
  if (status.state === "failed") return t("ai.settings.bindFailed");
  return t(`ai.status.${status.state === "listening" ? "ready" : status.state}`);
}
