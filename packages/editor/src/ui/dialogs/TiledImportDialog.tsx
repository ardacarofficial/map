import { useRef } from "react";
import type { TiledUnsupported, TiledUnsupportedKind } from "@smap/core";
import { closeTiledImportReport, useTiledImportReport } from "../../commands/tiledImportActions";
import { t, type MessageKey } from "../../i18n";
import { Button } from "../primitives/Button";
import { Dialog } from "../primitives/Overlays";
import { DialogBody, DialogFooter, DialogHeader, dialogLayoutClass } from "./DialogFrame";
import { backdropClass, dialogWidthM, popupClass } from "./styles";

const KIND_LABEL: Record<TiledUnsupportedKind, MessageKey> = {
  objectLayer: "tiledImport.kind.objectLayer", imageLayer: "tiledImport.kind.imageLayer", groupLayer: "tiledImport.kind.groupLayer",
  layerOffset: "tiledImport.kind.layerOffset", parallax: "tiledImport.kind.parallax", tint: "tiledImport.kind.tint",
  properties: "tiledImport.kind.properties", animation: "tiledImport.kind.animation", tileCollision: "tiledImport.kind.tileCollision",
  wangSets: "tiledImport.kind.wangSets", tileOffset: "tiledImport.kind.tileOffset", imageCollection: "tiledImport.kind.imageCollection",
  imageFormat: "tiledImport.kind.imageFormat", tileSize: "tiledImport.kind.tileSize", missingTileset: "tiledImport.kind.missingTileset",
  missingImage: "tiledImport.kind.missingImage", unknownTile: "tiledImport.kind.unknownTile", hexRotation: "tiledImport.kind.hexRotation",
};
/** Counts of these kinds are tiles of a tileset; all others count map cells. */
const TILE_COUNTS = new Set<TiledUnsupportedKind>(["animation", "tileCollision"]);

function countText(item: TiledUnsupported): string | null {
  if (item.count === undefined) return null;
  return t(TILE_COUNTS.has(item.kind) ? "tiledImport.tiles" : "tiledImport.cells", { count: item.count });
}

/** After Dosya → İçe aktar → Tiled haritası…: what the new map could not take over. */
export function TiledImportDialog() {
  const report = useTiledImportReport(s => s.report);
  const okRef = useRef<HTMLButtonElement>(null);
  return <Dialog.Root open={report !== null} onOpenChange={open => { if (!open) closeTiledImportReport(); }}>
    <Dialog.Portal><Dialog.Backdrop className={backdropClass} />
      <Dialog.Popup data-tiled-import-report="" initialFocus={okRef} className={`${popupClass} ${dialogWidthM} ${dialogLayoutClass}`}>
        <DialogHeader title={t("tiledImport.title")} subtitle={report ? t("tiledImport.subtitle", { name: report.name, layers: report.layers, tilesets: report.tilesets }) : ""} onClose={closeTiledImportReport} />
        <DialogBody className="flex flex-col gap-2">
          <h3 className="text-sm text-muted">{t("tiledImport.notImported")}</h3>
          <ul className="flex flex-col">
            {report?.unsupported.map((item, i) => {
              const count = countText(item);
              return <li key={i} data-unsupported-kind={item.kind} className="flex min-w-0 items-baseline gap-2 border-b border-line-subtle py-1.5 text-md last:border-b-0">
                <span className="shrink-0 text-text">{t(KIND_LABEL[item.kind])}</span>
                {item.name && <span className="min-w-0 truncate font-mono text-sm text-muted" title={item.name}>{item.name}</span>}
                {count && <span className="ml-auto shrink-0 text-sm text-muted">{count}</span>}
              </li>;
            })}
          </ul>
        </DialogBody>
        <DialogFooter>
          <Button ref={okRef} variant="primary" onClick={closeTiledImportReport}>{t("tiledImport.ok")}</Button>
        </DialogFooter>
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>;
}
