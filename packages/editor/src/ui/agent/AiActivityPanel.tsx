import { Fragment, useMemo, useState, useSyncExternalStore } from "react";
import type { ActivityLogEntry } from "@smap/agent";
import { getLocale, t } from "../../i18n";
import { Button } from "../primitives/Button";
import { TextField } from "../primitives/TextField";
import { useProjectLibrary } from "../../io/projectLibrary";
import { agentActivity, exportActivityMetrics } from "../../agent/activity";
import { deliverFile } from "../../export/exportActions";
import { toast } from "../toast/toastStore";
import { activityOutcome, groupActivity } from "./selectors";
import { agentErrorMessage } from "./errorMessages";
import { useAgentUiState } from "../../agent/agentUiState";
import { getLevelWorkspace } from "../../io/session";
import { CollaborationSummary } from "./CollaborationSummary";
import { AiReferences, DropHighlight, useReferenceIntake } from "./AiReferences";

export function AiActivityPanel() {
  const entries = useSyncExternalStore(agentActivity.subscribe, agentActivity.entries);
  const levels = useProjectLibrary(s => s.levels);
  const transaction = useAgentUiState(s => s.transaction);
  const collaboration = transaction && transaction.state !== "approved" && transaction.state !== "cancelled" ? transaction.collaboration : undefined;
  const mapName = (id: string) => levels.find(level => level.id === id)?.name ?? id;
  const [cleared, setCleared] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const intake = useReferenceIntake();
  const rows = useMemo(() => entries.filter(row => !cleared.has(row.id) && `${row.tool ?? ""} ${row.clientInfo?.name ?? ""} ${row.mapIds.join(" ")} ${row.mapIds.map(id => levels.find(level => level.id === id)?.name ?? id).join(" ")}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(-500), [entries, cleared, query, levels]);
  return <div className="relative flex min-h-0 flex-1 flex-col" data-ai-activity {...intake.handlers}>
    <DropHighlight over={intake.over} />
    <div className="flex h-control-md shrink-0 items-center gap-2 border-b border-line-subtle px-2">
      <TextField size="sm" leadingIcon="search" aria-label={t("ai.activity.search")} placeholder={t("ai.activity.search")} value={query} onChange={event => setQuery(event.target.value)} className="flex-1" />
      <Button size="sm" variant="ghost" disabled={!rows.length} onClick={() => {
        void deliverFile(new Blob([exportActivityMetrics(rows)], { type: "application/json" }), "smap-ai-diagnostics.json", { name: "JSON", extensions: ["json"] }).catch(() => toast.warning(t("ai.activity.exportFailed")));
      }}>{t("ai.activity.export")}</Button>
      <Button size="sm" variant="ghost" disabled={!entries.some(row => !cleared.has(row.id))} onClick={() => setCleared(new Set(entries.map(row => row.id)))}>{t("ai.activity.clear")}</Button>
    </div>
    <div className="min-h-0 flex-1 overflow-auto" role="region" aria-label={t("ai.activity.title")} tabIndex={0}>
      <AiReferences />
      {collaboration && <CollaborationSummary members={collaboration.members} fault={!!collaboration.fault} mapName={mapName} layerName={(mapId, layerId) => getLevelWorkspace()?.entry(mapId)?.store.document.getLayer(layerId)?.name ?? layerId} />}
      {!rows.length ? <p className="px-3 py-2 text-sm text-muted">{t("ai.activity.empty")}</p> : <table className="w-full text-left text-sm whitespace-nowrap">
        <thead className="text-muted"><tr>{(["time", "tool", "client", "map", "result", "duration"] as const).map(key => <th className="h-control-sm px-2 font-medium" scope="col" key={key}>{t(`ai.activity.${key}`)}</th>)}<th className="px-2 font-medium" scope="col">{t("ai.activity.changes")}</th></tr></thead>
        <tbody>{groupActivity(rows).map(group => <Fragment key={group.id}>
          {group.entries[0]?.transactionId && <tr data-ai-transaction={group.entries[0].transactionId} className="h-control-sm border-t border-line-subtle bg-active text-muted"><th scope="rowgroup" colSpan={7} className="px-2 text-left font-medium">{t("ai.transaction.label", { request: (group.entries.find(row => row.tool === "begin_edit")?.summary || group.entries[0].transactionId).slice(0, 256) })}</th></tr>}
          {group.entries.map(row => <ActivityRow key={row.id} row={row} entries={entries} mapNames={row.mapIds.map(mapName)} />)}
        </Fragment>)}</tbody>
      </table>}
    </div>
  </div>;
}
function ActivityRow({ row, entries, mapNames }: { row: ActivityLogEntry; entries: readonly ActivityLogEntry[]; mapNames: string[] }) {
  const outcome = activityOutcome(row, entries);
  const outcomeText = row.code ? agentErrorMessage(row.code) : t(`ai.activity.${outcome}`);
  return <tr data-ai-entry={row.id} data-ai-entry-member={row.memberId} className="h-control-sm border-t border-line-subtle text-muted">
    <td className="px-2"><time dateTime={new Date(row.timestamp).toISOString()}>{new Date(row.timestamp).toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></td>
    <td className="max-w-40 px-2 text-text"><details><summary className="cursor-pointer truncate" title={row.tool ?? t("ai.activity.details")}>{row.tool ?? t("ai.activity.details")}</summary><p className="max-w-80 py-1 text-wrap break-words text-muted">{row.summary.slice(0, 256)}</p></details></td>
    <td className="max-w-32 truncate px-2">{row.clientInfo?.name.slice(0, 128)}</td>
    <td className="max-w-40 truncate px-2" title={row.mapIds.join(", ")}>{mapNames.join(", ")}</td>
    <td className={`px-2 ${outcome === "rejected" ? "text-danger" : ""}`}>{outcomeText}</td>
    <td className="px-2 tabular-nums">{t("ai.activity.durationValue", { count: Math.round(row.durationMs) })}</td>
    <td className="px-2 tabular-nums">{row.changedCells.toLocaleString(getLocale())}</td>
  </tr>;
}
