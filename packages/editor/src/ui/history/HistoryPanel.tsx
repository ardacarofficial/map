import type { MapStore } from "@smap/core";
import { useEffect, useLayoutEffect, useReducer, useRef, useSyncExternalStore } from "react";

import { activeWorldHistory, moveHistory } from "../../io/worldHistoryCommands";
import { useProjectLibrary } from "../../io/projectLibrary";
import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { bindHistoryLabels, historyLabelsFor, historyLabelsVersion, sharedHistoryLabels, subscribeHistoryLabels } from "../feedback/sharedHistoryLabels";
import { Icon, type IconName } from "../primitives/Icon";
import { historyVerbs } from "./historyVerbs";
import { registerHistoryCommands } from "./historyCommands";
import { applyJump, historyRows, jumpFor, verbForChanges, type HistoryRow } from "./historyModel";

registerHistoryCommands();

const TOOL_ICON: Record<NonNullable<HistoryRow["tool"]>, IconName> = {
  brush: "pencil",
  eraser: "eraser",
  fill: "fill",
  rect: "rect",
  stamp: "stamp",
};

const KIND_ICON: Partial<Record<HistoryRow["kind"], IconName>> = {
  initial: "map",
  layer: "layers",
  layerProps: "layers",
  map: "resize",
  mapProps: "sliders",
  tileset: "image",
  tilesetList: "image",
  palette: "image",
  entities: "flag",
  entityTypes: "box",
  randomSets: "dice",
  collections: "grid",
};

function rowIcon(row: HistoryRow): IconName {
  return row.tool ? TOOL_ICON[row.tool] : (KIND_ICON[row.kind] ?? "pencilLine");
}

/** Re-renders on every history change of `store` (undo, redo, commit, clear). */
function useHistoryChanges(store: MapStore | undefined): void {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!store) return;
    return store.subscribe((event) => {
      if (event.historyChanged) bump();
    });
  }, [store]);
}

/**
 * Geçmiş tab: every chronological world action (or local stamp action), oldest first. The current state is marked ("Şu an"); clicking an
 * earlier row undoes back to it, a later (undone) row redoes up to it. No
 * branches or checkpoints: a new edit drops the undone rows.
 */
export function HistoryPanel() {
  const store = useEditorStore((s) => s.project?.store);
  const levels = useProjectLibrary((s) => s.levels);
  useHistoryChanges(store);
  useSyncExternalStore(subscribeHistoryLabels, historyLabelsVersion);
  useEffect(() => bindHistoryLabels(store), [store]);
  const listRef = useRef<HTMLOListElement>(null);
  const world = activeWorldHistory();
  useSyncExternalStore(listener => world?.subscribe(listener) ?? (() => {}), () => world?.version ?? 0);

  const entries = world?.entries();
  const byId = new Map(entries?.map(entry => [entry.id, entry] as const));
  const names = new Map(levels.map(level => [level.id, level.name]));
  const rows = entries ? historyRows(entries.map(e => ({ ...e.item, state: e.state })), id => {
    const entry = byId.get(id)!;
    const p = entry.participants.find(p => p.mapId === entry.originMapId) ?? entry.participants[0]!;
    return historyLabelsFor(world!.store(p.mapId)!).labelOf(p.entryId);
  }, id => verbForChanges(byId.get(id)!.changes)).map(row => {
    const entry = row.id === null ? undefined : byId.get(row.id);
    return entry ? { ...row, label: t("worldHistory.entry", { map: names.get(entry.originMapId) ?? entry.originMapId, action: row.label }) } : row;
  }) : store ? historyRows(store.historyEntries(), (id) => sharedHistoryLabels.labelOf(id), (id) => historyVerbs.labelOf(id)) : [];
  const currentIndex = rows.findIndex((r) => r.state === "current");
  const steps = rows.length - 1;

  // Keep the current row in view (e.g. after Ctrl+Z far down the list).
  useLayoutEffect(() => {
    listRef.current?.querySelector<HTMLElement>("[data-history-current]")?.scrollIntoView({ block: "nearest" });
  }, [currentIndex, steps]);

  if (!store) return null;

  const go = (index: number) => {
    if (store.inTransaction) return;
    const jump = jumpFor(rows, index);
    if (world && jump) void moveHistory(jump.move, jump.id);
    else applyJump(store, jump);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-history-panel>
      {steps > 0 && <div className="flex h-row shrink-0 items-center px-3 text-xs text-faint tabular">{t("history.count", { count: steps })}</div>}
      {steps > 0 && <ol ref={listRef} role="listbox" aria-label={t("history.title")} className={`flex min-h-0 flex-col overflow-y-auto px-1.5 pb-2 ${steps > 0 ? "flex-1" : ""}`}>
        {rows.map((row, index) => (
          <li key={row.id ?? "initial"} role="option" aria-selected={row.state === "current"}>
            <button
              type="button"
              data-history-row={row.id ?? "initial"}
              data-history-current={row.state === "current" || undefined}
              data-history-state={row.state}
              title={row.id === null ? t("history.initialHint") : row.state === "undone" ? t("history.redoable") : row.state === "current" ? t("history.current") : t("history.goTo")}
              onClick={() => go(index)}
              className={`group flex h-row w-full items-center gap-2 rounded-sm px-2 text-left text-sm transition-colors duration-100 ${
                row.state === "current"
                  ? "bg-accent-soft text-title"
                  : row.state === "undone"
                    ? "text-faint hover:bg-hover hover:text-muted"
                    : "text-text hover:bg-hover"
              }`}
            >
              <Icon name={rowIcon(row)} size={16} className={`shrink-0 ${row.state === "undone" ? "text-faint" : "text-muted"}`} />
              <span className="min-w-0 flex-1 truncate">{row.label}</span>
            </button>
          </li>
        ))}
      </ol>}
      {steps === 0 && <p className="px-3 py-2 text-sm text-muted">{t("history.empty")}</p>}
    </div>
  );
}
