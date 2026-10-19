import { useEffect } from "react";
import { t } from "../../i18n";
import { recordedChord } from "./shortcutDraft";

import { setKeyRecording } from "./keyRecording";
export function KeyRecorder({ onKey, onCancel }: { onKey(key: string | null, event: KeyboardEvent): void; onCancel(): void }) {
  useEffect(() => {
    setKeyRecording(event => {
      if (event.repeat || event.isComposing) return;
      if (event.key === "Escape") { onCancel(); return; }
      if (event.key === "Backspace") { onKey(null, event); return; }
      const key = recordedChord(event);
      if (key) onKey(key, event);
    });
    return () => { setKeyRecording(null); };
  }, [onKey, onCancel]);
  return <span role="status" className="text-sm text-title">{t("settingsUi.recording")}</span>;
}
