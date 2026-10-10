/**
 * Denetçi section of the stamp selected in the library (round 5): large
 * preview, size and layers, category and tags (saved with the project in
 * `stamps/<id>.json`), ★, "Stamp olarak yerleştir", "Düzenle" and
 * flip / rotate (which put the stamp on the brush first). Stamps are flat
 * copies: nothing here refers to maps that already hold one.
 */
import type { Stamp } from "@smap/core";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";

import { getCommand, runCommand } from "../../commands/registry";
import { activeStampId, pickStamp, setStampMeta, toggleStampFavorite } from "../../commands/stampActions";
import { t } from "../../i18n";
import { useProjectLibrary } from "../../io/projectLibrary";
import type { CommandId } from "../../shortcuts/shortcuts";
import { useEditorStore } from "../../state/editorStore";
import { ActionButton, CardDivider, PropGrid, PropRow, ReadField, SectionHeader, SquareAction, TransformGlyph } from "../inspector/parts";
import { registerInspectorSection } from "../inspector/registry";
import { Icon } from "../primitives/Icon";
import { Tooltip } from "../primitives/Tooltip";
import { openStampEditor } from "../stampEditor/stampEditorSession";
import { StarGlyph, TagGlyph } from "./glyphs";
import { parseTags, stampCategories } from "./stampFilters";
import { useStampLibrary } from "./stampLibraryStore";
import { StampThumb } from "./StampThumb";
import { stampLayerCounts } from "./stampThumb";

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
      when: (ctx) => ctx.mode !== "entity" && selectedStamp() !== undefined,
      Component: StampSection,
    });
  register();
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

/** Puts the stamp on the brush (when it is not there yet), then runs a brush transform command. */
function transformStamp(stamp: Stamp, command: CommandId): void {
  if (activeStampId(useEditorStore.getState().stamp) !== stamp.id) pickStamp(stamp.id);
  if (activeStampId(useEditorStore.getState().stamp) === stamp.id) runCommand(command);
}

