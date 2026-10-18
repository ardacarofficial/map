import { installSmartStamps } from "./commands/smartStampCommands";
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

import { registerTileReplacementCommand } from "./commands/replaceTiles";
import { registerAppCommands } from "./commands/appCommands";
import { registerSelectionPickCommands } from "./commands/selectionPick";
import { registerSelectionScopeCommands } from "./commands/selectionScope";
import { registerRotateCommands } from "./commands/rotateCommands";
import { registerHandToolCommand } from "./commands/handTool";
import { registerExportCommands } from "./commands/exportCommands";
import { installKeyboardLayout } from "./commands/keymap";
import { installAutoExport } from "./export/exportActions";
import { t } from "./i18n";
import { readSaveIndicator, subscribeSaveIndicator } from "./io/saveIndicator";
import { openProjectPath } from "./io/session";
import { browserPlatform, setPlatform, type Platform } from "./platform";
import { installSettingsReload, loadAppSettings, useAppSettings } from "./platform/appSettings";
import { installErrorLogging } from "./platform/errorLogging";
import { installFileChangeHandling } from "./platform/fileChanges";
import { registerSettingsCommands } from "./platform/settingsCommands";
import { registerProjectSettingsCommands } from "./ui/projectSettings/ProjectSettingsDialog";
import { SettingsDialog } from "./platform/SettingsDialog";
import { useEditorStore } from "./state/editorStore";
import { useUiStore } from "./ui/uiStore";
import { App } from "./ui";
import { installContextMenuGuard } from "./ui/contextMenuGuard";
import { preloadCanvas } from "./ui/canvas/loadCanvas";

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

function installTitle(platform: Platform): () => void {
  let last = "";
  const update = () => {
    const project = useEditorStore.getState().project;
    const app = t("app.name");
    const title = project ? `${readSaveIndicator().unsaved ? "● " : ""}${project.name} — ${app}` : app;
    if (title === last) return;
    last = title;
    platform.setTitle(title);
  };
  update();
  const a = subscribeSaveIndicator(update);
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
 * the OS passed one) starts opening behind the editor skeleton, and
 * `appReady()` shows the hidden window as soon as that first picture is
 * drawn (the project fills in while the window is already visible).
 */
export async function startEditor(rootElement: HTMLElement, options: StartEditorOptions = {}): Promise<void> {
  const marks: string[] = [`script ${Math.round(performance.now())}`];
  const mark = (name: string) => marks.push(`${name} ${Math.round(performance.now())}`);
  const platform = options.platform ?? browserPlatform;
  setPlatform(platform);
  installErrorLogging();
  installContextMenuGuard();
  // Shortcut labels follow the keyboard layout ("Ğ" for "[" on Turkish-Q); never waits long.
  const layoutReady = Promise.race([installKeyboardLayout().catch(() => undefined), timeout(100)]);
  registerAppCommands();
  installSmartStamps();
  registerSelectionScopeCommands();
  registerSelectionPickCommands();
  registerTileReplacementCommand();
  registerRotateCommands(); // after the app commands: replaces edit.flipX / flipY with the random-aware version
  registerHandToolCommand();
  registerExportCommands();
  registerSettingsCommands();
  registerProjectSettingsCommands();
  installAutoExport();

  await loadAppSettings().catch((error: unknown) => platform.log("warn", `settings: ${String(error)}`));
  await layoutReady;
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

  // A `.smap` from the command line: the window shows the editor frame
  // (skeleton, no welcome-screen flash) right away and the project fills it
  // in when read; later requests (second instance) open in place.
  let starting = true;
  try {
    await platform.onOpenFile((path) => {
      platform.log("info", `open request ${path}`);
      const opening = openProjectPath(path);
      if (!starting) return;
      useUiStore.getState().setStartupOpening(true);
      void opening.finally(() => {
        useUiStore.getState().setStartupOpening(false);
        mark("project open");
        platform.log("info", `startup project ms: ${marks.join(", ")}`);
      });
    });
  } catch (error) {
    platform.log("warn", `open requests unavailable: ${String(error)}`);
  }
  starting = false;

  mark("listening");
  // React has committed by now; one frame (or 50 ms in a hidden window, which gets no
  // frames) lets the first picture (welcome or skeleton) be painted when the window appears.
  await nextFrame();
  mark("ready");
  // Milliseconds since navigation start; the desktop's "< 1 s" budget.
  platform.log("info", `startup ms: ${marks.join(", ")}`);
  platform.appReady();
  // The welcome screen does not need the map canvas (PixiJS); fetch and parse it once idle.
  const idle = (window as { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(preloadCanvas, { timeout: 2000 });
  else setTimeout(preloadCanvas, 300);
}
