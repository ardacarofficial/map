import { admitEditorSave, editGate } from "../agent/editGate";
/** Source-image bakes serialize with each other; saves wait for the complete dependency chain. */
let pending = Promise.resolve();
export function queueSmartStampRegeneration(task: () => Promise<void>, onError: (error: unknown) => void): void {
  if (editGate.blocked) return;
  const admission = admitEditorSave();
  pending = pending.then(async () => { admission.assertAllowed(); await task(); }).catch(onError).finally(() => admission.release());
}
export async function waitForSmartStampRegeneration(): Promise<void> {
  let observed: Promise<void>;
  do { observed = pending; await observed; } while (pending !== observed);
}
