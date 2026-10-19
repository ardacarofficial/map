import { create } from 'zustand';
import { notifyPaletteEntriesChanged, registerCommands, registerPaletteProvider, runCommand } from '../commands/registry';
import type { CommandId } from '../shortcuts/shortcuts';
import { t } from '../i18n';
import { getLevelWorkspace, getProjectFolder, onProjectSaved } from '../io/session';
import { useEditorStore } from '../state/editorStore';
import { getCanvasHandle } from '../ui/canvas/canvasHandle';
import { askText } from '../ui/tileset/TextPrompt';
import { toast } from '../ui/toast/toastStore';
import { resolveBookmarkWorld } from './bookmarkWorld';
import type { LevelWorkspace } from '../io/levelWorkspace';
import { BookmarkRepository, clampBookmarkView, type CameraBookmark } from './bookmarks';

export const BOOKMARK_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export const useBookmarks = create<{ entries: readonly CameraBookmark[]; selected: string | null }>()(() => ({ entries: [], selected: null }));
let repository = new BookmarkRepository(null);
interface WorldContext { world: string; durable: boolean; ref: unknown; ready: Promise<void> }
const worlds = new WeakMap<LevelWorkspace, WorldContext>();
function worldContext(ws: LevelWorkspace): WorldContext {
  const ref = getProjectFolder()?.ref;
  const previous = worlds.get(ws);
  if (previous && previous.ref === ref) return previous;
  const value: WorldContext = { world: `session:${crypto.randomUUID()}`, durable: false, ref, ready: Promise.resolve() };
  worlds.set(ws, value);
  value.ready = resolveBookmarkWorld(ref).then(world => {
    if (!world || worlds.get(ws) !== value) return;
    const from = previous?.world ?? value.world;
    for (const map of ws.levels) {
      const entries = repository.read(from, map.id);
      // Only a session moving to its first saved folder migrates bookmarks.
      if (entries.length && (!previous || !previous.durable)) repository.write(world, map.id, entries);
    }
    value.world = world;
    value.durable = true;
    if (getLevelWorkspace() === ws) publish();
  });
  return value;
}

function context() {
  const ws = getLevelWorkspace(), project = useEditorStore.getState().project;
  if (!ws || !project?.levelId || !ws.level(project.levelId)) return null;
  const world = worldContext(ws);
  return { ws, map: project.levelId, world: world.world, durable: world.durable, project, ready: world.ready };
}
function publish(): void {
  const c = context();
  useBookmarks.setState({ entries: c ? repository.read(c.world, c.map) : [], selected: null });
}
function write(entries: readonly CameraBookmark[]): void {
  const c = context();
  if (!c) return;
  const stored = repository.write(c.world, c.map, entries);
  if (!stored || !c.durable) toast.info(t('bookmarks.sessionOnly'));
  useBookmarks.setState({ entries });
}
export async function addBookmark(): Promise<void> {
  await context()?.ready;
  const c = context(), canvas = getCanvasHandle();
  if (!c || !canvas || canvas.getView() !== 'level') return;
  const view = canvas.captureView();
  if (!view) return;
  const name = await askText({ title: t('bookmarks.add'), label: t('bookmarks.name'), initial: '', confirm: t('bookmarks.confirmAdd') });
  const next = context();
  if (!name || next?.ws !== c.ws || next.map !== c.map) return;
  write([...useBookmarks.getState().entries, { id: crypto.randomUUID(), name, ...view }]);
}
function selected(): CameraBookmark | undefined { const s = useBookmarks.getState(); return s.entries.find(b => b.id === s.selected); }
export async function renameBookmark(): Promise<void> {
  const c = context(), bookmark = selected();
  if (!c || !bookmark) return;
  const name = await askText({ title: t('bookmarks.rename'), label: t('bookmarks.name'), initial: bookmark.name, confirm: t('common.save') });
  const next = context();
  if (!name || next?.ws !== c.ws || next.map !== c.map) return;
  write(useBookmarks.getState().entries.map(b => b.id === bookmark.id ? { ...b, name } : b));
}
export function deleteBookmark(): void {
  const bookmark = selected();
  if (bookmark) write(useBookmarks.getState().entries.filter(b => b.id !== bookmark.id));
}
export function jumpBookmark(): void {
  const c = context(), bookmark = selected(), canvas = getCanvasHandle();
  if (!c || !bookmark || !canvas) return;
  canvas.setView('level');
  canvas.restoreView(clampBookmarkView(bookmark, c.project.store.document.map));
}
export function bookmarkCommand(action: 'jump' | 'rename' | 'delete', id: string): void {
  useBookmarks.setState({ selected: id });
  runCommand(`bookmark.${action}`);
}
export function installBookmarkActions(): () => void {
  try { repository = new BookmarkRepository(localStorage); } catch { repository = new BookmarkRepository(null); }
  const offEntries = useBookmarks.subscribe((s, prev) => { if (s.entries !== prev.entries) notifyPaletteEntriesChanged(); });
  publish();
  const offEditor = useEditorStore.subscribe((s, prev) => {
    if (s.project !== prev.project) publish();
  });
  const offSaved = onProjectSaved(async () => { publish(); await context()?.ready; });
  registerCommands([
    { id: 'bookmark.add', title: 'bookmarks.add', category: 'view', enabled: () => !!context() && getCanvasHandle()?.getView() === 'level', run: () => { void addBookmark(); } },
    { id: 'bookmark.jump', title: 'bookmarks.jump', category: 'view', inPalette: false, enabled: () => !!selected(), run: jumpBookmark },
    { id: 'bookmark.rename', title: 'bookmarks.rename', category: 'view', inPalette: false, enabled: () => useBookmarks.getState().entries.length > 0, run: () => { if (!selected()) useBookmarks.setState({ selected: useBookmarks.getState().entries[0]!.id }); void renameBookmark(); } },
    { id: 'bookmark.delete', title: 'bookmarks.delete', category: 'view', inPalette: false, enabled: () => !!selected(), run: deleteBookmark },
    ...BOOKMARK_SLOTS.map(slot => ({ id: `bookmark.${slot}` as CommandId, title: `bookmarks.slot${slot}` as const, category: 'view' as const, inPalette: false, enabled: () => !!useBookmarks.getState().entries[slot - 1], run: () => { const b = useBookmarks.getState().entries[slot - 1]; if (b) bookmarkCommand('jump', b.id); } })),
  ]);
  const offProvider = registerPaletteProvider(() => useBookmarks.getState().entries.flatMap(bookmark => [
    { key: `bookmark:${bookmark.id}`, prefix: t('bookmarks.provider'), title: bookmark.name, run: () => bookmarkCommand('jump', bookmark.id) },
    { key: `bookmark-rename:${bookmark.id}`, prefix: t('bookmarks.rename'), title: bookmark.name, run: () => bookmarkCommand('rename', bookmark.id) },
    { key: `bookmark-delete:${bookmark.id}`, prefix: t('bookmarks.delete'), title: bookmark.name, run: () => bookmarkCommand('delete', bookmark.id) },
  ]));
  return () => { offEditor(); offSaved(); offEntries(); offProvider(); useBookmarks.setState({ entries: [], selected: null }); };
}
