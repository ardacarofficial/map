import { useEffect } from "react";
import { registerCommands } from "../../commands/registry";
import { useAppSettings } from "../../platform/appSettings";
import { revealAiActivity } from "./activityDock";
import { useAgentUi } from "./agentUiAdapter";
import { performAiAction } from "./actions";
import { selectAiControls } from "./selectors";
import { openAiTags, selectedAiTagTarget } from "./tagsSelection";

/** Uses the app's existing dispatcher, including user-assigned keys. */
export function useAiCommands(): void {
  useEffect(() => {
    const controls = () => { const { state, applying } = useAgentUi.getState(); return selectAiControls(state.phase, applying); };
    registerCommands([
      ...(["stop", "approve", "discard"] as const).map(action => ({ id: `ai.${action}` as const, title: `ai.action.${action}` as const, category: "edit" as const, enabled: () => controls()[action], run: () => performAiAction(action) })),
      { id: "view.aiActivity", title: "ai.activity.title", category: "view", run: () => { revealAiActivity(); } },
      { id: "panel.aiActivity.show", title: "ai.activity.title", category: "view", run: () => { revealAiActivity(); } },
      { id: "ai.openSettings", title: "ai.action.openSettings", category: "general", run: () => { useAppSettings.setState({ settingsCategory: "ai", dialogOpen: true }); } },
      { id: "ai.editTags", title: "ai.action.editTags", category: "edit", enabled: () => !!selectedAiTagTarget(), run: openAiTags },
    ]);
  }, []);
}
