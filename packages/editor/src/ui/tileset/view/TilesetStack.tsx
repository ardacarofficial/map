import { ContextMenu } from "../../primitives/Overlays";
import type { Collection, Tileset } from "@smap/core";
import { useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { dropTileset, renameTilesetGroup } from "../../../commands/tilesetActions";
import { t } from "../../../i18n";
import { Icon } from "../../primitives/Icon";
import { RenameInput } from "../../primitives/RenameInput";
import { PaletteGrid, paletteKey } from "../../palettes/PaletteGrid";
import { showPalette } from "../../palettes/paletteActions";
import { filterTilesets, groupTilesets, UNGROUPED, type DropTarget } from "../libraryModel";
import { TilesetGrid } from "../TilesetGrid";
import { TilesetContextMenu, TilesetThumb, SourceMenuButton } from "../TilesetSwitcher";
import { useTilesetView } from "../tilesetViewStore";
import { formattedZoom } from "./ZoomControl";
import { useUiStore } from "../../uiStore";
import { HEADER_H, PADDING } from "./constants";
const DRAG_TYPE = "application/x-smap-tileset";
const PALETTE_GROUP = "\u0000palettes";
const HEADER_TRANSFORM = "translateX(var(--tileset-stack-header-offset, 0px))";

export function TilesetStack({
  tilesets,
  palettes,
  scaleOf,
  scaleOfPalette,
  offsetX,
  paletteOffsetX,
  onResetZoom,
}: {
  tilesets: readonly Tileset[];
  palettes: readonly Collection[];
  scaleOf(ts: Tileset): number;
  scaleOfPalette(p: Collection): number;
  offsetX(ts: Tileset): number;
  paletteOffsetX(p: Collection): number;
  onResetZoom(key: string): void;
}) {
  const query = useTilesetView((s) => s.query);
  const collapsed = useTilesetView((s) => s.collapsed);
  const toggleCollapsed = useTilesetView((s) => s.toggleCollapsed);
  const zoomMap = useTilesetView((s) => s.zoom);
  const jump = useTilesetView((s) => s.jump);
  const activeId = useUiStore((s) => s.activeTilesetId);
  const shown = filterTilesets(tilesets, query);
  const shownPalettes = filterTilesets(palettes, query);
  const groups = groupTilesets(shown);
  // With palettes listed, tilesets always get group headers, so the two kinds read apart.
  const labelled = groups.some((g) => g.name !== UNGROUPED) || shownPalettes.length > 0;
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<DropTarget | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Jump requests (goto, chips, search Enter): open its group, then bring its header to the top.
  const jumped = useRef(0);
  useLayoutEffect(() => {
    if (!jump || jumped.current === jump.nonce) return;
    const isPalette = jump.tilesetId.startsWith("palette:");
    const ts = isPalette ? undefined : tilesets.find((x) => x.id === jump.tilesetId);
    if (!isPalette && !ts) return;
    const group = isPalette ? PALETTE_GROUP : (ts!.group ?? UNGROUPED);
    if (labelled && collapsed.includes(group)) {
      toggleCollapsed(group);
      return;
    }
    const vp = rootRef.current?.closest<HTMLElement>("[data-tileset-scroll]");
    const section = rootRef.current?.querySelector<HTMLElement>(`[data-tileset-section="${CSS.escape(jump.tilesetId)}"]`);
    if (!vp || !section) return;
    jumped.current = jump.nonce;
    const state = useTilesetView.getState();
    const dy = vp.getBoundingClientRect().top + (labelled ? HEADER_H : 0) - section.getBoundingClientRect().top;
    state.setStackOffset({ ...state.stackOffset, y: state.stackOffset.y + dy });
  }, [jump, tilesets, collapsed, labelled, toggleCollapsed]);

  const dragProps = (target: DropTarget) => ({
    onDragOver: (e: DragEvent) => {
      if (!dragId || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (over?.group !== target.group || over.beforeId !== target.beforeId) setOver(target);
    },
    onDrop: (e: DragEvent) => {
      const id = e.dataTransfer.getData(DRAG_TYPE) || dragId;
      e.preventDefault();
      setOver(null);
      setDragId(null);
      if (id) dropTileset(id, target);
    },
  });

  if (shown.length === 0 && shownPalettes.length === 0) {
    return <div className="p-2 text-sm text-muted">{t("tilesetLib.noMatch")}</div>;
  }

  const groupHeader = (name: string, label: string, count: number, extra?: ReactNode, props?: object) => {
    const isCollapsed = collapsed.includes(name);
    return (
      <div
        className={`sticky top-0 z-(--overlay-chrome-raised) flex items-center gap-1 border-b border-line-subtle bg-panel pr-2 pl-1 ${over?.group === name && over.beforeId === null ? "shadow-[inset_0_1px_0_var(--color-accent)]" : ""}`}
        style={{ height: HEADER_H, transform: HEADER_TRANSFORM }}
        data-group-header={name}
        {...props}
      >
        <button
          type="button"
          aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? t("tilesetLib.groupExpand") : t("tilesetLib.groupCollapse")}
          onClick={() => toggleCollapsed(name)}
          className="grid size-6 shrink-0 place-items-center rounded-sm text-faint hover:bg-hover hover:text-text"
        >
          <Icon name={isCollapsed ? "chevronRight" : "chevronDown"} size={16} />
        </button>
        {extra ?? <span className="min-w-0 flex-1 truncate text-xs font-semibold tracking-wide text-muted uppercase select-none">{label}</span>}
        <span className="shrink-0 font-mono text-xs text-faint tabular">{count}</span>
      </div>
    );
  };

  return (
    <div ref={rootRef} onDragEnd={() => (setDragId(null), setOver(null))}>
      {shownPalettes.length > 0 && (
        <div data-tileset-group={PALETTE_GROUP} data-group-labelled="">
          {groupHeader(PALETTE_GROUP, t("palettes.title"), shownPalettes.length)}
          {!collapsed.includes(PALETTE_GROUP) &&
            shownPalettes.map((p) => {
              const key = paletteKey(p.id);
              const own = zoomMap[key];
              return (
                <section key={p.id} data-tileset-section={key} aria-label={p.name}>
                  <div
                    className="sticky z-(--overlay-chrome) flex items-center gap-1.5 border-b border-line-subtle bg-panel pr-2 pl-2"
                    style={{ top: HEADER_H, height: HEADER_H, transform: HEADER_TRANSFORM }}
                    onClick={() => showPalette(p.id)}
                    data-palette-header={p.id}
                    data-palette-drop={p.id}
                  >
                    <Icon name="grid" size={16} className="shrink-0 text-faint" />
                    <span className="min-w-0 flex-1 truncate text-sm text-muted">{p.name}</span>
                    {own == null && <span className="shrink-0 font-mono text-xs text-faint">{formattedZoom(scaleOfPalette(p))}</span>}
                    {own != null && (
                      <button
                        type="button"
                        title={t("tilesetLib.zoomOverrideReset")}
                        onClick={() => onResetZoom(key)}
                        className="flex h-6 shrink-0 items-center gap-0.5 rounded-sm bg-accent-soft px-1 font-mono text-xs text-accent tabular"
                      >
                        {formattedZoom(own)}
                        <Icon name="x" size={12} />
                      </button>
                    )}
                    <span className="shrink-0 font-mono text-xs text-faint tabular">{p.cells.length}</span>
                    <SourceMenuButton palette={p} />
                  </div>
                  <div style={{ padding: `8px ${PADDING}px` }}>
                    <div style={{ marginLeft: paletteOffsetX(p), width: "max-content" }}>
                      <PaletteGrid palette={p} scale={scaleOfPalette(p)} />
                    </div>
                  </div>
                </section>
              );
            })}
        </div>
      )}
      {groups.map((group) => {
        const isCollapsed = labelled && collapsed.includes(group.name);
        const groupTarget = { group: group.name, beforeId: null };
        const overGroup = over && over.group === group.name && over.beforeId === null;
        return (
          <div key={group.name || "\u0000"} data-tileset-group={group.name} data-group-labelled={labelled ? "" : undefined}>
            {labelled &&
              groupHeader(
                group.name,
                group.name === UNGROUPED ? t("tilesetLib.ungrouped") : group.name,
                group.tilesets.length,
                renaming === group.name ? (
                  <RenameInput
                    initial={group.name}
                    label={t("tilesetLib.groupName")}
                    onDone={(name) => {
                      setRenaming(null);
                      if (name) renameTilesetGroup(group.name, name);
                    }}
                  />
                ) : (
                  <span
                    className={`min-w-0 flex-1 truncate text-xs font-semibold tracking-wide text-muted uppercase select-none ${overGroup ? "text-accent" : ""}`}
                    title={group.name === UNGROUPED ? undefined : t("tilesetLib.groupRenameHint")}
                    onDoubleClick={() => group.name !== UNGROUPED && setRenaming(group.name)}
                    data-group-name
                  >
                    {group.name === UNGROUPED ? (shownPalettes.length > 0 ? t("tilesetDock.tilesets") : t("tilesetLib.ungrouped")) : group.name}
                  </span>
                ),
                dragProps(groupTarget),
              )}
            {!isCollapsed &&
              group.tilesets.map((ts) => {
                const target = { group: group.name, beforeId: ts.id };
                const overThis = over && over.group === group.name && over.beforeId === ts.id && dragId !== ts.id;
                const own = zoomMap[ts.id];
                return (
                  <section key={ts.id} data-tileset-section={ts.id} aria-label={ts.name}>
                    <TilesetContextMenu tileset={ts}>
                      <ContextMenu.Trigger
                        render={
                          <div
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData(DRAG_TYPE, ts.id);
                              e.dataTransfer.effectAllowed = "move";
                              setDragId(ts.id);
                            }}
                            onClick={() => {
                              showPalette(null);
                              useUiStore.getState().setActiveTileset(ts.id);
                            }}
                            className={`group sticky z-(--overlay-chrome) flex cursor-grab items-center gap-1.5 border-b border-line-subtle bg-panel pr-2 pl-1.5 active:cursor-grabbing ${
                              overThis ? "shadow-[inset_0_1px_0_var(--color-accent)]" : ""
                            } ${dragId === ts.id ? "opacity-50" : ""}`}
                            style={{ top: labelled ? HEADER_H : 0, height: HEADER_H, transform: HEADER_TRANSFORM }}
                            data-tileset-header={ts.id}
                            {...dragProps(target)}
                          />
                        }
                      >
                        <Icon name="grip" size={12} className="shrink-0 text-faint opacity-0 group-hover:opacity-100" />
                        <TilesetThumb tileset={ts} size={16} />
                        <span title={ts.name} className={`min-w-0 flex-1 truncate text-sm ${ts.id === activeId ? "text-title" : "text-text"}`}>{ts.name}</span>
                        {own == null && <span className="shrink-0 font-mono text-xs text-faint">{formattedZoom(scaleOf(ts))}</span>}
                        {own != null && (
                          <button
                            type="button"
                            title={t("tilesetLib.zoomOverrideReset")}
                            data-tileset-zoom-override={ts.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              onResetZoom(ts.id);
                            }}
                            className="flex h-6 shrink-0 items-center gap-0.5 rounded-sm bg-accent-soft px-1 font-mono text-xs text-accent tabular"
                          >
                            {formattedZoom(own)}
                            <Icon name="x" size={12} />
                          </button>
                        )}
                        <span className="shrink-0 font-mono text-xs text-faint tabular">
                          {ts.tileWidth === ts.tileHeight ? `${ts.tileWidth}px · ` : `${ts.tileWidth}×${ts.tileHeight} · `}
                          {ts.columns}×{ts.rows}
                        </span>
                        <SourceMenuButton tileset={ts} />
                      </ContextMenu.Trigger>
                    </TilesetContextMenu>
                    <div style={{ padding: `8px ${PADDING}px` }}>
                      <div style={{ marginLeft: offsetX(ts), width: "max-content" }}>
                        <TilesetGrid tileset={ts} scale={scaleOf(ts)} />
                      </div>
                    </div>
                  </section>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}

