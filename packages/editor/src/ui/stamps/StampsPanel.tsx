import { ContextMenu } from "@base-ui/react/context-menu";
import type { Stamp } from "@smap/core";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import { runCommand } from "../../commands/registry";
import { activeStampId, deleteStamp, pickStamp, renameStamp, stampRegion } from "../../commands/stampActions";
import { t } from "../../i18n";
import { useProjectLibrary } from "../../io/projectLibrary";
import { useEditorStore } from "../../state/editorStore";
import { getTilesetImage, onTilesetImage } from "../../state/tilesetImages";
import { useStructureVersion } from "../hooks";
import { LibraryTabs } from "../panels/LibraryPanel";
import { PanelSection } from "../panels/PanelSection";
import { Button, IconButton } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { menuItemClass, menuPopupClass, menuPositionerClass, menuSeparatorClass } from "../primitives/menuStyles";
import { RenameInput } from "../primitives/RenameInput";
import { Tooltip } from "../primitives/Tooltip";
import { stampLayerCounts, stampThumbnail } from "./stampThumb";

const THUMB_H = 72;

/** Bumps whenever a tileset image is (re)registered, so thumbnails redraw. */
let imageVersion = 0;
const subscribeImages = (notify: () => void) =>
  onTilesetImage(() => {
    imageVersion++;
    notify();
  });
function useImageVersion(): number {
  return useSyncExternalStore(subscribeImages, () => imageVersion);
}

/** True while the map has a marquee to save. */
function useCanSave(): boolean {
  return useEditorStore((s) => s.project !== null && s.region !== null && stampRegion() !== null);
}

/**
 * Saved multi-layer stamps (v0.6). Click one to put it on the brush; it then
 * places with one click, all layers at once (canvas). Right-click: use,
 * rename, delete. Stamps are flat copies, never linked to the map.
 */
export function StampsPanel() {
  const stamps = useProjectLibrary((s) => s.stamps);
  const canSave = useCanSave();
  return (
    <PanelSection
      title={t("panels.stamps")}
      heading={<LibraryTabs />}
      className="min-h-[160px] flex-1"
      actions={
        <Tooltip label={canSave ? t("stamps.save") : t("stamps.saveDisabled")}>
          <IconButton
            aria-label={t("stamps.save")}
            className="size-7"
            aria-disabled={!canSave}
            onClick={() => runCommand("stamp.saveSelection")}
          >
            <Icon name="plus" size={15} className={canSave ? "" : "opacity-40"} />
          </IconButton>
        </Tooltip>
      }
    >
      {stamps.length === 0 ? <EmptyStamps canSave={canSave} /> : <StampGrid stamps={stamps} canSave={canSave} />}
    </PanelSection>
  );
}

function EmptyStamps({ canSave }: { canSave: boolean }) {
  return (
    <div className="mx-3 mb-3 flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong px-5 text-center">
      <Icon name="stamp" size={22} className="text-faint" />
      <div className="text-md text-muted">{t("stamps.empty")}</div>
      <div className="text-xs leading-4 text-faint">{t("stamps.emptyHint")}</div>
      <Button
        variant={canSave ? "primary" : "secondary"}
        className="mt-1 h-7 px-2.5 text-sm"
        disabled={!canSave}
        onClick={() => runCommand("stamp.saveSelection")}
      >
        <Icon name="stamp" size={14} />
        {t("stamps.saveShort")}
      </Button>
      {!canSave && <div className="text-2xs text-faint">{t("stamps.saveDisabled")}</div>}
    </div>
  );
}

function StampGrid({ stamps, canSave }: { stamps: readonly Stamp[]; canSave: boolean }) {
  const activeId = useEditorStore((s) => activeStampId(s.stamp));
  const [editingId, setEditingId] = useState<string | null>(null);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {canSave && (
        <div className="mx-2 mb-2 flex shrink-0 items-center gap-2 rounded-md border border-accent-line bg-accent-soft py-1 pr-1 pl-2">
          <Icon name="select" size={14} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate text-xs text-muted">{t("stamps.save")}</span>
          <Button variant="primary" className="h-6 shrink-0 px-2 text-sm" onClick={() => runCommand("stamp.saveSelection")}>
            {t("common.save")}
          </Button>
        </div>
      )}
      <ul role="listbox" aria-label={t("stamps.list")} className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-1.5 overflow-y-auto px-2 pb-2">
        {stamps.map((stamp) => (
          <StampCard
            key={stamp.id}
            stamp={stamp}
            active={stamp.id === activeId}
            editing={editingId === stamp.id}
            onEdit={(on) => setEditingId(on ? stamp.id : null)}
          />
        ))}
      </ul>
      <div className="flex h-7 shrink-0 items-center border-t border-line-subtle px-3 text-2xs text-faint">
        <span className="truncate">{t("stamps.hint")}</span>
      </div>
    </div>
  );
}

