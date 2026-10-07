/**
 * Sends uncaught errors, unhandled rejections and the editor's own
 * `console.error` / `console.warn` reports to the platform log (desktop: the
 * log file). In the browser the log *is* the console, so only the uncaught
 * handlers are added there.
 */
import { getPlatform } from "./index";

let installed = false;

function describe(value: unknown): string {
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function installErrorLogging(): void {
  if (installed) return;
  installed = true;
  const platform = getPlatform();
  window.addEventListener("error", (e) => {
    platform.log("error", `uncaught: ${e.error ? describe(e.error) : e.message} @ ${e.filename}:${e.lineno}:${e.colno}`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    platform.log("error", `unhandled rejection: ${describe(e.reason)}`);
  });
  if (platform.kind === "browser") return;
  for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      try {
        platform.log(level, args.map(describe).join(" "));
      } catch {
        // Logging must never break the caller.
      }
    };
  }
}
