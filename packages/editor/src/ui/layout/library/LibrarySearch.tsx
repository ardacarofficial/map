import type { ReactNode } from "react";
import { create } from "zustand";

import { pickStamp } from "../../../commands/stampActions";
import { t } from "../../../i18n";
import { useProjectLibrary } from "../../../io/projectLibrary";
import { useEditorStore } from "../../../state/editorStore";
import { useStructureVersion } from "../../hooks";
import { showMap } from "../../levels/DocumentTabs";
import { Icon, type IconName } from "../../primitives/Icon";
import { useUiStore } from "../../uiStore";
import { showDockTab } from "../dock/BottomDock";
import { hasDockTab } from "../dock/registry";

/** The library search text (UI only). */
export const useLibraryQuery = create<{ query: string }>()(() => ({ query: "" }));

/** Case- and Turkish-İ-insensitive "contains". */
export function matchesQuery(name: string, query: string): boolean {
  const q = query.trim().toLocaleLowerCase("tr");
  return q === "" || name.toLocaleLowerCase("tr").includes(q);
}

/** "Ara…" field at the top of the library: filters tilesets, stamps and maps by name. Esc clears. */
export function LibrarySearch() {
  const query = useLibraryQuery((s) => s.query);
  const set = (q: string) => useLibraryQuery.setState({ query: q });
  return (
    <div className="shrink-0 px-3 pb-2">
      <label className="flex h-8 items-center gap-2 rounded-md border border-line bg-raised px-2 transition-colors focus-within:border-accent-line hover:border-line-strong">
        <Icon name="search" size={14} className="shrink-0 text-faint" />
        <input
          value={query}
          onChange={(e) => set(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query !== "") {
              e.preventDefault();
              e.stopPropagation();
              set("");
            }
          }}
          placeholder={t("library.search")}
          aria-label={t("library.search")}
          data-library-search=""
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-md text-text outline-none placeholder:text-faint"
        />
        {query !== "" && (
          <button type="button" aria-label={t("library.searchClear")} onClick={() => set("")} className="text-faint hover:text-text">
            <Icon name="x" size={12} />
          </button>
        )}
      </label>
    </div>
  );
}

/** What the search found, grouped; a click uses the item like the tree / tabs would. */
export function LibrarySearchResults() {
  const query = useLibraryQuery((s) => s.query);
  const store = useEditorStore((s) => s.project?.store);
  const stamps = useProjectLibrary((s) => s.stamps);
  const levels = useProjectLibrary((s) => s.levels);
  useStructureVersion(store);
  const tilesets = (store?.document.tilesets ?? []).filter((ts) => matchesQuery(ts.name, query));
  const foundStamps = stamps.filter((s) => matchesQuery(s.name, query));
  const maps = levels.filter((l) => matchesQuery(l.name, query));
  const none = tilesets.length + foundStamps.length + maps.length === 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-1.5 pb-2" data-library-results="">
      {none && <p className="px-1.5 py-2 text-sm text-faint">{t("library.noResults", { query: query.trim() })}</p>}
      <Group title={t("panels.tileset")} count={tilesets.length}>
        {tilesets.map((ts) => (
          <Result
            key={ts.id}
            icon="image"
            label={ts.name}
            detail={`${ts.tileWidth}×${ts.tileHeight}`}
            onClick={() => {
              useUiStore.getState().setActiveTileset(ts.id);
              if (hasDockTab("tileset")) showDockTab("tileset");
              else useUiStore.getState().setLibraryTab("tileset");
              useLibraryQuery.setState({ query: "" });
            }}
          />
        ))}
      </Group>
      <Group title={t("panels.stamps")} count={foundStamps.length}>
        {foundStamps.map((s) => (
          <Result key={s.id} icon="stamp" label={s.name} onClick={() => pickStamp(s.id)} />
        ))}
      </Group>
      <Group title={t("levels.title")} count={maps.length}>
        {maps.map((l) => (
          <Result key={l.id} icon="map" label={l.name} onClick={() => showMap(l.id)} />
        ))}
      </Group>
    </div>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <div className="flex flex-col pt-1">
      <h3 className="px-1.5 pt-1.5 pb-1 text-2xs font-semibold tracking-[0.06em] text-faint uppercase">{title}</h3>
      {children}
    </div>
  );
}

function Result({ icon, label, detail, onClick }: { icon: IconName; label: string; detail?: string; onClick(): void }) {
  return (
    <button type="button" onClick={onClick} data-library-result="" className="flex h-7 items-center gap-2 rounded-md px-1.5 text-left text-md text-muted hover:bg-hover hover:text-text">
      <Icon name={icon} size={14} className="shrink-0 text-faint" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {detail && <span className="font-mono text-2xs text-faint tabular">{detail}</span>}
    </button>
  );
}