function StampCard({
  stamp,
  active,
  editing,
  onEdit,
}: {
  stamp: Stamp;
  active: boolean;
  editing: boolean;
  onEdit(on: boolean): void;
}) {
  const counts = stampLayerCounts(stamp);
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        render={
          <li
            role="option"
            aria-selected={active}
            data-stamp-id={stamp.id}
            tabIndex={0}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("input")) return;
              pickStamp(stamp.id);
            }}
            onKeyDown={(e) => {
              if (editing) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                pickStamp(stamp.id);
              } else if (e.key === "F2") {
                e.preventDefault();
                onEdit(true);
              } else if (e.key === "Delete") {
                e.preventDefault();
                e.stopPropagation();
                deleteStamp(stamp.id);
              }
            }}
            onDoubleClick={(e) => {
              if (!(e.target as HTMLElement).closest("input")) onEdit(true);
            }}
            className={`group relative flex min-w-0 cursor-default flex-col gap-1 rounded-md border p-1 transition-colors focus-visible:outline-offset-0 ${
              active ? "border-accent bg-accent-soft" : "border-line-subtle hover:border-line-strong hover:bg-hover"
            }`}
          />
        }
      >
        <StampThumb stamp={stamp} />
        <div className="flex min-w-0 flex-col px-0.5 pb-0.5">
          {editing ? (
            <RenameInput
              initial={stamp.name}
              label={t("stamps.nameLabel")}
              className="h-5 text-sm"
              onDone={(name) => {
                onEdit(false);
                if (name !== null) renameStamp(stamp.id, name);
              }}
            />
          ) : (
            <span className={`truncate text-sm ${active ? "text-text" : "text-muted group-hover:text-text"}`}>{stamp.name}</span>
          )}
          <span className="flex items-center gap-1 font-mono text-2xs text-faint tabular">
            {t("stamps.size", { width: stamp.width, height: stamp.height })}
            <span aria-hidden>·</span>
            <span className="truncate font-sans">{t("stamps.layers", { count: counts.tile + counts.grid })}</span>
            {counts.grid > 0 && <Icon name="shield" size={10} className="shrink-0 text-collision-solid/80" />}
          </span>
        </div>
        {active && (
          <span className="absolute top-1.5 left-1.5 rounded-xs bg-accent px-1 text-2xs leading-[14px] font-medium text-on-accent">
            {t("stamps.active")}
          </span>
        )}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner className={menuPositionerClass}>
          <ContextMenu.Popup className={menuPopupClass}>
            <ContextMenu.Item className={menuItemClass} onClick={() => pickStamp(stamp.id)}>
              <Icon name="pencil" size={15} className="text-muted" />
              {t("stamps.use")}
            </ContextMenu.Item>
            <ContextMenu.Item className={menuItemClass} onClick={() => onEdit(true)}>
              <Icon name="pencilLine" size={15} className="text-muted" />
              {t("stamps.rename")}
            </ContextMenu.Item>
            <ContextMenu.Separator className={menuSeparatorClass} />
            <ContextMenu.Item className={`${menuItemClass} text-danger`} onClick={() => deleteStamp(stamp.id)}>
              <Icon name="trash" size={15} />
              {t("stamps.delete")}
            </ContextMenu.Item>
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/** The stamp's tile layers, composited and fitted crisply into the card. */
function StampThumb({ stamp }: { stamp: Stamp }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const store = useEditorStore((s) => s.project?.store);
  const structure = useStructureVersion(store);
  const images = useImageVersion();
  const [cssWidth, setCssWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setCssWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    const doc = store?.document;
    if (!canvas || !ctx || !doc || cssWidth === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const boxW = Math.round(cssWidth * dpr);
    const boxH = Math.round(THUMB_H * dpr);
    canvas.width = boxW;
    canvas.height = boxH;
    const { tileWidth, tileHeight } = doc.map;
    const thumb = stampThumbnail(
      stamp,
      `${images}:${structure}:${boxW}x${boxH}:${tileWidth}x${tileHeight}`,
      { width: boxW - 8 * dpr, height: boxH - 8 * dpr },
      tileWidth,
      tileHeight,
      (id) => doc.getTileset(id),
      (id) => getTilesetImage(id)?.bitmap,
    );
    ctx.clearRect(0, 0, boxW, boxH);
    ctx.imageSmoothingEnabled = false;
    // Whole device pixels keep the thumbnail crisp.
    ctx.drawImage(thumb, Math.floor((boxW - thumb.width) / 2), Math.floor((boxH - thumb.height) / 2));
  }, [stamp, store, structure, images, cssWidth]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      style={{ height: THUMB_H }}
      className="checker block w-full rounded-sm pixelated"
    />
  );
}
