import type { CollaborationMemberSummary, TransactionCounters } from "@smap/agent";
import { t, type MessageKey } from "../../i18n";

/** The presentation subset of a collaborative member; no member actions live here. */
export type CollaborationParticipant = Pick<CollaborationMemberSummary, "id" | "clientInfo" | "role" | "state" | "detached" | "claims"> & {
  counters: Pick<TransactionCounters, "changedCells">;
};
const statusKeys: Record<CollaborationParticipant["state"], MessageKey> = {
  running: "ai.collaboration.running", ready: "ai.collaboration.ready", stopped: "ai.collaboration.stopped",
  cancelling: "ai.collaboration.cancelling", cancelled: "ai.collaboration.cancelled",
};

export function CollaborationSummary({ members, mapName, layerName, fault = false }: {
  members: readonly CollaborationParticipant[];
  fault?: boolean;
  mapName(id: string): string;
  layerName(mapId: string, layerId: string): string;
}) {
  return <section data-ai-collaboration className="@container flex shrink-0 flex-col border-b border-line-subtle" aria-label={t("ai.collaboration.title")}>
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 pt-2">
      <h3 className="text-sm font-medium text-text">{t("ai.collaboration.title")}</h3>
      <span className="text-xs text-muted">{t("ai.collaboration.members", { count: members.length })}</span>
    </div>
    <p role={fault ? "alert" : undefined} className={`px-3 pt-1 pb-2 text-xs ${fault ? "text-warning" : "text-muted"}`}>{t(fault ? "ai.collaboration.recoveryRequired" : "ai.collaboration.review")}</p>
    <ul className="grid grid-cols-1 gap-2 px-3 pb-3 @lg:grid-cols-2 @4xl:grid-cols-4">
      {members.map(member => <li key={member.id} data-ai-member={member.id} className="min-w-0 rounded-sm border border-line-subtle bg-field p-2">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium text-text">{member.clientInfo.name}</p>{member.role === "coordinator" && <span className="text-xs text-faint">{t("ai.collaboration.coordinator")}</span>}</div>
          <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs"><span className={member.state === "running" ? "text-accent" : "text-muted"}>{t(member.role === "coordinator" && member.state === "running" && member.claims.length === 0 ? "ai.collaboration.preparing" : statusKeys[member.state])}</span>{member.detached && <span className="text-faint">{t("ai.collaboration.disconnected")}</span>}</div>
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted">
          <span>{member.state === "cancelled" ? t("ai.collaboration.removed") : t("ai.transaction.cells", { count: member.counters.changedCells })}</span>
          {member.detached && member.state !== "cancelled" && member.state !== "cancelling" && <span>{t("ai.collaboration.retained")}</span>}
        </div>
        {member.claims.length > 0 && <details className="mt-2 border-t border-line-subtle pt-1 text-xs text-muted">
          <summary className="cursor-pointer py-1 outline-offset-2 focus-visible:outline focus-visible:outline-accent">{t(member.state === "cancelled" ? "ai.collaboration.claimsReleased" : "ai.collaboration.claims")} · {member.claims.length}</summary>
          <ul className="flex flex-col gap-2 pt-1">{member.claims.map((claim, index) => <li key={index} className="min-w-0">
            <p className="break-words text-text">{mapName(claim.mapId)}</p>
            <p className="break-words text-muted">{claim.layerIds.map(id => layerName(claim.mapId, id)).join(", ")}</p>
            <p className="mt-0.5 font-mono text-xs text-faint">{claim.region.x}, {claim.region.y} · {claim.region.width} × {claim.region.height}</p>
          </li>)}</ul>
        </details>}
      </li>)}
    </ul>
  </section>;
}
