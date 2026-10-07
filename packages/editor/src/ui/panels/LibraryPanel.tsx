import { isEntityLayer } from "@smap/core";

import { t } from "../../i18n";
import { useProjectLibrary } from "../../io/projectLibrary";
import { useEditorStore } from "../../state/editorStore";
import { EntityPalette } from "../entities/EntityPalette";
import { useStructureVersion } from "../hooks";
import { StampsPanel } from "../stamps/StampsPanel";
import { useUiStore, type LibraryTab } from "../uiStore";
import { TilesetPanel } from "./TilesetPanel";

/**
 * The middle of the right column: "Tileset | Stamp" tabs, or the entity
 * palette while an entity layer is active (tiles cannot go there).
 */
export function LibraryPanel() {
  const store = useEditorStore((s) => s.project?.store);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const tab = useUiStore((s) => s.libraryTab);
  useStructureVersion(store);
  const layer = activeLayerId ? store?.document.getLayer(activeLayerId) : undefined;
  if (isEntityLayer(layer)) return <EntityPalette />;
  return tab === "stamps" ? <StampsPanel /> : <TilesetPanel />;
}

const TABS: { id: LibraryTab; label: () => string }[] = [
  { id: "tileset", label: () => t("panels.tileset") },
  { id: "stamps", label: () => t("panels.stamps") },
];

/** Header tabs of the library section. */
export function LibraryTabs() {
  const tab = useUiStore((s) => s.libraryTab);
  const setTab = useUiStore((s) => s.setLibraryTab);
  const stampCount = useProjectLibrary((s) => s.stamps.length);
  return (
    <div role="tablist" aria-label={t("panels.tileset")} className="-ml-1.5 flex items-center gap-0.5">
      {TABS.map(({ id, label }) => {
        const on = id === tab;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => setTab(id)}
            className={`flex h-6 items-center gap-1.5 rounded-sm px-1.5 text-xs font-semibold tracking-wide transition-colors ${
              on ? "text-text" : "text-faint hover:bg-hover hover:text-muted"
            }`}
          >
            {label()}
            {id === "stamps" && stampCount > 0 && (
              <span className={`font-mono text-2xs font-normal tabular ${on ? "text-muted" : "text-faint"}`}>{stampCount}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
