/**
 * Denetçi section of the stamp selected in the library (round 5): large
 * preview, size and layers, category and tags (saved with the project in
 * `stamps/<id>.json`), ★, "Stamp olarak yerleştir" and "Düzenle".
 * Stamps are flat copies: nothing here refers to maps that already hold one.
 */
import type { Stamp } from "@smap/core";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";

import { activeStampId, pickStamp, setStampMeta, toggleStampFavorite } from "../../commands/stampActions";
import { t } from "../../i18n";
import { useProjectLibrary } from "../../io/projectLibrary";
import { useEditorStore } from "../../state/editorStore";
import { Button, IconButton } from "../primitives/Button";
import { PropRow, PropValue } from "../primitives/PropRow";
import { SectionHeader } from "../primitives/SectionHeader";
import { TextField } from "../primitives/TextField";
import { registerInspectorSection } from "../inspector/registry";
import { Icon } from "../primitives/Icon";
import { Tooltip } from "../primitives/Tooltip";
import { openStampEditor } from "../stampEditor/stampEditorSession";
import { StarGlyph, TagGlyph } from "./glyphs";
import { parseTags, stampCategories } from "./stampFilters";
import { useUiStore } from "../uiStore";
import { useTerrainDraft } from "../terrain/terrainDraft";
import { useStampLibrary } from "./stampLibraryStore";
import { StampThumb } from "./StampThumb";

function selectedStamp(): Stamp | undefined {
  const id = useStampLibrary.getState().selectedId;
  return id ? useProjectLibrary.getState().stamps.find((s) => s.id === id) : undefined;
}

let installed = false;

/**
 * Registers the section once. The inspector re-evaluates `when` on its own
 * renders only, so a selection change re-registers it (that bumps the
 * inspector's version).
 */
export function installStampInspector(): void {
  if (installed) return;
  installed = true;
  const register = () =>
    registerInspectorSection({
      id: "stamps.selected",
      order: 5,
      when: (ctx) => ctx.mode === "stamp" && selectedStamp() !== undefined,
      Component: StampSection,
    });
  register();
  const clear = () => useStampLibrary.getState().select(null);
  useEditorStore.subscribe((state, prev) => {
    if (state.region !== null && state.region !== prev.region) clear();
  });
  useUiStore.subscribe((state, prev) => {
    if (state.tilesetMode === "terrain" && state.tilesetMode !== prev.tilesetMode) clear();
  });
  useTerrainDraft.subscribe((state, prev) => {
    if ((state.draft !== null && state.draft !== prev.draft) || (state.fix !== null && state.fix !== prev.fix)) clear();
  });
  useStampLibrary.subscribe((state, prev) => {
    if (state.selectedId !== prev.selectedId) register();
  });
  useProjectLibrary.subscribe((state, prev) => {
    if (state.stamps !== prev.stamps && useStampLibrary.getState().selectedId) register();
  });
}

function StampSection() {
  const id = useStampLibrary((s) => s.selectedId);
  const stamp = useProjectLibrary((s) => s.stamps.find((x) => x.id === id));
  if (!stamp) return null;
  return <StampCard key={stamp.id} stamp={stamp} />;
}

function StampCard({ stamp }: { stamp: Stamp }) {
  const place = () => {
    pickStamp(stamp.id);
    if (activeStampId(useEditorStore.getState().stamp) === stamp.id) useStampLibrary.getState().select(null);
  };
  const layers = stamp.layers.map((l) => l.name).join(", ") || t("stamps.layers", { count: 0 });
  return (
    <section aria-label={t("stampLib.section")} data-stamp-inspector={stamp.id}>
      <SectionHeader
        title={t("stampLib.section")}
        padding={12}
        actions={
          <>
            <Tooltip label={stamp.favorite ? t("stampLib.unfavorite") : t("stampLib.favorite")}>
              <IconButton
                size="sm"
                aria-label={stamp.favorite ? t("stampLib.unfavorite") : t("stampLib.favorite")}
                aria-pressed={!!stamp.favorite}
                data-stamp-inspector-star=""
                onClick={() => toggleStampFavorite(stamp.id)}
                className={stamp.favorite ? "text-text" : ""}
              >
                <StarGlyph on={!!stamp.favorite} />
              </IconButton>
            </Tooltip>
            <Tooltip label={t("stampLib.deselect")}>
              <IconButton size="sm" aria-label={t("stampLib.deselect")} onClick={() => useStampLibrary.getState().select(null)}>
                <Icon name="x" size={16} />
              </IconButton>
            </Tooltip>
          </>
        }
      />
      <div className="flex flex-col gap-2 px-3 pb-3">
        <div className="overflow-hidden rounded-sm border border-line-subtle">
          <StampThumb stamp={stamp} height={120} pad={8} />
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <Icon name="stamp" size={16} className="shrink-0 text-muted" />
          <span className="truncate text-md font-semibold text-title" data-inspector-title>
            {stamp.name}
          </span>
        </div>
        <div>
          <PropRow label={t("stampLib.sizeLabel")}>
            <PropValue align="left">{t("stamps.size", { width: stamp.width, height: stamp.height })}</PropValue>
          </PropRow>
          <PropRow label={t("stampLib.layersLabel")}>
            <PropValue align="left" title={layers}>
              {layers}
            </PropValue>
          </PropRow>
          <PropRow label={t("stampLib.categoryLabel")}>
            <CategoryField stamp={stamp} />
          </PropRow>
          {/* Tags wrap onto several lines, so this row grows instead of using the fixed-height PropRow. */}
          <div className="flex items-start gap-2 py-0.5">
            <span className="w-proplabel shrink-0 truncate text-sm leading-6 text-muted">{t("stampLib.tagsLabel")}</span>
            <div className="min-w-0 flex-1">
              <TagsField stamp={stamp} />
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" data-action="placeStamp" onClick={place}>
            {t("stampLib.placeAsStamp")}
          </Button>
          <Button size="sm" variant="secondary" data-action="editStamp" onClick={() => void openStampEditor(stamp.id)}>
            {t("stampLib.edit")}
          </Button>
        </div>
      </div>
    </section>
  );
}

