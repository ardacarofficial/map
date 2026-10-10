import type { Stamp } from "@smap/core";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { addStampToRandomSet } from "../../commands/randomBrush";
import { runCommand } from "../../commands/registry";
import { activeStampId, deleteStamp, duplicateStamp, pickStamp, renameStamp, setStampMeta, stampRegion, toggleStampFavorite } from "../../commands/stampActions";
import { t } from "../../i18n";
import { useProjectLibrary } from "../../io/projectLibrary";
import { useEditorStore } from "../../state/editorStore";
import { LibraryTabs } from "../panels/LibraryPanel";
import { PanelSection } from "../panels/PanelSection";
import { Button, IconButton } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { RowContextMenu } from "../contextMenus/RowContextMenu";
import { SEPARATOR, type ContextEntry } from "../contextMenus/contextItems";
import { RenameInput } from "../primitives/RenameInput";
import { Tooltip } from "../primitives/Tooltip";
import { openStampEditor } from "../stampEditor/stampEditorSession";
import { ListGlyph, StarGlyph, TagGlyph, TilesGlyph } from "./glyphs";
import { installStampInspector } from "./StampInspector";
import { NO_FILTER, filterStamps, pruneFilter, stampCategories, stampTags, type StampFilter } from "./stampFilters";
import { CARD_MAX, CARD_MIN, useStampLibrary } from "./stampLibraryStore";
import { StampThumb } from "./StampThumb";
import { stampLayerCounts } from "./stampThumb";

installStampInspector();

/** True while the map has a marquee to save. */
function useCanSave(): boolean {
  return useEditorStore((s) => s.project !== null && s.region !== null && stampRegion() !== null);
}

/** "Yerleştir": the stamp goes on the brush (one click places it with all its layers); the card selection makes way for the brush card. */
export function placeLibraryStamp(id: string): void {
  pickStamp(id);
  if (activeStampId(useEditorStore.getState().stamp) === id) useStampLibrary.getState().select(null);
}

/** Right-click menu of a stamp card (also the inspector's "…"). */
export function stampMenuItems(stamp: Stamp, onRename: () => void): ContextEntry[] {
  const lib = useStampLibrary.getState();
  return [
    { type: "item", id: "place", label: t("stampLib.place"), icon: "stamp", run: () => placeLibraryStamp(stamp.id) },
    { type: "item", id: "edit", label: t("stampLib.edit"), icon: "pencil", run: () => void openStampEditor(stamp.id) },
    { type: "item", id: "rename", label: t("stamps.rename"), icon: "pencilLine", run: onRename },
    SEPARATOR,
    {
      type: "item",
      id: "category",
      label: t("stampLib.categoryMenu"),
      icon: "folder",
      submenu: [
        ...stampCategories(useProjectLibrary.getState().stamps).map(
          (c): ContextEntry => ({ type: "item", id: `category:${c.name}`, label: c.name, checked: stamp.category === c.name, run: () => void setStampMeta(stamp.id, { category: c.name }) }),
        ),
        { type: "item", id: "category:none", label: t("stampLib.categoryPlaceholder"), checked: !stamp.category, run: () => void setStampMeta(stamp.id, { category: "" }) },
        SEPARATOR,
        { type: "item", id: "category:new", label: t("stampLib.newCategory"), run: () => lib.requestFocus(stamp.id, "category") },
      ],
    },
    { type: "item", id: "tags", label: t("stampLib.tagsMenu"), icon: "bricks", run: () => lib.requestFocus(stamp.id, "tags") },
    {
      type: "item",
      id: "favorite",
      label: stamp.favorite ? t("stampLib.unfavorite") : t("stampLib.favorite"),
      icon: "pin",
      run: () => toggleStampFavorite(stamp.id),
    },
    SEPARATOR,
    { type: "item", id: "duplicate", label: t("contextMenu.duplicate"), icon: "copy", run: () => void duplicateStamp(stamp.id) },
    { type: "item", id: "addToRandom", label: t("randomSets.addStamp"), icon: "dice", run: () => addStampToRandomSet(stamp.id) },
    SEPARATOR,
    { type: "item", id: "delete", label: t("stamps.delete"), icon: "trash", danger: true, run: () => deleteStamp(stamp.id) },
  ];
}

