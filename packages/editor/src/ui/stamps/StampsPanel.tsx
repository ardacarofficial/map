import type { Stamp } from "@smap/core";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { addStampToRandomSet } from "../../commands/randomBrush";
import { activeStampId, deleteStamp, duplicateStamp, pickStamp, renameStamp, setStampMeta, toggleStampFavorite } from "../../commands/stampActions";
import { t } from "../../i18n";
import { useProjectLibrary } from "../../io/projectLibrary";
import { useEditorStore } from "../../state/editorStore";
import { Button, IconButton } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { RowContextMenu } from "../contextMenus/RowContextMenu";
import { SEPARATOR, type ContextEntry } from "../contextMenus/contextItems";
import { RenameInput } from "../primitives/RenameInput";
import { Tooltip } from "../primitives/Tooltip";
import { openStampEditor } from "../stampEditor/stampEditorSession";
import { StarGlyph, TagGlyph, ListGlyph } from "./glyphs";
import { TextField } from "../primitives/TextField";
import { installStampInspector } from "./StampInspector";
import { NO_FILTER, filterStamps, pruneFilter, stampCategories, stampTags, type StampFilter } from "./stampFilters";
import { CARD_MAX, CARD_MIN, useStampLibrary } from "./stampLibraryStore";
import { StampThumb } from "./StampThumb";
import { askText } from "../tileset/TextPrompt";
import { stampLayerCounts } from "./stampThumb";

installStampInspector();

/** "Yerleştir": the stamp goes on the brush (one click places it with all its layers); the card selection makes way for the brush card. */
export function placeLibraryStamp(id: string): void {
  const tool = useEditorStore.getState().tool;
  pickStamp(id);
  if (["fill", "rect"].includes(tool)) useEditorStore.getState().setTool(tool);
  if (activeStampId(useEditorStore.getState().stamp) === id) useStampLibrary.getState().select(null);
}

/** "Kategori ▸ Yeni kategori…": asks for a name in a small prompt, then puts the stamp in that (new) category. */
export async function assignNewCategory(stampId: string): Promise<void> {
  const name = await askText({
    title: t("stampLib.newCategoryTitle"),
    label: t("stampLib.categoryLabel"),
    initial: "",
    confirm: t("stampLib.newCategoryConfirm"),
  });
  if (name && useProjectLibrary.getState().stamps.some((s) => s.id === stampId)) setStampMeta(stampId, { category: name });
}