/** Focuses `ref` when the card menu asked for `field` ("Kategori…" / "Etiketler…"). */
function useFocusRequest(stampId: string, field: "category" | "tags", ref: RefObject<HTMLInputElement | null>): void {
  const tick = useStampLibrary((s) => (s.focusField === field && s.selectedId === stampId ? s.focusTick : 0));
  useEffect(() => {
    if (tick === 0) return;
    // After the menu closes and returns focus to its trigger.
    const timer = setTimeout(() => {
      ref.current?.focus();
      ref.current?.select();
    }, 30);
    return () => clearTimeout(timer);
  }, [tick, ref]);
}

function CategoryField({ stamp }: { stamp: Stamp }) {
  const ref = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [value, setValue] = useState(stamp.category ?? "");
  const all = useProjectLibrary((s) => s.stamps);
  useEffect(() => setValue(stamp.category ?? ""), [stamp.category]);
  useFocusRequest(stamp.id, "category", ref);
  const commit = () => {
    if (value.trim() !== (stamp.category ?? "")) setStampMeta(stamp.id, { category: value.trim() });
    else setValue(stamp.category ?? "");
  };
  return (
    <>
      <TextField
        size="sm"
        ref={ref}
        value={value}
        list={listId}
        maxLength={64}
        aria-label={t("stampLib.categoryLabel")}
        placeholder={t("stampLib.categoryPlaceholder")}
        data-stamp-category-input=""
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setValue(stamp.category ?? "");
            e.currentTarget.blur();
          }
        }}
        className="flex-1"
      />
      <datalist id={listId}>
        {stampCategories(all).map((c) => (
          <option key={c.name} value={c.name} />
        ))}
      </datalist>
    </>
  );
}

function TagsField({ stamp }: { stamp: Stamp }) {
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const tags = stamp.tags ?? [];
  useFocusRequest(stamp.id, "tags", ref);
  const add = () => {
    const extra = parseTags(draft);
    setDraft("");
    if (extra.length > 0) setStampMeta(stamp.id, { tags: [...tags, ...extra] });
  };
  const remove = (tag: string) => setStampMeta(stamp.id, { tags: tags.filter((x) => x !== tag) });
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    } else if (e.key === "Backspace" && draft === "" && tags.length > 0) {
      e.preventDefault();
      remove(tags[tags.length - 1]!);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setDraft("");
      e.currentTarget.blur();
    }
  };
  return (
    <div
      className="flex min-h-6 w-full flex-wrap items-center gap-1 rounded-sm border border-line bg-field p-0.5 focus-within:border-accent"
      data-stamp-tags-editor=""
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.focus();
      }}
    >
      {tags.map((tag) => (
        <span key={tag} className="flex h-5 max-w-full items-center gap-1 rounded-sm bg-active pr-0.5 pl-1.5 text-xs text-text" data-stamp-tag={tag}>
          <TagGlyph size={12} className="shrink-0 text-faint" />
          <span className="truncate">{tag}</span>
          <button
            type="button"
            aria-label={t("stampLib.removeTag", { tag })}
            onClick={() => remove(tag)}
            className="grid size-4 shrink-0 place-items-center rounded-sm text-faint hover:bg-hover hover:text-text"
          >
            <Icon name="x" size={12} />
          </button>
        </span>
      ))}
      <input
        ref={ref}
        value={draft}
        maxLength={64}
        aria-label={t("stampLib.tagsLabel")}
        placeholder={tags.length === 0 ? t("stampLib.tagPlaceholder") : ""}
        data-stamp-tag-input=""
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={add}
        onKeyDown={onKeyDown}
        className="h-5 min-w-16 flex-1 bg-transparent px-1 text-sm text-text placeholder:text-faint focus:outline-none"
      />
    </div>
  );
}
