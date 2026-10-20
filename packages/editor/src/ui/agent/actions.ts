import { t } from "../../i18n";
import { toast } from "../toast/toastStore";
import { useAgentUiState } from "../../agent/agentUiState";
export function performAiAction(action: "stop" | "approve" | "discard"): void {
  const origin = typeof document === "undefined" ? null : document.activeElement;
  const fromBar = typeof HTMLElement !== "undefined" && origin instanceof HTMLElement && !!origin.closest("[data-ai-bar]");
  void useAgentUiState.getState()[action]().catch(() => toast.error(t("ai.action.failed"))).finally(() => {
    // Keep focus if the user moved it while the action was pending. Only restore lost bar focus.
    if (fromBar) requestAnimationFrame(() => {
      if (document.activeElement === document.body) document.querySelector<HTMLElement>("[data-canvas-host]")?.focus({ preventScroll: true });
    });
  });
}