/** Right-click menu of a stamp card (also the inspector's "…"). */
export function stampMenuItems(stamp: Stamp, onRename: () => void): ContextEntry[] {
  const lib = useStampLibrary.getState();
  return [
    {
      type: "item",
      id: "place",
      label: t("stampLib.place"),
      icon: "stamp",
      run: () => placeLibraryStamp(stamp.id),
    },
    {
      type: "item",
      id: "edit",
      label: t("stampLib.edit"),
      icon: "pencil",
      run: () => void openStampEditor(stamp.id),
    },
    {
      type: "item",
      id: "rename",
      label: t("stamps.rename"),
      icon: "pencilLine",
      run: onRename,
    },
    SEPARATOR,
    {
      type: "item",
      id: "category",
      label: t("stampLib.categoryMenu"),
      icon: "folder",
      submenu: [
        ...stampCategories(useProjectLibrary.getState().stamps).map(
          (c): ContextEntry => ({
            type: "item",
            id: `category:${c.name}`,
            label: c.name,
            checked: stamp.category === c.name,
            run: () => void setStampMeta(stamp.id, { category: c.name }),
          }),
        ),
        {
          type: "item",
          id: "category:none",
          label: t("stampLib.categoryPlaceholder"),
          checked: !stamp.category,
          run: () => void setStampMeta(stamp.id, { category: "" }),
        },
        SEPARATOR,
        {
          type: "item",
          id: "category:new",
          label: t("stampLib.newCategory"),
          run: () => void assignNewCategory(stamp.id),
        },
      ],
    },
    {
      type: "item", id: "tags",
      label: t("stampLib.tagsMenu"),
      icon: "bricks",
      run: () => lib.requestFocus(stamp.id, "tags"),
    },
    {
      type: "item",
      id: "favorite",
      label: stamp.favorite ? t("stampLib.unfavorite") : t("stampLib.favorite"),
      icon: "pin",
      run: () => toggleStampFavorite(stamp.id),
    },
    SEPARATOR,
    {
      type: "item",
      id: "duplicate",
      label: t("contextMenu.duplicate"),
      icon: "copy",
      run: () => void duplicateStamp(stamp.id),
    },
    {
      type: "item",
      id: "addToRandom",
      label: t("randomSets.addStamp"),
      icon: "dice",
      run: () => addStampToRandomSet(stamp.id),
    },
    SEPARATOR,
    {
      type: "item",
      id: "delete",
      label: t("stamps.delete"),
      icon: "trash",
      danger: true,
      run: () => deleteStamp(stamp.id),
    },
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
  return <StampLibrary stamps={stamps} />;
}

function EmptyStamps() {
  return (
    <div className="flex flex-1 flex-col gap-2 p-2 pt-4">
      <p className="text-sm text-muted">{t("stamps.empty")}</p>
      <p className="text-xs text-faint">{t("stamps.emptyHint")}</p>
    </div>
  );
}

function StampLibrary({ stamps }: { stamps: readonly Stamp[] }) {
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

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-stamp-library="">
      {stamps.length > 0 && <FilterBar stamps={stamps} filter={filter} view={view} />}
      {stamps.length === 0 ? (
        <EmptyStamps />
      ) : shown.length === 0 ? (
        <div className="flex flex-1 flex-col items-start gap-2 p-2" data-stamp-nomatch="">
          <span className="text-sm text-muted">{t("stampLib.noMatch")}</span>
          <Button variant="ghost" size="sm" onClick={() => useStampLibrary.getState().setFilter(NO_FILTER)}>
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
          className={view === "grid" ? "grid min-h-0 flex-1 auto-rows-min gap-1.5 overflow-y-auto px-2 pb-2" : "flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1.5 pb-2"}
          style={
            view === "grid"
              ? {
                  gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${cardSize}px), 1fr))`,
                }
              : undefined
          }
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
      {stamps.length > 0 && (
      <div className="flex h-7 shrink-0 items-center justify-between gap-2 border-t border-line-subtle px-2">
        <span className="text-xs text-faint tabular">{t("stampLib.count", { count: shown.length })}</span>
        {view === "grid" && (
          <input
            type="range"
            min={CARD_MIN}
            max={CARD_MAX}
            step={4}
            value={cardSize}
            aria-label={t("stampLib.cardSize")}
            data-stamp-card-size=""
            onChange={(e) => useStampLibrary.getState().setCardSize(Number(e.target.value))}
            className="h-1 w-22 cursor-pointer accent-accent"
          />
        )}
      </div>
      )}
    </div>
  );
}

function ViewToggle({ view }: { view: "grid" | "list" }) {
  const next = view === "grid" ? "list" : "grid";
  const label = t(next === "grid" ? "stampLib.gridView" : "stampLib.listView");
  return (
    <Tooltip label={label}>
      <IconButton size="sm" aria-label={label} data-stamp-view-button={next} onClick={() => useStampLibrary.getState().setView(next)}>
        {next === "grid" ? <Icon name="grid-3x3" size={16} /> : <ListGlyph size={16} />}
      </IconButton>
    </Tooltip>
  );
}

/** Search field, ★ toggle, category chips (Tümü + counts) and tag chips. */
function FilterBar({ stamps, filter, view }: { stamps: readonly Stamp[]; filter: StampFilter; view: "grid" | "list" }) {
  const setFilter = useStampLibrary.getState().setFilter;
  const categories = useMemo(() => stampCategories(stamps), [stamps]);
  const tags = useMemo(() => stampTags(stamps), [stamps]);
  const favorites = stamps.filter((s) => s.favorite).length;
  return (
    <div className="flex shrink-0 flex-col gap-2 p-2" data-stamp-filters="">
      <div className="flex items-center gap-1.5">
        <TextField
          size="sm"
          leadingIcon="search"
          className="flex-1"
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
          trailing={
            filter.query !== "" && (
              <button type="button" aria-label={t("stampLib.clearSearch")} onClick={() => setFilter({ query: "" })} className="text-faint hover:text-text">
                <Icon name="x" size={12} />
              </button>
            )
          }
        />
        <Tooltip label={t("stampLib.favoritesOnly")}>
          <IconButton
            size="sm"
            active={filter.favoritesOnly}
            aria-label={t("stampLib.favoritesOnly")}
            aria-pressed={filter.favoritesOnly}
            data-stamp-favorites=""
            disabled={favorites === 0 && !filter.favoritesOnly}
            onClick={() => setFilter({ favoritesOnly: !filter.favoritesOnly })}
          >
            <StarGlyph on={filter.favoritesOnly} size={16} />
          </IconButton>
        </Tooltip>
        <ViewToggle view={view} />
      </div>
      {categories.length > 0 && (
        <div role="group" aria-label={t("stampLib.categories")} className="flex flex-wrap gap-1">
          <Chip on={filter.category === null} count={stamps.length} onClick={() => setFilter({ category: null })} data="*">
            {t("stampLib.all")}
          </Chip>
          {categories.map((c) => (
            <Chip
              key={c.name}
              on={filter.category === c.name}
              count={c.count}
              onClick={() =>
                setFilter({
                  category: filter.category === c.name ? null : c.name,
                })
              }
              data={c.name}
            >
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
              className={`flex h-5 max-w-full items-center gap-1 rounded-sm border px-2 text-sm transition-colors ${
                filter.tag === tag.name ? "border-accent-line bg-accent-soft text-title" : "border-line-subtle text-muted hover:bg-hover hover:text-text"
              }`}
            >
              <TagGlyph size={12} className="shrink-0" />
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
      className={`flex h-6 max-w-full items-center gap-1.5 rounded-sm border px-2 text-sm transition-colors ${
        on ? "border-accent-line bg-accent-soft text-title" : "border-line-subtle text-muted hover:bg-hover hover:text-text"
      }`}
    >
      <span className="truncate">{children}</span>
      <span className="text-xs text-faint tabular">{count}</span>
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
  const arm = () => { placeLibraryStamp(stamp.id); select(); };
  const name = editing ? (
    <RenameInput
      initial={stamp.name}
      label={t("stamps.nameLabel")}
      onDone={(next) => {
        onEdit(false);
        if (next !== null) renameStamp(stamp.id, next);
      }}
    />
  ) : (
    <span className={`min-w-0 flex-1 truncate text-sm ${selected || onBrush ? "text-title" : "text-text"}`}>{stamp.name}</span>
  );
  const meta = (
    <span className="flex min-w-0 items-center gap-1 text-xs text-faint tabular">
      {t("stamps.size", { width: stamp.width, height: stamp.height })}
      <span aria-hidden>·</span>
      <span className="truncate font-sans">{t("stamps.layers", { count: counts.tile + counts.grid })}</span>
      {counts.grid > 0 && <Icon name="shield" size={12} className="shrink-0 text-muted" />}
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
        stamp.favorite ? "text-text" : "text-faint opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 hover:text-text focus-visible:opacity-100"
      } ${selected && !stamp.favorite ? "opacity-100" : ""}`}
    >
      <StarGlyph on={!!stamp.favorite} size={16} />
    </button>
  );
  const active = onBrush ? (
    <Tooltip label={t("stamps.active")}>
      <span role="img" aria-label={t("stamps.active")} className="shrink-0 text-accent">
        <Icon name="stamp" size={12} />
      </span>
    </Tooltip>
  ) : null;
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
            arm();
          }}
          onDoubleClick={(e) => {
            if ((e.target as HTMLElement).closest("input")) return;
            arm();
          }}
          onKeyDown={(e) => {
            if (editing || e.target !== e.currentTarget) return;
            if (e.key === "Enter") {
              e.preventDefault();
              arm();
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
          className={`group relative flex min-w-0 cursor-default rounded-md border transition-colors outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent-line ${
            view === "grid" ? "flex-col gap-1 p-1" : "h-10 items-center gap-2 p-1"
          } ${selected ? "border-accent-line bg-accent-soft" : onBrush ? "border-accent-line" : "border-transparent hover:bg-hover"}`}
        />
      }
    >
      {view === "grid" ? (
        <>
          <StampThumb stamp={stamp} height={thumbHeight} />
          <div className="flex min-w-0 items-start gap-0.5 pb-0.5 pl-0.5">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="flex min-w-0 items-center gap-1">
                {name}
                {active}
              </span>
              {meta}
            </div>
            {star}
          </div>
        </>
      ) : (
        <>
          <div className="w-12 shrink-0">
            <StampThumb stamp={stamp} height={30} pad={2} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-1.5">
              {name}
              {active}
            </span>
            {meta}
          </div>
          {star}
        </>
      )}
    </RowContextMenu>
  );
}
