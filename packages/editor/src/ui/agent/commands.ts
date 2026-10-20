import { useEffect } from "react";
import { registerCommands } from "../../commands/registry";
import { useAppSettings } from "../../platform/appSettings";
import { revealAiActivity } from "./activityDock";
import { useAgentUiState } from "../../agent/agentUiState";
import { performAiAction } from "./actions";
import { selectAiControls } from "./selectors";
import { openAiTags, selectedAiTagTarget } from "./tagsSelection";

/** Uses the app's existing dispatcher, including user-assigned keys. */
export function useAiCommands(): void {
  useEffect(() => {
    const controls = () => { const { phase, actionPending } = useAgentUiState.getState(); return selectAiControls(phase, actionPending); };
    registerCommands([
      ...(["stop", "approve", "discard"] as const).map(action => ({ id: `ai.${action}` as const, title: `ai.action.${action}` as const, category: "edit" as const, enabled: () => controls()[action], run: () => performAiAction(action) })),
      { id: "view.aiActivity", title: "ai.activity.title", category: "view", run: () => { revealAiActivity(); } },
      { id: "panel.aiActivity.show", title: "ai.activity.title", category: "view", run: () => { revealAiActivity(); } },
      { id: "ai.openSettings", title: "ai.action.openSettings", category: "general", run: () => { useAppSettings.setState({ settingsCategory: "ai", dialogOpen: true }); } },
      { id: "ai.editTags", title: "ai.action.editTags", category: "edit", enabled: () => !!selectedAiTagTarget(), run: openAiTags },
    ]);
  }, []);
}
