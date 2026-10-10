import type { MapStore } from "@smap/core";
import { useEffect, useLayoutEffect, useReducer, useRef, useSyncExternalStore } from "react";

import { formatNumber, t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { bindHistoryLabels, historyLabelsVersion, sharedHistoryLabels, subscribeHistoryLabels } from "../feedback/sharedHistoryLabels";
import { Icon, type IconName } from "../primitives/Icon";
import { registerHistoryCommands } from "./historyCommands";
import { applyJump, historyRows, jumpFor, type HistoryRow } from "./historyModel";

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
 * Geçmiş tab: every undo step of the open map, oldest first, from core
 * `historyEntries()`. The current state is marked ("Şu an"); clicking an
 * earlier row undoes back to it, a later (undone) row redoes up to it. No
 * branches or checkpoints: a new edit drops the undone rows.
 */
export function HistoryPanel() {
  const store = useEditorStore((s) => s.project?.store);
  useHistoryChanges(store);
  useSyncExternalStore(subscribeHistoryLabels, historyLabelsVersion);
  useEffect(() => bindHistoryLabels(store), [store]);
  const listRef = useRef<HTMLOListElement>(null);

  const rows = store ? historyRows(store.historyEntries(), (id) => sharedHistoryLabels.labelOf(id)) : [];
  const currentIndex = rows.findIndex((r) => r.state === "current");
  const steps = rows.length - 1;

  // Keep the current row in view (e.g. after Ctrl+Z far down the list).
  useLayoutEffect(() => {
    listRef.current?.querySelector<HTMLElement>("[data-history-current]")?.scrollIntoView({ block: "nearest" });
  }, [currentIndex, steps]);

  if (!store) return null;

  const go = (index: number) => {
    if (store.inTransaction) return;
    applyJump(store, jumpFor(rows, index));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-history-panel>
      <div className="flex h-8 shrink-0 items-center px-3 pt-1 text-xs text-faint">
        <span className="font-semibold tracking-[0.06em] text-muted uppercase">{t("history.title")}</span>
        {steps > 0 && <span className="ml-auto font-mono tabular">{t("history.count", { count: formatNumber(steps) })}</span>}
      </div>
      <ol ref={listRef} role="listbox" aria-label={t("history.title")} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-1.5 pb-2">
        {rows.map((row, index) => (
          <li key={row.id ?? "initial"} role="option" aria-selected={row.state === "current"}>
            <button
              type="button"
              data-history-row={row.id ?? "initial"}
              data-history-current={row.state === "current" || undefined}
              data-history-state={row.state}
              title={row.id === null ? t("history.initialHint") : row.state === "undone" ? t("history.redoable") : row.state === "current" ? t("history.current") : t("history.goTo")}
              onClick={() => go(index)}
              className={`group flex h-[29px] w-full items-center gap-2 rounded-sm px-2 text-left text-md transition-colors duration-100 ${
                row.state === "current"
                  ? "bg-accent-soft text-text shadow-[inset_2px_0_0_var(--color-accent)]"
                  : row.state === "undone"
                    ? "text-faint hover:bg-hover hover:text-muted"
                    : "text-text hover:bg-hover"
              }`}
            >
              <Icon name={rowIcon(row)} size={14} className={`shrink-0 ${row.state === "current" ? "text-accent" : row.state === "undone" ? "opacity-60" : "text-muted"}`} />
              <span className={`min-w-0 flex-1 truncate ${row.state === "undone" ? "italic" : ""}`}>{row.label}</span>
              {row.state === "current" && (
                <span className="shrink-0 rounded-xs bg-accent/15 px-1.5 text-2xs font-medium text-accent">{t("history.current")}</span>
              )}
            </button>
          </li>
        ))}
      </ol>
      {steps === 0 && <p className="px-3 pb-3 text-sm leading-5 text-faint">{t("history.empty")}</p>}
    </div>
  );
}
