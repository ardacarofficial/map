import { useSyncExternalStore } from "react";
import { editGate } from "../../agent/editGate";

/** Admission also covers preparation and approval, before UI phase updates arrive. */
export function usePendingAiEdit(): boolean {
  return useSyncExternalStore(editGate.subscribe, () => editGate.blocked);
}
