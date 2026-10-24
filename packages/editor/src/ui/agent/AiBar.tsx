import { useEffect, useRef, useSyncExternalStore } from "react";
import { t } from "../../i18n";
import { useUiStore } from "../uiStore";
import { Button } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { Tooltip } from "../primitives/Tooltip";
import { locatePanel } from "../layout/dockModel";
import { useDockStore } from "../layout/dockStore";
import { useAgentUiState } from "../../agent/agentUiState";
import { agentActivity } from "../../agent/activity";
import { selectAiControls } from "./selectors";
import { activityDockLayout, revealAiActivity } from "./activityDock";
import { performAiAction } from "./actions";

export function AiBar() {
  const { phase, transaction: active, actionPending: applying } = useAgentUiState();
  const entries = useSyncExternalStore(agentActivity.subscribe, agentActivity.entries);
  const layout = useDockStore(s => s.layout);
  const panelsHidden = useUiStore(s => s.panelsHidden);
  const activityAt = locatePanel(layout, "aiActivity");
  const activityOpen = !panelsHidden && !!activityAt && layout.zones[activityAt.zone].state === "expanded" && layout.zones[activityAt.zone].groups[activityAt.group]?.active === "aiActivity";
  const controls = selectAiControls(phase, applying);
  const collaboration = active?.collaboration;
  const approveLabel = t(collaboration ? "ai.collaboration.approve" : "ai.action.approve");
  const approvalBlocked = !!collaboration?.fault;
  const approvalDescription = approvalBlocked ? "ai-recovery-reason" : applying ? "ai-applying-reason" : undefined;
  const seenActivity = useRef(false);
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!seenActivity.current && (entries.length || active)) {
      seenActivity.current = true;
      // Do not exit temporary canvas mode, move keyboard focus, or repeatedly steal a tab.
      useDockStore.getState().update(activityDockLayout(useDockStore.getState().layout));
    }
  }, [entries.length, active]);
  return <>
    <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">{t(`ai.status.${phase}`)}</span>
    {controls.visible && <div ref={bar} data-ai-bar tabIndex={-1} className="@container flex h-optionsbar shrink-0 items-center gap-2 border-b border-line-subtle bg-panel px-2 text-sm">
      <Icon name="history" size={16} className="shrink-0 text-muted" />
      <div className="min-w-0 flex-1 truncate text-text" title={`${t(`ai.status.${phase}`)} ${active?.owner.clientInfo.name ?? ""} ${active?.label ?? ""}`}>
        <span>{t(`ai.status.${phase}`)}</span>
        {collaboration ? <span className="ml-2 text-muted">{t("ai.collaboration.members", { count: collaboration.members.length })}</span> : active && <span className="ml-2 text-muted" title={t("ai.client.nameVersion", { ...active.owner.clientInfo })}>{active.owner.clientInfo.name}{active.owner.clientSessionId === null && phase !== "orphaned" && <> · {t("ai.client.disconnected")}</>}</span>}
      </div>
      {active && !collaboration && <span className="hidden shrink-0 text-muted @lg:inline" title={t("ai.transaction.maps", { count: active.affectedMapIds.length })}>{t("ai.transaction.cells", { count: active.counters.changedCells })}</span>}
      <Button size="sm" disabled={!controls.stop} onClick={() => performAiAction("stop")}>{t(collaboration ? "ai.collaboration.stopAll" : "ai.action.stop")}</Button>
      <Tooltip label={approvalBlocked ? t("ai.collaboration.recoveryRequired") : applying ? t("ai.blocked.applying") : approveLabel}><span className="flex"><Button size="sm" aria-describedby={approvalDescription} disabled={!controls.approve || approvalBlocked} onClick={() => performAiAction("approve")}>{approveLabel}</Button></span></Tooltip>
      <Button size="sm" disabled={!controls.discard} onClick={() => performAiAction("discard")}>{t(collaboration ? "ai.collaboration.discard" : "ai.action.discard")}</Button>
      <Button size="sm" variant="ghost" aria-pressed={activityOpen} onClick={() => {
        if (activityOpen) useDockStore.getState().hidePanel("aiActivity"); else revealAiActivity();
      }}>{t("ai.action.activity")}</Button>
      {approvalBlocked && <span id="ai-recovery-reason" role={activityOpen ? undefined : "alert"} className="sr-only">{t("ai.collaboration.recoveryRequired")}</span>}
      {applying && <span id="ai-applying-reason" className="sr-only">{t("ai.blocked.applying")}</span>}
    </div>}
  </>;
}
