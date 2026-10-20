import { manualEditAllowed } from "../../agent/editGate";
/**
 * The stamp editor session (round 5): one stamp open in its own document
 * tab ("Stamp: <ad>"). While its tab is active the editor store's project
 * holds the stamp's temporary store (`levelId` = `stamp:<id>`), so every
 * tool, undo and the layer panel work on it unchanged. The project's level
 * workspace never sees that store: it is not saved, autosaved, exported or
 * listed (see `stampDoc.ts`).
 *
 * Switching to a map tab keeps the session (its tab stays, edits and undo
 * history included); "Kaydet" writes the stamp and closes it, "Vazgeç"
 * discards; closing the tab with unsaved changes asks first. The world map
 * and the export dialog always work on levels: opening either leaves the
 * stamp tab first.
 */
import type { MapStore, Stamp } from "@smap/core";
import { create } from "zustand";

import { replaceStampContent } from "../../commands/stampActions";
import { setCanvasView, useWorldView } from "../../commands/worldActions";
import { useExportStore } from "../../export/exportStore";
import { t } from "../../i18n";
import { withProjectData } from "../../io/levelWorkspace";
import { useProjectLibrary } from "../../io/projectLibrary";
import { getLevelWorkspace, notifyUnsavedGuards, openLevel, registerUnsavedGuard, setLeaveTemporaryDocument } from "../../io/session";
import { useEditorStore, type OpenProject } from "../../state/editorStore";
import { toast } from "../toast/toastStore";
import { isStampLevelId, missingStampTilesets, stampEditStore, stampFromDocument, stampLevelId } from "./stampDoc";

export interface StampEditSession {
  readonly stampId: string;
  /** Stamp name when opened (the tab label follows renames through the library). */
  readonly name: string;
  store: MapStore;
  /** `store.revision` when it last matched the library stamp. */
  savedRevision: number;
  /** The store was rebuilt (project data changed) after edits: still unsaved. */
  rebuiltDirty: boolean;
}

export interface StampEditorState {
  session: StampEditSession | null;
  /** The stamp tab is the one shown on the canvas. */
  active: boolean;
  /** Bumped when the session's dirty state may have changed (tab dot, banner). */
  version: number;
}

export const useStampEditor = create<StampEditorState>()(() => ({ session: null, active: false, version: 0 }));

export type StampCloseChoice = "save" | "discard" | "cancel";

/** The pending "save the stamp?" question (shown by `StampCloseDialog`). */
export const useStampCloseAsk = create<{ request: { name: string; resolve(choice: StampCloseChoice): void } | null }>()(() => ({ request: null }));

function askStampClose(name: string): Promise<StampCloseChoice> {
  return new Promise((resolve) => {
    useStampCloseAsk.getState().request?.resolve("cancel");
    useStampCloseAsk.setState({
      request: {
        name,
        resolve: (choice) => {
          useStampCloseAsk.setState({ request: null });
          resolve(choice);
        },
      },
    });
  });
}

/** Workspace the session belongs to (another project, or the same one reloaded, ends it). */
let sessionWorkspace: unknown = null;
/** Active layer of the map that was shown before the stamp tab (restored on leaving). */
let returnLayerId: string | null = null;
/** Active layer of the stamp tab (restored when it is shown again). */
let stampLayerId: string | null = null;
let unwatchStore: (() => void) | null = null;

function bump(): void {
  useStampEditor.setState((s) => ({ version: s.version + 1 }));
  notifyUnsavedGuards();
}

/** True when the open stamp differs from the library's version. */
export function isStampSessionDirty(session: StampEditSession | null = useStampEditor.getState().session): boolean {
  return !!session && (session.rebuiltDirty || session.store.revision !== session.savedRevision);
}

function libraryStamp(id: string): Stamp | undefined {
  return useProjectLibrary.getState().stamps.find((s) => s.id === id);
}

/** Display name of the session's stamp (follows renames). */
export function sessionStampName(session: StampEditSession): string {
  return libraryStamp(session.stampId)?.name ?? session.name;
}

