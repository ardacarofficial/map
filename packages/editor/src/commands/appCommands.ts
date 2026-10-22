import { usePixelUi } from "../state/pixelUi";
import { registerPixelCommands } from "./pixelCommands";
/** Every command of the app, registered once at startup. */
import { canMoveHistory, moveHistory } from "../io/worldHistoryCommands";
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
import { openNewProjectDialog } from "../ui/dialogs/NewProjectDialog";
import { pickFiles } from "../ui/pickFiles";
import { registerCommands, type Command } from "./registry";
import { registerProjectCommands } from "../io/projectRename";
import type { ToolId } from "../state/editorStore";
import { canUseSelectionScope } from "./selectionScope";
import { copySelection, cutSelection, deleteSelection, flipStampOrTile, pasteFromSystem } from "./clipboard";
import {
  activeLayer,
  canDeselect,
  hasSelectedEntity,
  canFlip,
  canPaste,
  canRemoveLayer,
  canSelectAll,
  contextOf,
  type EditContext,
} from "./enablement";
import {
  addLayer,
  canMoveUnit,
  canRemoveUnit,
  duplicateLayer,
  mergeDownProblem,
  mergeLayerDown,
  moveUnit,
  removeUnit,
  startLayerRename,
  unitOf,
} from "./layerActions";
import { registerDockCommands } from "../ui/layout/dockCommands";
import { onDockReveal, useDockStore } from "../ui/layout/dockStore";
import { revealSection, useLayoutStore } from "../ui/layout/layoutStore";
import type { SectionId } from "../ui/layout/sections";
import { toast } from "../ui/toast/toastStore";
import { t } from "../i18n";
import { addCollisionLayer } from "./collisionActions";
import { addEntityLayer, deleteEntity } from "./entityActions";
import { canSaveSelectionStamp } from "./stampActions";
import { askRemoveLevel, duplicateLevel, openAdjacentLevel, openNewLevelDialog, useLevelUi } from "./levelActions";
import { getLevelWorkspace } from "../io/session";
import { isWorldView, setCanvasView } from "./worldActions";
import { focusRegion } from "../ui/layout/focusRegions";
import { openMapSettings } from "../ui/mapSettings/mapSettingsStore";

const hasProject = () => useEditorStore.getState().project !== null;
const editor = () => useEditorStore.getState();
/** A project is open and no portal target point is being picked. */
const noPick = () => hasProject() && useLevelUi.getState().pick === null;
const ui = () => useUiStore.getState();
const ctx = (): EditContext => contextOf(editor());
/** Map edits (tools, clipboard, selection) are off while the world map (v1.2) is shown. */
const when = (predicate: (c: EditContext) => boolean) => () => !isWorldView() && predicate(ctx());
const tool = (id: ToolId): Command => ({
  id: `tool.${id}`,
  title: id === "line" ? "pixel.line" : `commands.tool.${id}`,
  category: "tool",
  enabled: () => hasProject() && !isWorldView() && (usePixelUi.getState().mode === "tile" || id !== "entity"),
  run: () => editor().setTool(id),
});

/** Asks the canvas to act; no-op while it is still starting. */
const canvas = (fn: (h: NonNullable<ReturnType<typeof getCanvasHandle>>) => void) => () => {
  const handle = getCanvasHandle();
  if (handle) fn(handle);
};

/** Minimap state before Tab hid the panels (restored when they come back); `null` = not hidden by Tab. */
let minimapBeforeHide: boolean | null = null;

/** Tab: panels and the minimap hide together (the canvas alone stays). */
function togglePanels(): void {
  ui().togglePanels();
  const handle = getCanvasHandle();
  if (!handle) return;
  if (ui().panelsHidden) {
    minimapBeforeHide = handle.isMinimapVisible();
    handle.setMinimapVisible(false);
  } else if (minimapBeforeHide !== null) {
    handle.setMinimapVisible(minimapBeforeHide);
    minimapBeforeHide = null;
  }
}

const cycleRegion = (direction: 1 | -1) => {
  if (ui().panelsHidden) togglePanels();
  requestAnimationFrame(() => focusRegion(direction));
};

const layout = () => useLayoutStore.getState();
const activeDoc = () => editor().project?.store.document;
/** A layer command can act on the active layer (map view, no stroke running). */
const layerReady = () => hasProject() && !isWorldView() && !(editor().project?.store.inTransaction ?? true);

/** View menu check item for a right-column section. */
const sectionToggle = (id: SectionId, command: "view.toggleLevels" | "view.toggleProperties" | "view.toggleLayers"): Command => ({
  id: command,
  title: `commands.${command}`,
  category: "view",
  enabled: hasProject,
  checked: () => !layout().sections[id].hidden,
  run: () => {
    const hidden = !layout().sections[id].hidden;
    layout().setSectionHidden(id, hidden);
  },
});

/**
 * Ctrl+Shift+I. Selections are rectangles, so the only inversions that stay
 * one are "nothing selected → everything" and "everything → nothing"; for
 * a partial selection the command is disabled (palette / menu) and says why
 * when pressed.
 */
