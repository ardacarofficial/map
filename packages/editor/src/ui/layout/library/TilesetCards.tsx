import type { Tileset } from "@smap/core";
import { useEffect, useRef } from "react";

import { runCommand } from "../../../commands/registry";
import { t } from "../../../i18n";
import { useEditorStore } from "../../../state/editorStore";
import { useStructureVersion, useTilesetImage } from "../../hooks";
import { LibraryTabs } from "../../panels/LibraryPanel";
import { PanelSection } from "../../panels/PanelSection";
import { IconButton } from "../../primitives/Button";
import { Icon } from "../../primitives/Icon";
import { Tooltip } from "../../primitives/Tooltip";
import { useUiStore } from "../../uiStore";
import { showDockTab } from "../dock/BottomDock";

/**
 * Tileset'ler tab of the library once the bottom dock shows the tileset
 * itself: one card per tileset (image preview, name, tile size · count).
 * A click makes it the active tileset and shows it in the dock.
 */
export function TilesetCards() {
  const store = useEditorStore((s) => s.project?.store);
  const activeId = useUiStore((s) => s.activeTilesetId);
  useStructureVersion(store);
  const tilesets = store?.document.tilesets ?? [];
  return (
    <PanelSection
      title={t("panels.tileset")}
      heading={<LibraryTabs />}
      className="min-h-0 flex-1"
      actions={
        <Tooltip label={t("commands.tileset.add")} command="tileset.add">
          <IconButton aria-label={t("commands.tileset.add")} className="size-7" onClick={() => runCommand("tileset.add")}>
            <Icon name="plus" size={15} />
          </IconButton>
        </Tooltip>
      }
    >
      {tilesets.length === 0 ? (
        <div className="flex flex-col items-start gap-2 px-3 py-2 text-sm text-faint">
          {t("library.noTilesets")}
        </div>
      ) : (
        <ul className="grid min-h-0 grid-cols-2 content-start gap-2 overflow-y-auto px-3 pt-1 pb-3" data-tileset-cards="">
          {tilesets.map((tileset) => (
            <li key={tileset.id}>
              <TilesetCard tileset={tileset} on={tileset.id === activeId} />
            </li>
          ))}
        </ul>
      )}
    </PanelSection>
  );
}

function TilesetCard({ tileset, on }: { tileset: Tileset; on: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      data-tileset-card={tileset.id}
      title={tileset.name}
      onClick={() => {
        useUiStore.getState().setActiveTileset(tileset.id);
        showDockTab("tileset");
      }}
      className={`flex w-full flex-col overflow-hidden rounded-md border text-left transition-colors ${
        on ? "border-accent-line bg-accent-soft" : "border-line bg-raised hover:border-line-strong"
      }`}
    >
      <TilesetThumb tileset={tileset} />
      <span className="flex min-w-0 flex-col px-2 py-1.5">
        <span className={`truncate text-sm ${on ? "text-title" : "text-text"}`}>{tileset.name}</span>
        <span className="truncate font-mono text-2xs text-faint tabular">
          {tileset.tileWidth}×{tileset.tileHeight} · {t("library.tileCount", { count: tileset.columns * tileset.rows })}
        </span>
      </span>
    </button>
  );
}

const THUMB_H = 84;

/** The top-left of the tileset image, scaled crisply to fill the card. */
function TilesetThumb({ tileset }: { tileset: Tileset }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const image = useTilesetImage(tileset.id);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.round(THUMB_H * dpr);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!image) return;
    ctx.imageSmoothingEnabled = false;
    // Integer scale (square pixels) showing about three rows of tiles; the top-left corner of the image.
    const bmp = image.bitmap;
    const scale = Math.max(1, Math.floor(canvas.height / (tileset.tileHeight * 3)));
    const sw = Math.min(bmp.width, Math.ceil(canvas.width / scale));
    const sh = Math.min(bmp.height, Math.ceil(canvas.height / scale));
    ctx.drawImage(bmp, 0, 0, sw, sh, 0, 0, sw * scale, sh * scale);
  }, [image, tileset]);
  return <canvas ref={ref} aria-hidden style={{ height: THUMB_H }} className="checker block w-full pixelated" />;
}
