import { manualEditAllowed } from "../agent/editGate";
import { cellPaletteIndex, isTileLayer, planTileReplacement, type MapStore, type PaletteEntry, type TileReplacementWrites } from "@smap/core";
import { create } from "zustand";

import { t } from "../i18n";
import { useEditorStore, type ToolId } from "../state/editorStore";
import { captureSelectionScope } from "./selectionScope";
import { registerCommands } from "./registry";

export type ReplacementScope = "selection" | "active" | "visible";
export interface ReplacementDraft {
  readonly store: MapStore;
  readonly from: PaletteEntry | null;
  readonly to: PaletteEntry | null;
  readonly scope: ReplacementScope;
  readonly picking: "from" | "to" | null;
  readonly previousTool: ToolId;
}

export const useTileReplacement = create<{ draft: ReplacementDraft | null }>(() => ({ draft: null }));
const lastRightClick = new WeakMap<MapStore, PaletteEntry>();

/** Current brush identity, including a transformed single-tile stamp. */
export function replacementBrushTile(): PaletteEntry | null {
  const s = useEditorStore.getState();
  if (s.stamp) {
    for (const layer of s.stamp.layers) {
      if (layer.grid) continue;
      for (const cell of layer.cells) {
        const entry = s.stamp.palette[cellPaletteIndex(cell) - 1];
        if (entry) return entry;
      }
    }
  }
  return s.selection;
}

export function rememberReplacementTile(store: MapStore, tile: PaletteEntry): void {
  lastRightClick.set(store, { ...tile });
}

export function openTileReplacement(from?: PaletteEntry, to?: PaletteEntry | null): void {
  if (useTileReplacement.getState().draft) return;
  const s = useEditorStore.getState();
  const store = s.project?.store;
  if (!store || store.inTransaction) return;
  const brush = replacementBrushTile();
  useTileReplacement.setState({ draft: {
    store, from: from ?? lastRightClick.get(store) ?? brush, to: to === undefined ? brush : to,
    scope: s.region ? "selection" : "active", picking: null, previousTool: s.tool,
  } });
}

export function updateTileReplacement(patch: Partial<Pick<ReplacementDraft, "from" | "to" | "scope">>): void {
  const draft = useTileReplacement.getState().draft;
  if (draft) useTileReplacement.setState({ draft: { ...draft, ...patch } });
}

export function beginReplacementPick(target: "from" | "to"): void {
  const draft = useTileReplacement.getState().draft;
  if (!draft) return;
  useTileReplacement.setState({ draft: { ...draft, picking: target } });
  useEditorStore.getState().setTool("eyedropper");
}

export function cancelReplacementPick(): void {
  const draft = useTileReplacement.getState().draft;
  if (!draft) return;
  useTileReplacement.setState({ draft: { ...draft, picking: null } });
  useEditorStore.getState().setTool(draft.previousTool);
}

/** Pick adapters call this before changing the brush. A replacement pick edits only the draft. */
export function consumeReplacementPick(tile: PaletteEntry): boolean {
  const draft = useTileReplacement.getState().draft;
  if (!draft?.picking) return false;
  if (useEditorStore.getState().project?.store !== draft.store) { closeTileReplacement(); return true; }
  useTileReplacement.setState({ draft: { ...draft, [draft.picking]: { ...tile }, picking: null } });
  useEditorStore.getState().setTool(draft.previousTool);
  return true;
}

export function closeTileReplacement(): void {
  const draft = useTileReplacement.getState().draft;
  useTileReplacement.setState({ draft: null });
  if (draft?.picking) useEditorStore.getState().setTool(draft.previousTool);
}

/** Resolve live scope each time, so lock/visibility/selection changes are reflected in the count. */
export function replacementPlan(draft: ReplacementDraft): TileReplacementWrites[] {
  const s = useEditorStore.getState();
  if (s.project?.store !== draft.store || !draft.from || !draft.to) return [];
  if (draft.scope === "selection" && !s.region) return [];
  const doc = draft.store.document;
  const layerIds = draft.scope === "selection" ? captureSelectionScope(doc, () => undefined) : draft.scope === "visible" ? doc.layers.filter(isTileLayer).map(l => l.id) : s.activeLayerId ? [s.activeLayerId] : [];
  return planTileReplacement(doc, { from: draft.from, to: draft.to, layerIds,
    ...(draft.scope === "selection" && s.region ? { region: s.region } : {}),
  });
}

export function commitTileReplacement(): boolean {
  if (!manualEditAllowed()) return false;
  const draft = useTileReplacement.getState().draft;
  if (!draft?.to || draft.picking || draft.store.inTransaction || replacementPlan(draft).length === 0) return false;
  const { store, to } = draft;
  store.beginTransaction(t("replaceTiles.history"));
  try {
    store.getOrAddPaletteIndex(to.tilesetId, to.tileId);
    for (const plan of replacementPlan(draft)) store.dispatch({ type: "paintCells", ...plan });
    store.commit();
    useEditorStore.getState().setDirty(true);
    closeTileReplacement();
    return true;
  } catch (error) {
    store.rollback();
    throw error;
  }
}

export function registerTileReplacementCommand(): void {
  registerCommands([{ id: "edit.replaceTiles", title: "replaceTiles.title", category: "edit", enabled: () => {
    const s = useEditorStore.getState();
    return !!s.project && s.project.store.document.layers.some(l => isTileLayer(l) && l.visible && !l.locked);
  }, run: () => openTileReplacement() }]);
}