function invertSelection(): void {
  const map = activeDoc()?.map;
  if (!map) return;
  const region = editor().region;
  if (!region) {
    editor().setRegion({ x: 0, y: 0, width: map.width, height: map.height });
    if (editor().tool !== "select") editor().setTool("select");
    return;
  }
  if (region.x <= 0 && region.y <= 0 && region.x + region.width >= map.width && region.y + region.height >= map.height) {
    editor().setRegion(null);
    return;
  }
  toast.info(t("toast.invertNotRect"));
}

const COMMANDS: Command[] = [
  // ---- File
  {
    id: "file.new",
    title: "commands.file.new",
    category: "file",
    run: () => openNewProjectDialog(),
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
  // ---- Edit
  {
    id: "edit.undo",
    title: "commands.edit.undo",
    category: "edit",
    enabled: () => canMoveHistory("undo"),
    run: () => {
      void moveHistory("undo");
    },
  },
  {
    id: "edit.redo",
    title: "commands.edit.redo",
    category: "edit",
    enabled: () => canMoveHistory("redo"),
    run: () => {
      void moveHistory("redo");
    },
  },
  { id: "edit.cut", title: "commands.edit.cut", category: "edit", enabled: () => !isWorldView() && canUseSelectionScope(), run: () => void cutSelection() },
  { id: "edit.copy", title: "commands.edit.copy", category: "edit", enabled: () => !isWorldView() && canUseSelectionScope(), run: () => void copySelection() },
  { id: "edit.paste", title: "commands.edit.paste", category: "edit", enabled: when(canPaste), run: () => void pasteFromSystem() },
  {
    id: "edit.delete",
    title: "commands.edit.delete",
    category: "edit",
    enabled: when((c) => hasSelectedEntity(c) || canUseSelectionScope()),
    run: () => {
      const entityId = editor().selectedEntityId;
      if (entityId && hasSelectedEntity(ctx())) deleteEntity(entityId);
      else void deleteSelection();
    },
  },
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
    enabled: () => (hasProject() && isWorldView()) || canDeselect(ctx()),
    // Esc peels one thing at a time: the world map (back to the level), the selected entity, the marquee, then the stamp.
    run: () => {
      if (isWorldView()) setCanvasView("level");
      else if (editor().selectedEntityId) editor().setSelectedEntity(null);
      else if (editor().region) editor().setRegion(null);
      else editor().setStamp(null);
    },
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
    enabled: () => when(canRemoveLayer)() && canRemoveUnit(activeDoc(), editor().activeLayerId),
    run: () => {
      const layer = activeLayer(ctx());
      if (layer) removeUnit(layer.id);
    },
  },
  {
    id: "layer.duplicate",
    title: "commands.layer.duplicate",
    category: "layer",
    enabled: () => layerReady() && activeLayer(ctx()) !== undefined,
    run: () => {
      const id = editor().activeLayerId;
      if (id) duplicateLayer(id);
    },
  },
  {
    id: "layer.mergeDown",
    title: "commands.layer.mergeDown",
    category: "layer",
    enabled: () => layerReady() && mergeDownProblem(activeDoc(), editor().activeLayerId) === null,
    run: () => {
      const id = editor().activeLayerId;
      if (id) mergeLayerDown(id);
    },
  },
  {
    id: "layer.rename",
    title: "commands.layer.rename",
    category: "layer",
    enabled: () => hasProject() && !isWorldView() && activeLayer(ctx()) !== undefined,
    run: () => {
      const doc = activeDoc();
      const { unit } = doc ? unitOf(doc, editor().activeLayerId) : { unit: undefined };
      if (!unit) return;
      if (ui().panelsHidden) togglePanels();
      revealSection("layers");
      startLayerRename(unit.head.id);
    },
  },
  {
    id: "layer.moveUp",
    title: "commands.layer.moveUp",
    category: "layer",
    enabled: () => layerReady() && canMoveUnit(activeDoc(), editor().activeLayerId, "up"),
    run: () => {
      const id = editor().activeLayerId;
      if (id) moveUnit(id, "up");
    },
  },
  {
    id: "layer.moveDown",
    title: "commands.layer.moveDown",
    category: "layer",
    enabled: () => layerReady() && canMoveUnit(activeDoc(), editor().activeLayerId, "down"),
    run: () => {
      const id = editor().activeLayerId;
      if (id) moveUnit(id, "down");
    },
  },
  {
    id: "layer.addEntity",
    title: "commands.layer.addEntity",
    category: "layer",
    enabled: hasProject,
    run: () => void addEntityLayer(),
  },
  {
    id: "stamp.saveSelection",
    title: "commands.stamp.saveSelection",
    category: "edit",
    enabled: () => hasProject() && !isWorldView() && canSaveSelectionStamp(),
    run: () => ui().setSaveStampOpen(true),
  },
  {
    id: "entity.editTypes",
    title: "commands.entity.editTypes",
    category: "entity",
    enabled: hasProject,
    run: () => ui().setEntityTypesOpen(true),
  },
  { id: "map.settings", allowDuringEdit: true, title: "commands.map.settings", category: "map", enabled: hasProject, run: () => openMapSettings("name") },
  { id: "map.resize", allowDuringEdit: true, title: "commands.map.resize", category: "map", enabled: hasProject, run: () => openMapSettings("size") },
  // ---- Levels (v1.0)
  { id: "level.new", title: "commands.level.new", category: "level", enabled: noPick, run: () => openNewLevelDialog() },
  {
    id: "level.duplicate",
    title: "commands.level.duplicate",
    category: "level",
    enabled: noPick,
    run: () => {
      const id = editor().project?.levelId;
      if (id) void duplicateLevel(id);
    },
  },
  {
    id: "level.next",
    title: "commands.level.next",
    category: "level",
    enabled: () => noPick() && (getLevelWorkspace()?.levels.length ?? 0) > 1,
    run: () => void openAdjacentLevel(1),
  },
  {
    id: "level.previous",
    title: "commands.level.previous",
    category: "level",
    enabled: () => noPick() && (getLevelWorkspace()?.levels.length ?? 0) > 1,
    run: () => void openAdjacentLevel(-1),
  },
  {
    id: "edit.invertSelection",
    title: "commands.edit.invertSelection",
    category: "edit",
    enabled: () => {
      if (!hasProject() || isWorldView()) return false;
      const map = activeDoc()?.map;
      const r = editor().region;
      return !!map && (r === null || (!r.mask && r.x <= 0 && r.y <= 0 && r.x + r.width >= map.width && r.y + r.height >= map.height));
    },
    run: invertSelection,
  },
  {
    id: "level.remove",
    title: "commands.level.remove",
    category: "level",
    enabled: noPick,
    run: () => askRemoveLevel(editor().project?.levelId ?? null),
  },
  // ---- Tools
  tool("brush"),
  tool("eraser"),
  tool("fill"),
  tool("rect"),
  tool("select"),
  tool("eyedropper"),
  tool("entity"),
  tool("hand"),

  // ---- View
  {
    id: "view.toggleCollision",
    title: "commands.view.toggleCollision",
    category: "view",
    enabled: hasProject,
    checked: () => editor().collisionOverlay,
    run: () => editor().toggleCollisionOverlay(),
  },
  {
    id: "view.toggleGrid",
    title: "commands.view.toggleGrid",
    category: "view",
    enabled: hasProject,
    checked: () => editor().gridVisible,
    run: () => editor().toggleGrid(),
  },
  {
    id: "view.toggleLibrary",
    title: "commands.view.toggleLibrary",
    category: "view",
    enabled: () => hasProject() && !isWorldView(),
    checked: () => !layout().libraryCollapsed,
    run: () => {
      if (ui().panelsHidden) togglePanels();
      layout().toggleLibrary();
    },
  },
  {
    id: "view.toggleInspector",
    title: "commands.view.toggleInspector",
    category: "view",
    enabled: hasProject,
    checked: () => !layout().inspectorCollapsed,
    run: () => {
      if (ui().panelsHidden) togglePanels();
      layout().toggleInspector();
    },
  },
  sectionToggle("levels", "view.toggleLevels"),
  sectionToggle("properties", "view.toggleProperties"),
  sectionToggle("layers", "view.toggleLayers"),
  {
    id: "view.toggleRecent",
    title: "commands.view.toggleRecent",
    category: "view",
    enabled: hasProject,
    checked: () => !useDockStore.getState().layout.hiddenPanels.includes("recent"),
    run: () => { const s = useDockStore.getState(); if (s.layout.hiddenPanels.includes("recent")) s.reveal("recent"); else s.hidePanel("recent"); },
  },
  {
    id: "view.resetLayout",
    title: "commands.view.resetLayout",
    category: "view",
    enabled: hasProject,
    run: () => {
      if (ui().panelsHidden) togglePanels();
      layout().resetLayout();
      getCanvasHandle()?.setMinimapVisible(true);
      minimapBeforeHide = null;
    },
  },
  { id: "view.focusNextRegion", title: "commands.view.focusNextRegion", category: "view", enabled: hasProject, run: () => cycleRegion(1) },
  { id: "view.focusPrevRegion", title: "commands.view.focusPrevRegion", category: "view", enabled: hasProject, run: () => cycleRegion(-1) },
  { id: "view.togglePanels", title: "commands.view.togglePanels", category: "view", enabled: hasProject, run: togglePanels },
  {
    id: "view.toggleMinimap",
    title: "commands.view.toggleMinimap",
    category: "view",
    enabled: hasProject,
    checked: () => getCanvasHandle()?.isMinimapVisible() ?? false,
    run: canvas((h) => {
      h.setMinimapVisible(!h.isMinimapVisible());
      minimapBeforeHide = null;
    }),
  },
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
  registerPixelCommands();
  if (registered) return;
  registered = true;
  registerCommands(COMMANDS);
  onDockReveal(() => { if (ui().panelsHidden) togglePanels(); });
  registerDockCommands();
  registerProjectCommands();
}
