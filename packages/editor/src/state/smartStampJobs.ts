/** Source-image bakes serialize with each other; saves wait for the complete dependency chain. */
let pending = Promise.resolve();
export function queueSmartStampRegeneration(task: () => Promise<void>, onError: (error: unknown) => void): void {
  pending = pending.then(task).catch(onError);
}
export async function waitForSmartStampRegeneration(): Promise<void> {
  let observed: Promise<void>;
  do { observed = pending; await observed; } while (pending !== observed);
}
