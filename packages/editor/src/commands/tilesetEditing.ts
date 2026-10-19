import { t } from "../i18n";
import { useEditorStore } from "../state/editorStore";
import { getTilesetImage } from "../state/tilesetImages";
import { useUiStore } from "../ui/uiStore";
import { copyPaletteSlots, clearPaletteSlots, copyTilesetTiles, pasteIntoPalette, renamePalette } from "../ui/palettes/paletteActions";
import { usePaletteStore } from "../ui/palettes/paletteStore";
import { openPalettePastePicker, requestPaletteTrim } from "../ui/palettes/paletteDialogsStore";
import { emptyTilesOf } from "../ui/tileset/emptyTiles";
import { boundsOf } from "../ui/tileset/selectionModel";
import { useTilesetView } from "../ui/tileset/tilesetViewStore";
import { askText } from "../ui/tileset/TextPrompt";
import { toast } from "../ui/toast/toastStore";
import { registerCommands } from "./registry";
import { promptRenameTileset } from "./tilesetActions";

function selectedPalette() {
  const ps = usePaletteStore.getState();
  const view = useTilesetView.getState();
  const id = view.view === "single" ? ps.activePaletteId : view.focusedSource ? (view.focusedSource.startsWith("palette:") ? view.focusedSource.slice(8) : null) : ps.selection?.paletteId;
  return id ? useEditorStore.getState().project?.store.document.getCollection(id) : undefined;
}
export function copyReferences(cut = false): boolean {
  const ps = usePaletteStore.getState();
  const palette = selectedPalette();
  if (palette) {
    const selection = ps.selection?.paletteId === palette.id ? ps.selection : null;
    if (!selection || !copyPaletteSlots(palette, selection.ids)) return false;
    if (cut) clearPaletteSlots(palette.id, selection.ids);
    return true;
  }
  const s = useTilesetView.getState().selection;
  const ts = s ? useEditorStore.getState().project?.store.document.getTileset(s.tilesetId) : undefined;
  if (!s || !ts) return false;
  const image = getTilesetImage(ts.id);
  if (!copyTilesetTiles(ts, s.referenceIds ?? s.ids, image ? emptyTilesOf(ts, image.bitmap) : new Set())) return false;
  if (cut) {
    useTilesetView.getState().setSelection(null);
    useEditorStore.getState().setStamp(null);
    useEditorStore.getState().setSelection(null);
  }
  return true;
}
export function pasteReferences(): void {
  const palette = selectedPalette();
  if (!palette) {
    toast.withAction(t("tilesetEditing.pasteHint"), { label: t("tilesetEditing.pasteToPalette"), run: openPalettePastePicker });
    return;
  }
  const s = usePaletteStore.getState().selection;
  const bounds = s?.paletteId === palette.id ? boundsOf({ columns: palette.columns, rows: Infinity }, s.ids) : null;
  pasteIntoPalette(palette.id, bounds ? { col: bounds.col, row: bounds.row } : null);
}
export function fitTilesetViewport(): void {
  const vp = document.querySelector<HTMLElement>('[data-tileset-view="single"]');
  const grid = vp?.querySelector<HTMLElement>("[data-tileset-grid]");
  const key = grid?.dataset.tilesetGrid;
  if (!vp || !grid || !key) return;
  const scale = Number(grid.dataset.tilesetScale);
  const rect = grid.getBoundingClientRect();
  const next = Math.max(0.125, Math.min(16, (vp.clientWidth - 16) / (rect.width / scale), (vp.clientHeight - 16) / (rect.height / scale)));
  useTilesetView.getState().setTransform(key, { scale: next, x: 8, y: 8 });
}
async function promptTrimRows(): Promise<void> {
  const palette = selectedPalette();
  if (!palette) return;
  const text = await askText({ title: t("tilesetEditing.trimCommand"), label: t("tilesetEditing.trimRows"), initial: String(palette.rows ?? 2), confirm: t("tilesetEditing.trim") });
  if (text && Number.isInteger(Number(text)) && Number(text) >= 1 && Number(text) <= (palette.rows ?? 2)) requestPaletteTrim(palette, Number(text));
}
export function installTilesetEditingCommands(): void {
  const hasProject = () => !!useEditorStore.getState().project;
  registerCommands([
    { id: "tileset.rename", title: "tilesetEditing.rename", category: "tileset", enabled: hasProject, run: () => {
      const palette = selectedPalette();
      if (palette) void renamePalette(palette.id);
      else void promptRenameTileset(useUiStore.getState().activeTilesetId ?? undefined);
    } },
    { id: "tileset.copy", title: "tilesetEditing.copy", category: "tileset", enabled: hasProject, run: () => { copyReferences(); } },
    { id: "tileset.cut", title: "tilesetEditing.cut", category: "tileset", enabled: hasProject, run: () => { copyReferences(true); } },
    { id: "tileset.paste", title: "tilesetEditing.paste", category: "tileset", enabled: hasProject, run: pasteReferences },
    { id: "tileset.pasteToPalette", title: "tilesetEditing.pasteToPalette", category: "tileset", enabled: hasProject, run: openPalettePastePicker },
    { id: "tileset.fit", title: "tilesetEditing.fit", category: "tileset", enabled: () => hasProject() && useTilesetView.getState().view === "single", run: fitTilesetViewport },
    { id: "palette.trimRows", title: "tilesetEditing.trimCommand", category: "tileset", enabled: () => !!selectedPalette(), run: () => void promptTrimRows() },
  ]);
}