/** The active level's own project (store from the workspace), for leaving the stamp tab. */
function levelProject(): OpenProject | null {
  const ws = getLevelWorkspace();
  const current = useEditorStore.getState().project;
  const entry = ws?.entry(ws.activeId);
  if (!ws || !current || !entry) return null;
  return { name: current.name, store: entry.store, levelPath: ws.activeLevel.path, levelId: ws.activeId };
}

function watchSessionStore(session: StampEditSession): void {
  unwatchStore?.();
  let wasDirty = isStampSessionDirty(session);
  unwatchStore = session.store.subscribe(() => {
    const dirty = isStampSessionDirty(session);
    if (dirty !== wasDirty) {
      wasDirty = dirty;
      bump();
    }
  });
}

function dropSession(): void {
  unwatchStore?.();
  unwatchStore = null;
  sessionWorkspace = null;
  stampLayerId = null;
  useStampEditor.setState((s) => ({ session: null, active: false, version: s.version + 1 }));
  notifyUnsavedGuards();
}

/** Shows the stamp tab's store on the canvas. */
function showSession(session: StampEditSession): void {
  const editor = useEditorStore.getState();
  const project = editor.project;
  if (!project) return;
  if (!isStampLevelId(project.levelId)) returnLayerId = editor.activeLayerId;
  if (useWorldView.getState().view === "world") setCanvasView("level");
  // The level's project data may have changed meanwhile (a tileset added): the stamp picks it up.
  const level = levelProject();
  if (level) {
    const wasDirty = isStampSessionDirty(session);
    const before = session.store;
    const next = withProjectData(before, level.store.document);
    if (next !== before) {
      session.rebuiltDirty = wasDirty;
      session.store = next;
      session.savedRevision = next.revision;
      watchSessionStore(session);
    } else if (!wasDirty) {
      // Tilesets added in place are not an edit of the stamp.
      session.savedRevision = next.revision;
    }
  }
  useStampEditor.setState({ active: true });
  editor.switchLevel(
    { name: project.name, store: session.store, levelPath: project.levelPath, levelId: stampLevelId(session.stampId) },
    stampLayerId,
  );
}

/**
 * "Düzenle": opens a library stamp in its own tab (or shows its tab again).
 * Another stamp's open tab is closed first (asks when it has unsaved changes).
 */
export async function openStampEditor(stampId: string): Promise<boolean> {
  if (!manualEditAllowed()) return false;
  const stamp = libraryStamp(stampId);
  const editor = useEditorStore.getState();
  if (!stamp || !editor.project) return false;
  if (editor.project.store.inTransaction) return false;
  const current = useStampEditor.getState().session;
  if (current && current.stampId === stampId) {
    if (!useStampEditor.getState().active) showSession(current);
    return true;
  }
  if (current && !(await closeStampEditor())) return false;
  const level = levelProject();
  if (!level) return false;
  const missing = missingStampTilesets(stamp, level.store.document);
  if (missing.length > 0) {
    toast.error(t("tilesetLib.stampRemovedTileset", { name: stamp.name }));
    return false;
  }
  let store: MapStore;
  try {
    store = stampEditStore(stamp, level.store.document);
  } catch (error) {
    console.error(error);
    toast.error(t("stampEditor.openFailed", { name: stamp.name, detail: error instanceof Error ? error.message : String(error) }));
    return false;
  }
  const session: StampEditSession = { stampId, name: stamp.name, store, savedRevision: store.revision, rebuiltDirty: false };
  sessionWorkspace = getLevelWorkspace();
  stampLayerId = null;
  useStampEditor.setState((s) => ({ session, version: s.version + 1 }));
  watchSessionStore(session);
  showSession(session);
  return true;
}

/**
 * Shows the active map again (the stamp tab stays open in the background).
 * New tilesets added while the stamp was shown are added to the map too, so
 * the saved stamp can always be placed there.
 */
export function leaveStampEditor(): void {
  const state = useStampEditor.getState();
  if (!state.active) return;
  const editor = useEditorStore.getState();
  const level = levelProject();
  if (state.session && isStampLevelId(editor.project?.levelId)) stampLayerId = editor.activeLayerId;
  useStampEditor.setState({ active: false });
  if (!level) return;
  if (state.session) {
    const doc = level.store.document;
    for (const tileset of state.session.store.document.tilesets) {
      if (!doc.getTileset(tileset.id)) level.store.dispatch({ type: "addTileset", tileset, undoable: false });
    }
  }
  if (isStampLevelId(editor.project?.levelId)) editor.switchLevel(level, returnLayerId);
}

