/**
 * Editor entry point shared by the browser build (`main.tsx`) and the
 * desktop shell (`packages/desktop/src/main.ts`). The host decides only the
 * `Platform`; everything else is the same app.
 */
import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono";
import "./index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { registerAppCommands } from "./commands/appCommands";
import { registerExportCommands } from "./commands/exportCommands";
import { installAutoExport } from "./export/exportActions";
import { t } from "./i18n";
import { openProjectPath } from "./io/session";
import { browserPlatform, getPlatform, setPlatform, type Platform } from "./platform";
import { installSettingsReload, loadAppSettings, useAppSettings } from "./platform/appSettings";
import { installErrorLogging } from "./platform/errorLogging";
import { installFileChangeHandling } from "./platform/fileChanges";
import { registerSettingsCommands } from "./platform/settingsCommands";
import { SettingsDialog } from "./platform/SettingsDialog";
import { useEditorStore } from "./state/editorStore";
import { App } from "./ui";
import { getCanvasHandle } from "./ui/canvas/canvasHandle";

export interface StartEditorOptions {
  platform?: Platform;
}

/** Re-renders the whole tree when the language or key bindings change (no remount: the canvas keeps its camera). */
function Root() {
  useAppSettings((s) => s.revision);
  return (
    <>
      <App />
      <SettingsDialog />
    </>
  );
}

function timeout(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The next frame, or 50 ms: a hidden window (the desktop starts hidden until
 * `appReady`) gets no animation frames in WebKitGTK / WebView2, so waiting
 * for a real frame there would only end at Rust's 3 s fallback.
 */
function nextFrame(): Promise<void> {
  return Promise.race([new Promise<void>((resolve) => requestAnimationFrame(() => resolve())), timeout(50)]);
}

/** Resolves once the canvas has mounted (or after `limitMs`), plus a frame for its first draw. */
async function canvasDrawn(limitMs: number): Promise<void> {
  const start = performance.now();
  while (!getCanvasHandle() && performance.now() - start < limitMs) await nextFrame();
  await nextFrame();
  await nextFrame();
}

function installTitle(platform: Platform): () => void {
  let last = "";
  const update = () => {
    const { project, dirty } = useEditorStore.getState();
    const app = t("app.name");
    const title = project ? `${dirty ? "● " : ""}${project.name} — ${app}` : app;
    if (title === last) return;
    last = title;
    platform.setTitle(title);
  };
  update();
  const a = useEditorStore.subscribe(update);
  const b = useAppSettings.subscribe(update);
  return () => {
    a();
    b();
  };
}

/**
 * Starts the editor in `rootElement`. Order matters for the desktop's
 * "< 1 s to a usable window": settings (language) first so the first frame is
 * already in the right language, then render, then the startup `.smap` (if
 * the OS passed one), and only then `appReady()` shows the hidden window.
 */
export async function startEditor(rootElement: HTMLElement, options: StartEditorOptions = {}): Promise<void> {
  const marks: string[] = [`script ${Math.round(performance.now())}`];
  const mark = (name: string) => marks.push(`${name} ${Math.round(performance.now())}`);
  const platform = options.platform ?? browserPlatform;
  setPlatform(platform);
  installErrorLogging();
  registerAppCommands();
  registerExportCommands();
  registerSettingsCommands();
  installAutoExport();

  await loadAppSettings().catch((error: unknown) => platform.log("warn", `settings: ${String(error)}`));
  mark("settings");

  createRoot(rootElement).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );

  mark("render");
  installTitle(platform);
  installFileChangeHandling();
  installSettingsReload();

  // A `.smap` from the command line opens before the window appears (no
  // welcome-screen flash); later requests (second instance) open in place.
  let startupOpen: Promise<unknown> | null = null;
  try {
    await platform.onOpenFile((path) => {
      platform.log("info", `open request ${path}`);
      const opening = openProjectPath(path);
      startupOpen ??= opening;
    });
  } catch (error) {
    platform.log("warn", `open requests unavailable: ${String(error)}`);
  }

  mark("listening");
  await nextFrame();
  mark("frame");
  if (startupOpen) await Promise.race([startupOpen, timeout(2500)]);
  if (getPlatform().kind === "desktop" && useEditorStore.getState().project) await canvasDrawn(1500);
  else {
    await nextFrame();
  }
  mark("ready");
  // Milliseconds since navigation start; the desktop's "< 1 s" budget.
  platform.log("info", `startup ms: ${marks.join(", ")}`);
  platform.appReady();
}
