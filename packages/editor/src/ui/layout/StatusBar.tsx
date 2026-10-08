import { useEffect, type ReactNode } from "react";
import { isEntityLayer } from "@smap/core";

import { formatNumber, getLocale, t } from "../../i18n";
import { useProjectLibrary } from "../../io/projectLibrary";
import { useSaveIndicator } from "../../io/saveIndicator";
import { useWorldView } from "../../commands/worldActions";
import { useEditorStore } from "../../state/editorStore";
import { useStructureVersion } from "../hooks";
import { installPickHint, usePickHint } from "./pickHint";

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5">
      <span className="text-faint">{label}</span>
      <span className="font-mono text-muted tabular">{children}</span>
    </div>
  );
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(getLocale() === "tr" ? "tr-TR" : "en-US", { hour: "2-digit", minute: "2-digit" });
}

/** "Kaydediliyor…" / "Kaydedildi · 12:04" / "Kaydedilmedi" (no folder yet). */
function SaveState() {
  // One source of truth with the title dot and the window title (`io/saveIndicator.ts`).
  const indicator = useSaveIndicator();
  if (!indicator.text) return null;
  const saving = indicator.text === "saving";
  const tone = indicator.text === "saveFailed" ? "text-danger" : "text-faint";
  const text =
    indicator.text === "savedAt" && indicator.lastSavedAt !== null
      ? t("status.savedAt", { time: formatTime(indicator.lastSavedAt) })
      : t(`status.${indicator.text === "savedAt" ? "notSaved" : indicator.text}`);
  return (
    <div role="status" data-save-state={indicator.text} className={`ml-auto flex items-center gap-1.5 px-2.5 ${tone}`}>
      {saving && <span className="size-1.5 animate-pulse rounded-full bg-accent" />}
      {text}
    </div>
  );
}

/**
 * "Sağ tık: tile al · sağ sürükle: alan al · Alt+tık: damlalık" while a tile
 * tool is in use, until the first pick from the map (or a click on it).
 */
function PickHint() {
  const seen = usePickHint((s) => s.seen);
  const dismiss = usePickHint((s) => s.dismiss);
  useEffect(() => {
    if (!seen) installPickHint();
  }, [seen]);
  if (seen) return null;
  return (
    <button
      type="button"
      data-status-pick-hint
      title={t("status.pickHintClose")}
      onClick={dismiss}
      className="flex min-w-0 items-center gap-1.5 px-2.5 text-faint hover:text-muted"
    >
      <span className="size-1.5 shrink-0 rounded-full bg-accent" />
      <span className="truncate">{t("status.pickHint")}</span>
    </button>
  );
}

export function StatusBar() {
  const project = useEditorStore((s) => s.project);
  const hover = useEditorStore((s) => s.hoverCell);
  const zoom = useEditorStore((s) => s.zoom);
  const tool = useEditorStore((s) => s.tool);
  const brushSize = useEditorStore((s) => s.brushSize);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const world = useWorldView((s) => s.view === "world");
  const levelCount = useProjectLibrary((s) => s.levels.length);
  useStructureVersion(project?.store);
  const map = project?.store.document.map;

  if (world) {
    return (
      <footer aria-label={t("layout.statusBar")} className="flex h-statusbar items-center border-t border-line bg-panel px-1 text-xs [&>*+*]:border-l [&>*+*]:border-line-subtle">
        <div data-status-world="" className="flex items-center px-2.5 whitespace-pre">
          <span className="text-accent">{t("world.status")}</span>
          <span className="text-faint">{" · "}</span>
          <span className="text-muted tabular">{t("world.levelCount", { count: levelCount })}</span>
        </div>
        <Item label={t("status.zoom")}>
          <span className="inline-block min-w-[5ch]">{formatNumber(Math.round(zoom * 100))}%</span>
        </Item>
        <div className="flex items-center gap-1.5 px-2.5 text-faint">{t("world.hintBack")}</div>
        <SaveState />
      </footer>
    );
  }

  const layer = activeLayerId ? project?.store.document.getLayer(activeLayerId) : undefined;
  const sized = (tool === "brush" || tool === "eraser") && !isEntityLayer(layer);
  const pickable = (tool === "brush" || tool === "fill" || tool === "rect") && !!layer && !isEntityLayer(layer);
  return (
    <footer aria-label={t("layout.statusBar")} className="flex h-statusbar items-center border-t border-line bg-panel px-1 text-xs [&>*+*]:border-l [&>*+*]:border-line-subtle">
      <div className="flex items-center gap-2 px-2.5 font-mono text-muted tabular" data-status-cell>
        <span>
          <span className="text-faint">X </span>
          <span className="inline-block min-w-[3ch]">{hover ? hover.x : t("status.noCell")}</span>
        </span>
        <span>
          <span className="text-faint">Y </span>
          <span className="inline-block min-w-[3ch]">{hover ? hover.y : t("status.noCell")}</span>
        </span>
      </div>
      {layer && (
        <div className="flex min-w-0 items-center gap-1.5 px-2.5" data-status-layer>
          <span className="text-faint">{t("status.layer")}</span>
          <span className="max-w-[160px] truncate text-muted">{layer.name}</span>
        </div>
      )}
      <div className="flex items-center gap-1.5 px-2.5">
        <span className="text-faint">{t("status.tool")}</span>
        <span className="text-muted">{t(`tools.${tool}`)}</span>
        {sized && <span className="font-mono text-faint tabular">{t("toolOptions.sizeValue", { size: brushSize })}</span>}
      </div>
      <Item label={t("status.zoom")}>
        <span className="inline-block min-w-[5ch]">{formatNumber(Math.round(zoom * 100))}%</span>
      </Item>
      {map && (
        <Item label={t("status.map")}>
          {t("common.cells", { width: map.width, height: map.height })}
          <span className="text-faint"> · {t("common.px", { value: map.tileWidth })}</span>
        </Item>
      )}
      {pickable && <PickHint />}
      <SaveState />
    </footer>
  );
}
