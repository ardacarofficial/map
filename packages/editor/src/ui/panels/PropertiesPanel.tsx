import { tilePosition, tileRect, type Tileset } from "@smap/core";
import { useEffect, useRef, type ReactNode } from "react";

import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { useStructureVersion, useTilesetImage } from "../hooks";
import { PanelSection } from "./PanelSection";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-faint">{label}</dt>
      <dd className="min-w-0 truncate text-text">{children}</dd>
    </>
  );
}

/** Info about the selected tile (and the map when nothing is selected). */
export function PropertiesPanel() {
  const store = useEditorStore((s) => s.project?.store);
  const selection = useEditorStore((s) => s.selection);
  useStructureVersion(store);
  const tileset = selection ? store?.document.getTileset(selection.tilesetId) : undefined;
  const map = store?.document.map;

  return (
    <PanelSection title={t("panels.properties")} className="shrink-0">
      <div className="px-3 pb-3">
        {selection && tileset ? (
          <div className="flex gap-3">
            <TilePreview tileset={tileset} tileId={selection.tileId} />
            <dl className="grid min-w-0 flex-1 grid-cols-[auto_1fr] content-start gap-x-3 gap-y-1 text-sm">
              <Row label={t("properties.tileset")}>{tileset.name}</Row>
              <Row label={t("properties.tileId")}>
                <span className="font-mono tabular">{selection.tileId}</span>
              </Row>
              <Row label={t("properties.position")}>
                <span className="font-mono tabular">
                  {tilePosition(tileset, selection.tileId).col}, {tilePosition(tileset, selection.tileId).row}
                </span>
              </Row>
              <Row label={t("properties.size")}>
                <span className="font-mono tabular">
                  {tileset.tileWidth} × {tileset.tileHeight}
                </span>
              </Row>
            </dl>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col">
              <span className="text-sm text-muted">{t("properties.noSelection")}</span>
              <span className="text-xs text-faint">{t("properties.noSelectionHint")}</span>
            </div>
            {map && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <Row label={t("properties.mapSize")}>
                  <span className="font-mono tabular">{t("common.cells", { width: map.width, height: map.height })}</span>
                </Row>
                <Row label={t("properties.tileSize")}>
                  <span className="font-mono tabular">{t("common.px", { value: map.tileWidth })}</span>
                </Row>
              </dl>
            )}
          </div>
        )}
      </div>
    </PanelSection>
  );
}

const PREVIEW = 56;

function TilePreview({ tileset, tileId }: { tileset: Tileset; tileId: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const image = useTilesetImage(tileset.id);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(PREVIEW * dpr);
    canvas.height = Math.round(PREVIEW * dpr);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!image) return;
    ctx.imageSmoothingEnabled = false;
    const r = tileRect(tileset, tileId);
    const scale = Math.min(canvas.width / r.width, canvas.height / r.height);
    const w = r.width * scale;
    const h = r.height * scale;
    ctx.drawImage(image.bitmap, r.x, r.y, r.width, r.height, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  }, [image, tileset, tileId]);

  return (
    <canvas
      ref={ref}
      style={{ width: PREVIEW, height: PREVIEW }}
      className="checker shrink-0 rounded-md border border-line pixelated"
    />
  );
}