function StampCard({ stamp }: { stamp: Stamp }) {
  const counts = stampLayerCounts(stamp);
  const onBrush = useEditorStore((s) => activeStampId(s.stamp) === stamp.id);
  const rotate = !!getCommand("edit.rotateCW");
  const place = () => {
    pickStamp(stamp.id);
    if (activeStampId(useEditorStore.getState().stamp) === stamp.id) useStampLibrary.getState().select(null);
  };
  return (
    <section aria-label={t("stampLib.section")} data-stamp-inspector={stamp.id}>
      <SectionHeader
        extra={
          <Tooltip label={t("stampLib.deselect")}>
            <button
              type="button"
              aria-label={t("stampLib.deselect")}
              onClick={() => useStampLibrary.getState().select(null)}
              className="grid size-6 place-items-center rounded-sm text-faint hover:bg-hover hover:text-text"
            >
              <Icon name="x" size={13} />
            </button>
          </Tooltip>
        }
      >
        {t("stampLib.section")}
      </SectionHeader>
      <div className="px-3 pt-1">
        <div className="overflow-hidden rounded-md border border-line">
          <StampThumb stamp={stamp} height={156} pad={8} className="rounded-none" />
        </div>
      </div>
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <span className="min-w-0 flex-1 truncate text-[16px] leading-[22px] font-semibold text-title" data-inspector-title>
          {stamp.name}
        </span>
        <Tooltip label={stamp.favorite ? t("stampLib.unfavorite") : t("stampLib.favorite")}>
          <button
            type="button"
            aria-label={stamp.favorite ? t("stampLib.unfavorite") : t("stampLib.favorite")}
            aria-pressed={!!stamp.favorite}
            data-stamp-inspector-star=""
            onClick={() => toggleStampFavorite(stamp.id)}
            className={`grid size-7 shrink-0 place-items-center rounded-sm transition-colors hover:bg-hover ${stamp.favorite ? "text-warning" : "text-faint hover:text-text"}`}
          >
            <StarGlyph on={!!stamp.favorite} size={16} />
          </button>
        </Tooltip>
      </div>
      <PropGrid>
        <PropRow label={t("stampLib.sizeLabel")}>
          <ReadField>{t("stamps.size", { width: stamp.width, height: stamp.height })}</ReadField>
        </PropRow>
        <PropRow label={t("stampLib.layersLabel")}>
          <ReadField mono={false}>
            <span className="truncate">{stamp.layers.map((l) => l.name).join(", ") || t("stamps.layers", { count: 0 })}</span>
            {counts.grid > 0 && <Icon name="shield" size={12} className="ml-1.5 shrink-0 text-collision-solid/80" />}
          </ReadField>
        </PropRow>
        <PropRow label={t("stampLib.categoryLabel")}>
          <CategoryField stamp={stamp} />
        </PropRow>
      </PropGrid>
      <div className="flex flex-col gap-1.5 px-3 pt-0.5 pb-1.5">
        <span className="text-md text-muted">{t("stampLib.tagsLabel")}</span>
        <TagsField stamp={stamp} />
      </div>
      <div className="flex flex-col gap-2 px-3 pt-2">
        <ActionButton icon="stamp" tone="primary" label={t("stampLib.placeAsStamp")} dataAction="placeStamp" onClick={place} />
        <ActionButton icon="pencil" label={t("stampLib.edit")} dataAction="editStamp" onClick={() => void openStampEditor(stamp.id)} />
      </div>
      <CardDivider />
      <PropGrid>
        <PropRow label={t("inspector.transform")}>
          <SquareAction label={t("inspector.flipX")} command="edit.flipX" onClick={() => transformStamp(stamp, "edit.flipX")}>
            <TransformGlyph kind="flipX" />
          </SquareAction>
          <SquareAction label={t("inspector.flipY")} command="edit.flipY" onClick={() => transformStamp(stamp, "edit.flipY")}>
            <TransformGlyph kind="flipY" />
          </SquareAction>
          <span aria-hidden className="mx-0.5 h-5 w-px bg-line" />
          <SquareAction
            label={rotate ? t("inspector.rotateCCW") : t("inspector.rotateUnavailable")}
            command="edit.rotateCCW"
            disabled={!rotate}
            onClick={() => transformStamp(stamp, "edit.rotateCCW")}
          >
            <TransformGlyph kind="rotateCCW" />
          </SquareAction>
          <SquareAction
            label={rotate ? t("inspector.rotateCW") : t("inspector.rotateUnavailable")}
            command="edit.rotateCW"
            disabled={!rotate}
            onClick={() => transformStamp(stamp, "edit.rotateCW")}
          >
            <TransformGlyph kind="rotateCW" />
          </SquareAction>
        </PropRow>
      </PropGrid>
      <p className="flex items-start gap-1.5 px-3 pt-1 text-xs leading-4 text-faint">
        <Icon name="info" size={12} className="mt-0.5 shrink-0" />
        <span>{onBrush ? t("stamps.hint") : t("stampLib.flatNote")}</span>
      </p>
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

const inputClass =
  "h-7 min-w-0 flex-1 rounded-md border border-line bg-raised px-2 text-md text-text placeholder:text-faint focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:outline-none";

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
      <input
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
        className={inputClass}
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
      className="flex min-h-8 flex-wrap items-center gap-1 rounded-md border border-line bg-raised p-1 focus-within:border-accent"
      data-stamp-tags-editor=""
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.focus();
      }}
    >
      {tags.map((tag) => (
        <span key={tag} className="flex h-5 max-w-full items-center gap-1 rounded-full bg-active pr-0.5 pl-1.5 text-2xs text-text" data-stamp-tag={tag}>
          <TagGlyph size={10} className="shrink-0 text-faint" />
          <span className="truncate">{tag}</span>
          <button
            type="button"
            aria-label={t("stampLib.removeTag", { tag })}
            onClick={() => remove(tag)}
            className="grid size-4 shrink-0 place-items-center rounded-full text-faint hover:bg-hover hover:text-text"
          >
            <Icon name="x" size={10} />
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
