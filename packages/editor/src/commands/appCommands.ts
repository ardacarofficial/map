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
import type { ToolId } from "../state/editorStore";
import { copySelection, cutSelection, deleteSelection, flipStampOrTile, pasteFromSystem } from "./clipboard";
import {
  activeLayer,
  canCopy,
  canDeselect,
  canErase,
  canFlip,
  canPaste,
  canRedo,
  canRemoveLayer,
  canSelectAll,
  canUndo,
  contextOf,
  type EditContext,
} from "./enablement";
import { addLayer, removeLayer } from "./layerActions";
import { addCollisionLayer } from "./terrainActions";

const hasProject = () => useEditorStore.getState().project !== null;
const editor = () => useEditorStore.getState();
const ui = () => useUiStore.getState();
const ctx = (): EditContext => contextOf(editor());
const when = (predicate: (c: EditContext) => boolean) => () => predicate(ctx());
const tool = (id: ToolId): Command => ({
  id: `tool.${id}`,
  title: `commands.tool.${id}`,
  category: "tool",
  enabled: hasProject,
  run: () => editor().setTool(id),
});
const markDirty = () => {
  if (!editor().dirty) editor().setDirty(true);
};

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

  {
    id: "file.openBackup",
    title: "commands.file.openBackup",
    category: "file",
    enabled: hasProject,
    run: () => ui().setBackupsOpen(true),
  },
  {
    id: "tileset.markSolid",
    title: "commands.tileset.markSolid",
    category: "tileset",
    enabled: () => hasProject() && (editor().project?.store.document.tilesets.length ?? 0) > 0,
    run: () => ui().toggleTilesetMode("solid"),
  },
  {
    id: "tileset.defineTerrain",
    title: "commands.tileset.defineTerrain",
    category: "tileset",
    enabled: () => hasProject() && (editor().project?.store.document.tilesets.length ?? 0) > 0,
    run: () => ui().toggleTilesetMode("terrain"),
  },
  // ---- Edit
  {
    id: "edit.undo",
    title: "commands.edit.undo",
    category: "edit",
    enabled: when(canUndo),
    run: () => {
      if (editor().project?.store.undo()) markDirty();
    },
  },
  {
    id: "edit.redo",
    title: "commands.edit.redo",
    category: "edit",
    enabled: when(canRedo),
    run: () => {
      if (editor().project?.store.redo()) markDirty();
    },
  },
  { id: "edit.cut", title: "commands.edit.cut", category: "edit", enabled: when(canErase), run: () => void cutSelection() },
  { id: "edit.copy", title: "commands.edit.copy", category: "edit", enabled: when(canCopy), run: () => void copySelection() },
  { id: "edit.paste", title: "commands.edit.paste", category: "edit", enabled: when(canPaste), run: () => void pasteFromSystem() },
  { id: "edit.delete", title: "commands.edit.delete", category: "edit", enabled: when(canErase), run: () => void deleteSelection() },
  {
    id: "edit.selectAll",
    title: "commands.edit.selectAll",
    category: "edit",
    enabled: when(canSelectAll),
    run: () => {
      const map = editor().project?.store.document.map;
      if (map) editor().setRegion({ x: 0, y: 0, width: map.width, height: map.height });
    },
  },
  {
    id: "edit.deselect",
    title: "commands.edit.deselect",
    category: "edit",
    enabled: when(canDeselect),
    // Esc peels one thing at a time: the marquee first, then the stamp.
    run: () => (editor().region ? editor().setRegion(null) : editor().setStamp(null)),
  },
  { id: "edit.flipX", title: "commands.edit.flipX", category: "edit", enabled: when(canFlip), run: () => void flipStampOrTile("x") },
  { id: "edit.flipY", title: "commands.edit.flipY", category: "edit", enabled: when(canFlip), run: () => void flipStampOrTile("y") },
  // ---- Layers / map
  { id: "layer.add", title: "commands.layer.add", category: "layer", enabled: hasProject, run: () => void addLayer() },
  {
    id: "layer.addCollision",
    title: "commands.layer.addCollision",
    category: "layer",
    enabled: hasProject,
    run: () => void addCollisionLayer(),
  },
  {
    id: "layer.remove",
    title: "commands.layer.remove",
    category: "layer",
    enabled: when(canRemoveLayer),
    run: () => {
      const layer = activeLayer(ctx());
      if (layer) removeLayer(layer.id);
    },
  },
  { id: "map.resize", title: "commands.map.resize", category: "map", enabled: hasProject, run: () => ui().setResizeOpen(true) },
  // ---- Tools
  tool("brush"),
  tool("eraser"),
  tool("fill"),
  tool("rect"),
  tool("select"),
  tool("eyedropper"),

  // ---- View
  {
    id: "view.toggleCollision",
    title: "commands.view.toggleCollision",
    category: "view",
    enabled: hasProject,
    run: () => editor().toggleCollisionOverlay(),
  },
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
