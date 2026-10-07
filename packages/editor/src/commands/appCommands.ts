/** Every command of the app, registered once at startup. */
import {
  addTilesetFiles,
  closeProject,
  confirmDiscard,
  openProjectFromPicker,
  saveCurrentProject,
} from "../io/session";
import { useEditorStore } from "../state/editorStore";
import { getCanvasHandle } from "../ui/canvas/canvasHandle";
import { useUiStore } from "../ui/uiStore";
import { pickFiles } from "../ui/pickFiles";
import { registerCommands, type Command } from "./registry";

const hasProject = () => useEditorStore.getState().project !== null;
const editor = () => useEditorStore.getState();
const ui = () => useUiStore.getState();

/** Asks the canvas to act; no-op while it is still starting. */
const canvas = (fn: (h: NonNullable<ReturnType<typeof getCanvasHandle>>) => void) => () => {
  const handle = getCanvasHandle();
  if (handle) fn(handle);
};

const COMMANDS: Command[] = [
  // ---- File
  {
    id: "file.new",
    title: "commands.file.new",
    category: "file",
    run: () => {
      void confirmDiscard().then((ok) => ok && ui().setNewProjectOpen(true));
    },
  },
  { id: "file.open", title: "commands.file.open", category: "file", run: () => void openProjectFromPicker() },
  {
    id: "file.save",
    title: "commands.file.save",
    category: "file",
    enabled: hasProject,
    run: () => void saveCurrentProject(false),
  },
  {
    id: "file.saveAs",
    title: "commands.file.saveAs",
    category: "file",
    enabled: hasProject,
    run: () => void saveCurrentProject(true),
  },
  {
    id: "file.close",
    title: "commands.file.close",
    category: "file",
    enabled: hasProject,
    run: () => {
      void confirmDiscard().then((ok) => ok && closeProject());
    },
  },

  // ---- Tileset
  {
    id: "tileset.add",
    title: "commands.tileset.add",
    category: "tileset",
    enabled: hasProject,
    run: () => {
      void pickFiles("image/png").then((files) => addTilesetFiles(files));
    },
  },

  // ---- Tools
  { id: "tool.brush", title: "commands.tool.brush", category: "tool", enabled: hasProject, run: () => editor().setTool("brush") },
  { id: "tool.eraser", title: "commands.tool.eraser", category: "tool", enabled: hasProject, run: () => editor().setTool("eraser") },

  // ---- View
  { id: "view.toggleGrid", title: "commands.view.toggleGrid", category: "view", enabled: hasProject, run: () => editor().toggleGrid() },
  { id: "view.togglePanels", title: "commands.view.togglePanels", category: "view", enabled: hasProject, run: () => ui().togglePanels() },
  { id: "view.zoomIn", title: "commands.view.zoomIn", category: "view", enabled: hasProject, run: canvas((h) => h.zoomIn()) },
  { id: "view.zoomOut", title: "commands.view.zoomOut", category: "view", enabled: hasProject, run: canvas((h) => h.zoomOut()) },
  { id: "view.zoomReset", title: "commands.view.zoomReset", category: "view", enabled: hasProject, run: canvas((h) => h.zoomReset()) },
  { id: "view.frameMap", title: "commands.view.frameMap", category: "view", enabled: hasProject, run: canvas((h) => h.frameMap()) },

  // ---- General
  {
    id: "palette.open",
    title: "commands.palette.open",
    category: "general",
    inPalette: false,
    run: () => ui().setPaletteOpen(!ui().paletteOpen),
  },
];

let registered = false;

export function registerAppCommands(): void {
  if (registered) return;
  registered = true;
  registerCommands(COMMANDS);
}
