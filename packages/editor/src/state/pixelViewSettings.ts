import type { MapStore, PixelPoint } from '@smap/core';
import { resolveBookmarkWorld } from '../extras/bookmarkWorld';
import { getLevelWorkspace, getProjectFolder, onProjectSaved } from '../io/session';
import type { LevelWorkspace } from '../io/levelWorkspace';
import { useEditorStore } from './editorStore';
import { usePixelUi } from './pixelUi';
interface Preferences { h: boolean; v: boolean; origin?: PixelPoint }
interface Context { ref: unknown; world: string; preferences: Map<string, Preferences>; ready: Promise<void> }
const key = (world: string, map: string) => `smap-pixel-view:${JSON.stringify([world, map])}`;
function read(world: string, map: string): Preferences | undefined {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key(world, map)) ?? 'null');
    if (!value || typeof value !== 'object' || !('h' in value) || !('v' in value) || typeof value.h !== 'boolean' || typeof value.v !== 'boolean') return;
    const origin = 'origin' in value ? value.origin as PixelPoint : undefined;
    if (origin && (!Number.isFinite(origin.x) || !Number.isFinite(origin.y))) return;
    return { h: value.h, v: value.v, ...(origin ? { origin: { x: origin.x, y: origin.y } } : {}) };
  } catch { return; }
}
function write(world: string, map: string, prefs: Preferences): void {
  try { localStorage.setItem(key(world, map), JSON.stringify(prefs)); } catch { /* View settings remain available for this session. */ }
}
function clamp(prefs: Preferences, store: MapStore): Preferences {
  const map = store.document.map, origin = prefs.origin;
  return { ...prefs, ...(origin ? { origin: { x: Math.max(0, Math.min(map.width * map.tileWidth - 1, origin.x)), y: Math.max(0, Math.min(map.height * map.tileHeight - 1, origin.y)) } } : {}) };
}
/** View state follows world/map identity. The WeakMap is only the controller cache. */
export function installPixelViewSettings(): () => void {
  const worlds = new WeakMap<LevelWorkspace, Context>();
  let stopped = false, applying = false, active: { ws: LevelWorkspace; map: string; store: MapStore; context: Context } | null = null;
  let offStore = () => {};
  function context(ws: LevelWorkspace): Context {
    const ref = getProjectFolder()?.ref, previous = worlds.get(ws);
    if (previous && previous.ref === ref) return previous;
    const value: Context = { ref, world: `session:${crypto.randomUUID()}`, preferences: new Map(previous?.preferences), ready: Promise.resolve() };
    worlds.set(ws, value);
    value.ready = resolveBookmarkWorld(ref).then(world => {
      if (stopped || !world || worlds.get(ws) !== value) return;
      value.world = world;
      for (const map of ws.levels) {
        const prefs = value.preferences.get(map.id);
        if (prefs) write(world, map.id, prefs); // First save and Save As migrate the view.
        else { const saved = read(world, map.id); if (saved) value.preferences.set(map.id, saved); }
      }
      if (active?.ws === ws) refresh();
    });
    return value;
  }
  function apply(): void {
    if (!active) return;
    const { context: c, map, store } = active;
    const prefs = clamp(c.preferences.get(map) ?? { h: false, v: false }, store);
    const ui = usePixelUi.getState(); applying = true;
    if (prefs.origin) ui.mirrorOrigins.set(store, prefs.origin); else ui.mirrorOrigins.delete(store);
    usePixelUi.setState({ mirrorH: prefs.h, mirrorV: prefs.v, originRevision: ui.originRevision + 1 });
    applying = false;
  }
  function capture(): void {
    if (applying || !active) return;
    const { context: c, map, store } = active, ui = usePixelUi.getState(), origin = ui.mirrorOrigins.get(store);
    const prefs = clamp({ h: ui.mirrorH, v: ui.mirrorV, ...(origin ? { origin } : {}) }, store);
    c.preferences.set(map, prefs); write(c.world, map, prefs);
    if (origin && (prefs.origin!.x !== origin.x || prefs.origin!.y !== origin.y)) apply();
  }
  function refresh(): void {
    if (stopped) return;
    const ws = getLevelWorkspace(), project = useEditorStore.getState().project;
    offStore(); offStore = () => {};
    if (!ws || !project?.levelId || project.levelId.startsWith('stamp:')) { active = null; return; }
    active = { ws, map: project.levelId, store: project.store, context: context(ws) };
    apply();
    offStore = project.store.subscribe(event => { if (event.structure.includes('map')) { capture(); apply(); } });
  }
  const offUi = usePixelUi.subscribe((s, prev) => { if (s.mirrorH !== prev.mirrorH || s.mirrorV !== prev.mirrorV || s.originRevision !== prev.originRevision) capture(); });
  const offEditor = useEditorStore.subscribe((s, prev) => { if (s.project !== prev.project) refresh(); });
  const offSaved = onProjectSaved(() => { refresh(); return active?.context.ready; });
  refresh();
  return () => { stopped = true; offUi(); offEditor(); offSaved(); offStore(); };
}