/** Opens a map from a document tab / the project tree, leaving the stamp tab first. */
export async function showLevelFromStamp(levelId: string): Promise<boolean> {
  leaveStampEditor();
  return openLevel(levelId);
}

/**
 * "Kaydet": writes the open stamp (cropped to its content) into the
 * library and closes the tab. An empty stamp is not saved (warning).
 * Returns true when saved.
 */
export function saveStampEditor(): boolean {
  if (!manualEditAllowed()) return false;
  const session = useStampEditor.getState().session;
  if (!session) return false;
  const stamp = libraryStamp(session.stampId);
  if (!stamp) {
    toast.error(t("stampEditor.gone"));
    return false;
  }
  if (session.store.inTransaction) return false;
  let content: Stamp | null;
  try {
    content = stampFromDocument(session.store.document, { id: stamp.id, name: stamp.name });
  } catch (error) {
    console.error(error);
    toast.error(t("toast.stampFailed", { detail: error instanceof Error ? error.message : String(error) }));
    return false;
  }
  if (!content) {
    toast.warning(t("stampEditor.empty"));
    return false;
  }
  const saved = replaceStampContent(stamp.id, content);
  if (!saved) return false;
  leaveStampEditor();
  dropSession();
  toast.success(t("stampEditor.saved", { name: saved.name }));
  return true;
}

/** "Vazgeç": closes the tab without saving. */
export function discardStampEditor(): void {
  if (!useStampEditor.getState().session) return;
  leaveStampEditor();
  dropSession();
}

/**
 * Closes the stamp tab (× / middle click); asks "Kaydet / Kaydetme / Vazgeç"
 * when it has unsaved changes. Returns true when the tab is closed.
 */
export async function closeStampEditor(): Promise<boolean> {
  const session = useStampEditor.getState().session;
  if (!session) return true;
  if (isStampSessionDirty(session)) {
    const choice = await askStampClose(sessionStampName(session));
    if (choice === "cancel") return false;
    if (choice === "save") return saveStampEditor();
  }
  if (useStampEditor.getState().session !== session) return true;
  discardStampEditor();
  return true;
}

/**
 * Keeps the session in step with the app: another level or project shown
 * means the stamp tab is not active any more; another project (or the
 * project closed) ends the session; the world map and the export dialog
 * leave the stamp tab. Call once at startup; returns a cleanup.
 */
export function installStampEditor(): () => void {
  const offEditor = useEditorStore.subscribe((state, prev) => {
    if (state.project === prev.project) return;
    const { session, active } = useStampEditor.getState();
    if (!session) return;
    if (!state.project || getLevelWorkspace() !== sessionWorkspace) {
      dropSession();
      return;
    }
    const showing = state.project.store === session.store;
    if (active !== showing) useStampEditor.setState({ active: showing });
  });
  const offWorld = useWorldView.subscribe((state, prev) => {
    if (state.view === "world" && prev.view !== "world" && useStampEditor.getState().active) queueMicrotask(leaveStampEditor);
  });
  const offExport = useExportStore.subscribe((state, prev) => {
    if (state.open && !prev.open && useStampEditor.getState().active) leaveStampEditor();
  });
  // A deleted stamp closes its tab (nothing left to save into).
  const offLibrary = useProjectLibrary.subscribe((state, prev) => {
    const session = useStampEditor.getState().session;
    if (state.stamps === prev.stamps || !session) return;
    if (!state.stamps.some((s) => s.id === session.stampId)) discardStampEditor();
    else bump();
  });
  // Closing the window / opening another project asks about an unsaved stamp first.
  const offGuard = registerUnsavedGuard({ dirty: () => isStampSessionDirty(), settle: closeStampEditor });
  setLeaveTemporaryDocument(leaveStampEditor);
  return () => {
    setLeaveTemporaryDocument(null);
    offGuard();
    offEditor();
    offWorld();
    offExport();
    offLibrary();
  };
}
