import type { DockLayout } from "../ui/layout/dockModel";
import { formatSettings } from "./settings";

/** A broken user file is never replaced by a layout preference. */
export function mergeLayoutSettings(text: string | null, layout: DockLayout, defaults: string): string | null {
  try {
    const raw: unknown = JSON.parse(text?.trim() ? text : defaults);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    return formatSettings({ ...raw as Record<string, unknown>, layout });
  } catch { return null; }
}
/** All settings writers use this queue: transforms read the file after earlier writes finish. */
export class SettingsWriteQueue {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private read: () => Promise<string | null>, private write: (text: string) => Promise<void>) {}
  update(transform: (text: string | null) => string | null): Promise<string | null> {
    const job = this.tail.then(async () => {
      const next = transform(await this.read());
      if (next !== null) await this.write(next);
      return next;
    });
    this.tail = job.catch(() => undefined);
    return job;
  }
  async idle(): Promise<void> { await this.tail; }
}
