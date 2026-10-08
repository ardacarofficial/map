import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { useStructureVersion } from "../hooks";
import { TileSwatch } from "../primitives/TileSwatch";
import { pickRecentTile } from "./recentTiles";

/**
 * Slim strip under the canvas: the most recently used tiles (newest left).
 * Click one to paint with it again. Empty: a quiet one-line hint.
 */
export function RecentTilesStrip() {
  const recent = useEditorStore((s) => s.recentTiles);
  const selection = useEditorStore((s) => s.selection);
  const stamp = useEditorStore((s) => s.stamp);
  const store = useEditorStore((s) => s.project?.store);
  useStructureVersion(store);
  const doc = store?.document;
  const tiles = doc ? recent.filter((tile) => doc.getTileset(tile.tilesetId)) : [];

  return (
    <div
      role="toolbar"
      aria-label={t("recent.title")}
      data-recent-strip
      className="flex h-recentstrip shrink-0 items-center gap-2 border-t border-line bg-panel pr-2 pl-3"
    >
      <span className="shrink-0 text-2xs font-semibold tracking-wider text-faint uppercase">{t("recent.title")}</span>
      {tiles.length === 0 ? (
        <span className="truncate text-xs text-faint" data-recent-empty>
          {t("recent.empty")}
        </span>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1">
          {tiles.map((tile) => {
            const tileset = doc!.getTileset(tile.tilesetId)!;
            const on = !stamp && selection?.tilesetId === tile.tilesetId && selection.tileId === tile.tileId;
            return (
              <button
                key={`${tile.tilesetId}:${tile.tileId}`}
                type="button"
                aria-label={t("recent.tile", { id: tile.tileId, tileset: tileset.name })}
                title={t("recent.tile", { id: tile.tileId, tileset: tileset.name })}
                aria-pressed={on}
                data-recent-tile={`${tile.tilesetId}:${tile.tileId}`}
                onClick={() => pickRecentTile(tile)}
                className={`shrink-0 rounded-sm p-px transition-shadow ${
                  on ? "shadow-[0_0_0_2px_var(--color-accent)]" : "hover:shadow-[0_0_0_1px_var(--color-line-strong)]"
                }`}
              >
                <TileSwatch tileset={tileset} tileId={tile.tileId} size={26} className="block rounded-xs" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
