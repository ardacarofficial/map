/** Global capture routing shared by the recorder and app shortcut dispatcher. */
let recording: ((event: KeyboardEvent) => void) | null = null;
export function setKeyRecording(handler: ((event: KeyboardEvent) => void) | null): void { recording = handler; }
export function captureRecordedKey(event: KeyboardEvent): boolean {
  if (!recording) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  recording(event);
  return true;
}
