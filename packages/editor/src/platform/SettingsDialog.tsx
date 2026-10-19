import { lazy, Suspense, useState } from "react";
import { useAppSettings } from "./appSettings";

const SettingsPopup = lazy(() => import("./settingsUi/SettingsPopup").then(module => ({ default: module.SettingsPopup })));

/** Load the editors on first open; keep the popup mounted for close/focus transitions. */
export function SettingsDialog() {
  const open = useAppSettings(state => state.dialogOpen);
  const [wanted, setWanted] = useState(open);
  if (open && !wanted) setWanted(true);
  return wanted ? <Suspense fallback={null}><SettingsPopup /></Suspense> : null;
}
