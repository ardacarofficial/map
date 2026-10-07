/**
 * Desktop entry: the same editor as the browser build, started with the
 * Tauri platform. Window stays hidden until `startEditor` calls `appReady()`.
 */
import { startEditor } from "@smap/editor";

import { createDesktopPlatform } from "./desktopPlatform";

const root = document.getElementById("root");
if (!root) throw new Error("#root element not found");

void startEditor(root, { platform: createDesktopPlatform() });