/**
 * The library's "Stamp'ler" tab (v0.6, round 5 library): search, category
 * chips with counts, ★ favourites, tag chips, card size, grid / list. Click
 * a card to select it (Denetçi shows it), double-click or "Yerleştir" to put
 * it on the brush. Stamps are flat copies, never linked to the map.
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
          <IconButton aria-label={t("stamps.save")} className="size-7" aria-disabled={!canSave} onClick={() => runCommand("stamp.saveSelection")}>
            <Icon name="plus" size={15} className={canSave ? "" : "opacity-40"} />
          </IconButton>
        </Tooltip>
      }
    >
      {stamps.length === 0 ? <EmptyStamps canSave={canSave} /> : <StampLibrary stamps={stamps} canSave={canSave} />}
    </PanelSection>
  );
}

function EmptyStamps({ canSave }: { canSave: boolean }) {
  return (
    <div className="mx-3 mb-3 flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong px-5 text-center">
      <Icon name="stamp" size={22} className="text-faint" />
      <div className="text-md text-muted">{t("stamps.empty")}</div>
      <div className="text-xs leading-4 text-faint">{t("stamps.emptyHint")}</div>
      <Button variant={canSave ? "primary" : "secondary"} className="mt-1 h-7 px-2.5 text-sm" disabled={!canSave} onClick={() => runCommand("stamp.saveSelection")}>
        <Icon name="stamp" size={14} />
        {t("stamps.saveShort")}
      </Button>
      {!canSave && <div className="text-2xs text-faint">{t("stamps.saveDisabled")}</div>}
    </div>
  );
}

function StampLibrary({ stamps, canSave }: { stamps: readonly Stamp[]; canSave: boolean }) {
  const filter = useStampLibrary((s) => s.filter);
  const view = useStampLibrary((s) => s.view);
  const cardSize = useStampLibrary((s) => s.cardSize);
  const selectedId = useStampLibrary((s) => s.selectedId);
  const activeId = useEditorStore((s) => activeStampId(s.stamp));
  const [editingId, setEditingId] = useState<string | null>(null);

  // A chip whose last stamp went away is dropped; a deleted stamp's selection too.
  useEffect(() => {
    const lib = useStampLibrary.getState();
    const pruned = pruneFilter(lib.filter, stamps);
    if (pruned !== lib.filter) lib.setFilter(pruned);
    if (lib.selectedId && !stamps.some((s) => s.id === lib.selectedId)) lib.select(null);
  }, [stamps]);

  const shown = useMemo(() => filterStamps(stamps, filter), [stamps, filter]);
  const filtered = filter.query !== "" || filter.category !== null || filter.tag !== null || filter.favoritesOnly;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-stamp-library="">
      {canSave && (
        <div className="mx-2 mb-2 flex shrink-0 items-center gap-2 rounded-md border border-accent-line bg-accent-soft py-1 pr-1 pl-2">
          <Icon name="select" size={14} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate text-xs text-muted">{t("stamps.save")}</span>
          <Button variant="primary" className="h-6 shrink-0 px-2 text-sm" onClick={() => runCommand("stamp.saveSelection")}>
            {t("common.save")}
          </Button>
        </div>
      )}
      <FilterBar stamps={stamps} filter={filter} />
      {shown.length === 0 ? (
        <div className="mx-3 my-2 flex flex-1 flex-col items-center justify-center gap-2 text-center" data-stamp-nomatch="">
          <Icon name="search" size={20} className="text-faint" />
          <span className="text-md text-muted">{t("stampLib.noMatch")}</span>
          <Button className="h-7 px-2.5 text-sm" onClick={() => useStampLibrary.getState().setFilter(NO_FILTER)}>
            {t("stampLib.resetFilters")}
          </Button>
        </div>
      ) : (
        <ul
          role="listbox"
          aria-label={t("stamps.list")}
          data-stamp-view={view}
          onKeyDown={(e) => {
            if (e.key === "Escape" && useStampLibrary.getState().selectedId) {
              e.stopPropagation();
              useStampLibrary.getState().select(null);
            }
          }}
          className={
            view === "grid"
              ? "grid min-h-0 flex-1 auto-rows-min gap-1.5 overflow-y-auto px-2 pb-2"
              : "flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1.5 pb-2"
          }
          style={view === "grid" ? { gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${cardSize}px), 1fr))` } : undefined}
        >
          {shown.map((stamp) => (
            <StampItem
              key={stamp.id}
              stamp={stamp}
              view={view}
              thumbHeight={Math.round(cardSize * 0.62)}
              selected={stamp.id === selectedId}
              onBrush={stamp.id === activeId}
              editing={editingId === stamp.id}
              onEdit={(on) => setEditingId(on ? stamp.id : null)}
            />
          ))}
        </ul>
      )}
      <footer className="flex h-8 shrink-0 items-center gap-2 border-t border-line-subtle pr-1.5 pl-3 text-2xs text-faint">
        <span className="min-w-0 flex-1 truncate font-mono tabular" title={t("stampLib.hint")}>
          {filtered ? t("stampLib.count", { shown: shown.length, total: stamps.length }) : t("stampLib.hint")}
        </span>
        {view === "grid" && (
          <input
            type="range"
            min={CARD_MIN}
            max={CARD_MAX}
            step={4}
            value={cardSize}
            aria-label={t("stampLib.cardSize")}
            title={t("stampLib.cardSize")}
            data-stamp-card-size=""
            onChange={(e) => useStampLibrary.getState().setCardSize(Number(e.target.value))}
            className="h-1 w-20 shrink-0 cursor-pointer accent-accent"
          />
        )}
        <ViewToggle view={view} />
      </footer>
    </div>
  );
}

function ViewToggle({ view }: { view: "grid" | "list" }) {
  const set = useStampLibrary.getState().setView;
  const item = (id: "grid" | "list", label: string, glyph: ReactNode) => (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={view === id}
        data-stamp-view-button={id}
        onClick={() => set(id)}
        className={`grid size-6 place-items-center rounded-sm transition-colors ${view === id ? "bg-active text-accent" : "text-faint hover:bg-hover hover:text-text"}`}
      >
        {glyph}
      </button>
    </Tooltip>
  );
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {item("grid", t("stampLib.gridView"), <TilesGlyph size={13} />)}
      {item("list", t("stampLib.listView"), <ListGlyph size={13} />)}
    </div>
  );
}

/** Search field, ★ toggle, category chips (Tümü + counts) and tag chips. */
function FilterBar({ stamps, filter }: { stamps: readonly Stamp[]; filter: StampFilter }) {
  const setFilter = useStampLibrary.getState().setFilter;
  const categories = useMemo(() => stampCategories(stamps), [stamps]);
  const tags = useMemo(() => stampTags(stamps), [stamps]);
  const favorites = stamps.filter((s) => s.favorite).length;
  return (
    <div className="flex shrink-0 flex-col gap-1.5 px-2 pb-2" data-stamp-filters="">
      <div className="flex items-center gap-1.5">
        <label className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-line bg-raised px-2 focus-within:border-accent">
          <Icon name="search" size={13} className="shrink-0 text-faint" />
          <input
            value={filter.query}
            onChange={(e) => setFilter({ query: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Escape" && filter.query !== "") {
                e.preventDefault();
                e.stopPropagation();
                setFilter({ query: "" });
              }
            }}
            placeholder={t("stampLib.search")}
            aria-label={t("stampLib.search")}
            data-stamp-search=""
            spellCheck={false}
            autoComplete="off"
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-text placeholder:text-faint focus:outline-none"
          />
          {filter.query !== "" && (
            <button type="button" aria-label={t("stampLib.clearSearch")} onClick={() => setFilter({ query: "" })} className="grid size-4 place-items-center rounded-xs text-faint hover:text-text">
              <Icon name="x" size={11} />
            </button>
          )}
        </label>
        <Tooltip label={t("stampLib.favoritesOnly")}>
          <button
            type="button"
            aria-label={t("stampLib.favoritesOnly")}
            aria-pressed={filter.favoritesOnly}
            data-stamp-favorites=""
            disabled={favorites === 0 && !filter.favoritesOnly}
            onClick={() => setFilter({ favoritesOnly: !filter.favoritesOnly })}
            className={`flex h-7 shrink-0 items-center gap-1 rounded-md border px-1.5 text-2xs transition-colors disabled:opacity-40 ${
              filter.favoritesOnly ? "border-accent-line bg-accent-soft text-warning" : "border-line bg-raised text-faint hover:border-line-strong hover:text-text"
            }`}
          >
            <StarGlyph on={filter.favoritesOnly} size={13} />
            <span className="font-mono tabular">{favorites}</span>
          </button>
        </Tooltip>
      </div>
      {categories.length > 0 && (
        <div role="group" aria-label={t("stampLib.categories")} className="flex flex-wrap gap-1">
          <Chip on={filter.category === null} count={stamps.length} onClick={() => setFilter({ category: null })} data="*">
            {t("stampLib.all")}
          </Chip>
          {categories.map((c) => (
            <Chip key={c.name} on={filter.category === c.name} count={c.count} onClick={() => setFilter({ category: filter.category === c.name ? null : c.name })} data={c.name}>
              {c.name}
            </Chip>
          ))}
        </div>
      )}
      {tags.length > 0 && (
        <div role="group" aria-label={t("stampLib.tags")} className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <button
              key={tag.name}
              type="button"
              aria-pressed={filter.tag === tag.name}
              data-stamp-tag-chip={tag.name}
              onClick={() => setFilter({ tag: filter.tag === tag.name ? null : tag.name })}
              className={`flex h-5 max-w-full items-center gap-1 rounded-full px-1.5 text-2xs transition-colors ${
                filter.tag === tag.name ? "bg-accent text-on-accent" : "bg-raised text-muted hover:bg-hover hover:text-text"
              }`}
            >
              <TagGlyph size={10} className="shrink-0" />
              <span className="truncate">{tag.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({ on, count, onClick, data, children }: { on: boolean; count: number; onClick(): void; data: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      data-stamp-category-chip={data}
      onClick={onClick}
      className={`flex h-6 max-w-full items-center gap-1.5 rounded-md border px-2 text-sm transition-colors ${
        on ? "border-accent-line bg-accent-soft text-accent" : "border-line-subtle text-muted hover:border-line-strong hover:text-text"
      }`}
    >
      <span className="truncate">{children}</span>
      <span className={`font-mono text-2xs tabular ${on ? "text-accent/80" : "text-faint"}`}>{count}</span>
    </button>
  );
}

function StampItem({
  stamp,
  view,
  thumbHeight,
  selected,
  onBrush,
  editing,
  onEdit,
}: {
  stamp: Stamp;
  view: "grid" | "list";
  thumbHeight: number;
  selected: boolean;
  onBrush: boolean;
  editing: boolean;
  onEdit(on: boolean): void;
}) {
  const counts = stampLayerCounts(stamp);
  const select = () => useStampLibrary.getState().select(stamp.id);
  const name = editing ? (
    <RenameInput
      initial={stamp.name}
      label={t("stamps.nameLabel")}
      className="h-5 text-sm"
      onDone={(next) => {
        onEdit(false);
        if (next !== null) renameStamp(stamp.id, next);
      }}
    />
  ) : (
    <span className={`min-w-0 flex-1 truncate text-sm ${selected || onBrush ? "text-title" : "text-text"}`}>{stamp.name}</span>
  );
  const meta = (
    <span className="flex min-w-0 items-center gap-1 font-mono text-2xs text-faint tabular">
      {t("stamps.size", { width: stamp.width, height: stamp.height })}
      <span aria-hidden>·</span>
      <span className="truncate font-sans">{t("stamps.layers", { count: counts.tile + counts.grid })}</span>
      {counts.grid > 0 && <Icon name="shield" size={10} className="shrink-0 text-collision-solid/80" />}
      {view === "list" && stamp.category && (
        <>
          <span aria-hidden>·</span>
          <span className="truncate font-sans">{stamp.category}</span>
        </>
      )}
    </span>
  );
  const star = (
    <button
      type="button"
      aria-label={stamp.favorite ? t("stampLib.unfavorite") : t("stampLib.favorite")}
      aria-pressed={!!stamp.favorite}
      data-stamp-star=""
      onClick={(e) => {
        e.stopPropagation();
        toggleStampFavorite(stamp.id);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className={`grid size-6 shrink-0 place-items-center rounded-sm transition-colors hover:bg-active ${
        stamp.favorite ? "text-warning" : "text-faint opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 hover:text-text focus-visible:opacity-100"
      } ${selected && !stamp.favorite ? "opacity-100" : ""}`}
    >
      <StarGlyph on={!!stamp.favorite} size={13} />
    </button>
  );
  return (
    <RowContextMenu
      disabled={editing}
      onOpen={select}
      items={() => stampMenuItems(stamp, () => onEdit(true))}
      render={
        <li
          role="option"
          aria-selected={selected}
          data-stamp-id={stamp.id}
          tabIndex={0}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("input")) return;
            select();
          }}
          onDoubleClick={(e) => {
            if ((e.target as HTMLElement).closest("input")) return;
            placeLibraryStamp(stamp.id);
          }}
          onKeyDown={(e) => {
            if (editing || e.target !== e.currentTarget) return;
            if (e.key === "Enter") {
              e.preventDefault();
              placeLibraryStamp(stamp.id);
            } else if (e.key === " ") {
              e.preventDefault();
              select();
            } else if (e.key === "F2") {
              e.preventDefault();
              onEdit(true);
            } else if (e.key === "Delete") {
              e.preventDefault();
              e.stopPropagation();
              deleteStamp(stamp.id);
            }
          }}
          onFocus={(e) => {
            if (e.target === e.currentTarget) select();
          }}
          className={`group relative flex min-w-0 cursor-default rounded-md border transition-colors focus-visible:outline-offset-0 ${
            view === "grid" ? "flex-col gap-1 p-1" : "items-center gap-2 p-1 pr-0.5"
          } ${selected ? "border-accent bg-accent-soft" : onBrush ? "border-accent-line" : "border-transparent hover:border-line-strong hover:bg-hover"} ${
            view === "grid" && !selected && !onBrush ? "border-line-subtle" : ""
          }`}
        />
      }
    >
      {view === "grid" ? (
        <>
          <StampThumb stamp={stamp} height={thumbHeight} />
          <div className="flex min-w-0 items-start gap-0.5 pb-0.5 pl-0.5">
            <div className="flex min-w-0 flex-1 flex-col">
              {name}
              {meta}
            </div>
            {star}
          </div>
          {onBrush && (
            <span className="absolute top-1.5 left-1.5 rounded-xs bg-accent px-1 text-2xs leading-[14px] font-medium text-on-accent">{t("stamps.active")}</span>
          )}
        </>
      ) : (
        <>
          <div className="w-12 shrink-0">
            <StampThumb stamp={stamp} height={36} pad={2} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-1.5">
              {name}
              {onBrush && <span className="shrink-0 rounded-xs bg-accent px-1 text-2xs leading-[14px] font-medium text-on-accent">{t("stamps.active")}</span>}
            </span>
            {meta}
          </div>
          {star}
        </>
      )}
    </RowContextMenu>
  );
}
