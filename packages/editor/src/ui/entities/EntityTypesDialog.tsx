import { Dialog } from "@base-ui/react/dialog";
import { ENTITY_FIELD_TYPES, isBuiltinEntityTypeId, type EntityFieldType, type EntityType, type MapDocument } from "@smap/core";
import { useCallback, useState, type FormEvent, type ReactNode } from "react";

import { entityCounts, entityFieldLabel, entityTypeName, removeEntityType, saveEntityType } from "../../commands/entityActions";
import { t, type MessageKey } from "../../i18n";
import { useProjectLibrary } from "../../io/projectLibrary";
import { useEditorStore } from "../../state/editorStore";
import { backdropClass, popupClass } from "../dialogs/styles";
import { useStructureVersion } from "../hooks";
import { Button, IconButton } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { inputBad, inputClass, inputOk, NativeSelect } from "../primitives/NativeSelect";
import { toast } from "../toast/toastStore";
import { useUiStore } from "../uiStore";
import { TypeMark } from "./EntityPalette";
import { FieldValueEditor } from "./FieldValueEditor";
import {
  draftChanged,
  draftFromType,
  fieldDraftProblems,
  newFieldDraft,
  TYPE_COLORS,
  typeFromDraft,
  withEnumText,
  withFieldType,
  parseEnumValues,
  type FieldDraft,
  type TypeDraft,
} from "./fieldValues";

/** "Entity türleri…": list, add, edit and delete entity types (each save / delete is one undo step). */
export function EntityTypesDialog() {
  const open = useUiStore((s) => s.entityTypesOpen);
  const setOpen = useUiStore((s) => s.setEntityTypesOpen);
  const hasProject = useEditorStore((s) => s.project !== null);
  const show = open && hasProject;
  return (
    <Dialog.Root open={show} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdropClass} />
        <Dialog.Popup className={`${popupClass} flex h-[min(600px,calc(100vh-48px))] w-[760px] max-w-[calc(100vw-32px)] flex-col`}>
          {show && <TypesEditor />}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const NEW_KEY = "\u0000new";

function TypesEditor() {
  const store = useEditorStore((s) => s.project!.store);
  useStructureVersion(store);
  const doc = store.document;
  const all = doc.allEntityTypes();
  const [selected, setSelected] = useState<string>(() => doc.entityTypes[0]?.id ?? all[0]!.id);
  /** Unsaved edits per type (kept while switching between types; dropped on close). */
  const [drafts, setDrafts] = useState<Record<string, TypeDraft>>({});

  const savedType = selected === NEW_KEY ? undefined : doc.getEntityType(selected);
  const builtin = isBuiltinEntityTypeId(selected);
  const draft: TypeDraft | null = builtin
    ? null
    : (drafts[selected] ?? (savedType ? draftFromType(savedType) : null));

  const setDraft = (next: TypeDraft) => setDrafts((d) => ({ ...d, [selected]: next }));
  const dropDraft = (key: string) =>
    setDrafts((d) => {
      const { [key]: _drop, ...rest } = d;
      void _drop;
      return rest;
    });

  const startNew = () => {
    const n = doc.entityTypes.length;
    setDrafts((d) => ({
      ...d,
      [NEW_KEY]: d[NEW_KEY] ?? { id: null, name: t("entities.newTypeName"), color: TYPE_COLORS[n % TYPE_COLORS.length]!, fields: [] },
    }));
    setSelected(NEW_KEY);
  };

  return (
    <>
      <div className="flex flex-col gap-1 border-b border-line px-5 pt-5 pb-4">
        <Dialog.Title className="text-lg font-semibold">{t("entities.typesTitle")}</Dialog.Title>
        <Dialog.Description className="text-md text-muted">{t("entities.typesDescription")}</Dialog.Description>
      </div>
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-[208px] shrink-0 flex-col border-r border-line">
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
            <ListLabel>{t("entities.builtin")}</ListLabel>
            {all
              .filter((ty) => isBuiltinEntityTypeId(ty.id))
              .map((ty) => (
                <TypeRow key={ty.id} type={ty} active={selected === ty.id} locked onClick={() => setSelected(ty.id)} />
              ))}
            <ListLabel>{t("entities.custom")}</ListLabel>
            {doc.entityTypes.map((ty) => (
              <TypeRow
                key={ty.id}
                type={drafts[ty.id] ? { ...ty, name: drafts[ty.id]!.name, color: drafts[ty.id]!.color } : ty}
                active={selected === ty.id}
                dirty={!!drafts[ty.id] && draftChanged(drafts[ty.id]!, ty)}
                onClick={() => setSelected(ty.id)}
              />
            ))}
            {drafts[NEW_KEY] && (
              <TypeRow
                type={{ id: "", name: drafts[NEW_KEY]!.name, color: drafts[NEW_KEY]!.color, fields: [] }}
                active={selected === NEW_KEY}
                dirty
                onClick={() => setSelected(NEW_KEY)}
              />
            )}
            {doc.entityTypes.length === 0 && !drafts[NEW_KEY] && <div className="px-2 py-1 text-xs text-faint">{t("entities.noCustom")}</div>}
          </div>
          <div className="border-t border-line p-2">
            <Button className="h-7 w-full text-sm" onClick={startNew}>
              <Icon name="plus" size={14} />
              {t("entities.newType")}
            </Button>
          </div>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          {builtin && savedType ? (
            <BuiltinView type={savedType} />
          ) : draft ? (
            <DraftForm
              key={selected}
              doc={doc}
              draft={draft}
              saved={savedType}
              onChange={setDraft}
              onSaved={(type) => {
                dropDraft(selected);
                setSelected(type.id);
              }}
              onDiscard={() => {
                dropDraft(selected);
                if (selected === NEW_KEY) setSelected(doc.entityTypes[0]?.id ?? all[0]!.id);
              }}
              onDeleted={() => {
                dropDraft(selected);
                setSelected(all[0]!.id);
              }}
            />
          ) : null}
        </div>
      </div>
    </>
  );
}

function ListLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 pt-2 pb-1 text-2xs font-semibold tracking-wide text-faint first:pt-0">{children}</div>;
}

function TypeRow({
  type,
  active,
  locked = false,
  dirty = false,
  onClick,
}: {
  type: EntityType;
  active: boolean;
  locked?: boolean;
  dirty?: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      aria-current={active || undefined}
      data-type-row={type.id}
      onClick={onClick}
      className={`relative flex h-8 shrink-0 items-center gap-2 rounded-md pr-2 pl-2 text-left text-md ${
        active ? "bg-active text-text" : "text-muted hover:bg-hover hover:text-text"
      }`}
    >
      {active && <span aria-hidden className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-accent" />}
      <TypeMark type={type} size={16} />
      <span className="min-w-0 flex-1 truncate">{entityTypeName(type)}</span>
      {locked && <Icon name="lock" size={12} className="shrink-0 text-faint" />}
      {dirty && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent" />}
    </button>
  );
}

function BuiltinView({ type }: { type: EntityType }) {
  return (
    <div className="flex flex-col gap-4 overflow-y-auto p-5">
      <div className="flex items-center gap-3">
        <TypeMark type={type} size={32} />
        <div className="flex min-w-0 flex-col">
          <span className="text-lg font-semibold">{entityTypeName(type)}</span>
          <span className="font-mono text-xs text-faint">{type.id}</span>
        </div>
      </div>
      <div className="flex items-start gap-2 rounded-md border border-line bg-panel px-3 py-2 text-sm text-muted">
        <Icon name="lock" size={14} className="mt-px shrink-0 text-faint" />
        {t("entities.builtinReadOnly")}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-muted">{t("entities.fields")}</span>
        {type.fields.length === 0 ? (
          <span className="text-sm text-faint">—</span>
        ) : (
          <ul className="flex flex-col divide-y divide-line-subtle rounded-md border border-line">
            {type.fields.map((f) => (
              <li key={f.name} className="flex h-8 items-center gap-3 px-3 text-sm">
                <span className="min-w-0 flex-1 truncate text-text">{entityFieldLabel(type.id, f.name)}</span>
                <span className="font-mono text-2xs text-faint">{f.name}</span>
                <span className="w-24 text-right text-faint">{t(`entities.ftype_${f.type}` as MessageKey)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function DraftForm({
  doc,
  draft,
  saved,
  onChange,
  onSaved,
  onDiscard,
  onDeleted,
}: {
  doc: MapDocument;
  draft: TypeDraft;
  saved: EntityType | undefined;
  onChange(draft: TypeDraft): void;
  onSaved(type: EntityType): void;
  onDiscard(): void;
  onDeleted(): void;
}) {
  const levels = useProjectLibrary((s) => s.levels);
  /** Field rows whose default input holds something invalid right now. */
  const [badInputs, setBadInputs] = useState<ReadonlySet<string>>(new Set());
  const setValidity = useCallback((key: string, valid: boolean) => {
    setBadInputs((prev) => {
      if (prev.has(key) === !valid) return prev;
      const next = new Set(prev);
      if (valid) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const problems = fieldDraftProblems(draft.fields);
  const result = typeFromDraft(draft, doc.entityTypes.map((ty) => ty.id));
  const changed = draftChanged(draft, saved);
  const nameError = draft.name.trim().length === 0 ? t("entities.errTypeName") : null;
  const colorError = /^#[0-9a-fA-F]{6}$/.test(draft.color) ? null : t("entities.errColor");
  const count = saved ? (entityCounts(doc).get(saved.id) ?? 0) : 0;
  const footerError = !result.ok && !nameError && !colorError && problems.every((p) => p === null) ? result.error : null;

  const setField = (index: number, field: FieldDraft) => onChange({ ...draft, fields: draft.fields.map((f, i) => (i === index ? field : f)) });
  const addField = () => {
    const names = new Set(draft.fields.map((f) => f.name));
    let n = draft.fields.length + 1;
    while (names.has(t("entities.newFieldName", { n }))) n++;
    onChange({ ...draft, fields: [...draft.fields, newFieldDraft(t("entities.newFieldName", { n }))] });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!result.ok || !changed || badInputs.size > 0) return;
    if (saveEntityType(result.type)) onSaved(result.type);
  };

  const remove = () => {
    if (!saved) return;
    const store = useEditorStore.getState().project?.store;
    if (!store || !removeEntityType(saved.id)) return;
    onDeleted();
    const depth = store.undoDepth;
    toast.withAction(t("entities.typeRemoved", { name: saved.name }), {
      label: t("common.undo"),
      run: () => {
        if (useEditorStore.getState().project?.store === store && store.undoDepth === depth) store.undo();
      },
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
        <div className="grid grid-cols-[minmax(0,1fr)_150px] gap-3">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-sm font-medium text-muted">{t("entities.name")}</span>
            <input
              value={draft.name}
              onChange={(e) => onChange({ ...draft, name: e.target.value })}
              autoFocus={!saved}
              onFocus={(e) => !saved && e.currentTarget.select()}
              maxLength={64}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={nameError ? true : undefined}
              className={`${inputClass} h-8 ${nameError ? inputBad : inputOk}`}
            />
            {nameError && <span className="text-xs text-danger">{nameError}</span>}
          </label>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-sm font-medium text-muted">{t("entities.color")}</span>
            <span className={`flex h-8 items-center gap-2 rounded-md border bg-panel pr-2 pl-1 focus-within:border-accent ${colorError ? inputBad : inputOk}`}>
              <input
                type="color"
                aria-label={t("entities.color")}
                value={colorError ? "#000000" : draft.color.toLowerCase()}
                onChange={(e) => onChange({ ...draft, color: e.target.value })}
                className="size-6 shrink-0 cursor-pointer rounded-sm border-0 bg-transparent p-0"
              />
              <input
                value={draft.color}
                aria-label={`${t("entities.color")} (hex)`}
                onChange={(e) => onChange({ ...draft, color: e.target.value.trim() })}
                maxLength={7}
                spellCheck={false}
                autoComplete="off"
                className="h-full w-full min-w-0 bg-transparent font-mono text-md text-text uppercase tabular focus-visible:outline-none"
              />
            </span>
            {colorError && <span className="text-xs text-danger">{colorError}</span>}
          </label>
        </div>
        <div className="-mt-2 flex items-center gap-2 text-xs text-faint">
          <span>{t("entities.id")}</span>
          <span className="font-mono text-muted">{draft.id ?? (result.ok ? result.type.id : "—")}</span>
          {!draft.id && <span>· {t("entities.idPending")}</span>}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center">
            <span className="text-sm font-medium text-muted">{t("entities.fields")}</span>
            <Button variant="ghost" className="ml-auto h-7 px-2 text-sm" onClick={addField}>
              <Icon name="plus" size={14} />
              {t("entities.addField")}
            </Button>
          </div>
          {draft.fields.length === 0 ? (
            <div className="rounded-md border border-dashed border-line-strong px-3 py-3 text-center text-sm text-faint">{t("entities.noFields")}</div>
          ) : (
            <div className="flex flex-col rounded-md border border-line">
              <div className="grid grid-cols-[minmax(0,1.1fr)_118px_minmax(0,1.3fr)_28px] gap-2 border-b border-line px-2.5 py-1.5 text-2xs font-semibold tracking-wide text-faint">
                <span>{t("entities.fieldName")}</span>
                <span>{t("entities.fieldType")}</span>
                <span>{t("entities.fieldDefault")}</span>
                <span />
              </div>
              {draft.fields.map((field, index) => (
                <FieldRowEditor
                  key={field.key}
                  field={field}
                  problem={problems[index] ?? null}
                  levels={levels}
                  onChange={(f) => setField(index, f)}
                  onValidity={setValidity}
                  onRemove={() => onChange({ ...draft, fields: draft.fields.filter((_, i) => i !== index) })}
                />
              ))}
            </div>
          )}
        </div>
        {count > 0 && (
          <div className="flex items-start gap-2 text-xs leading-4 text-faint">
            <Icon name="info" size={13} className="mt-px shrink-0" />
            {t("entities.inUse", { count })}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-line px-5 py-3">
        {saved && (
          <Button variant="ghost" className="text-danger hover:text-danger" onClick={remove}>
            <Icon name="trash" size={14} />
            {t("entities.deleteType")}
          </Button>
        )}
        {footerError && <span className="min-w-0 truncate text-xs text-danger" title={footerError}>{footerError.startsWith("entities.") ? t(footerError as MessageKey) : footerError}</span>}
        <div className="ml-auto flex gap-2">
          {changed && (
            <Button variant="ghost" onClick={onDiscard}>
              {t("entities.discard")}
            </Button>
          )}
          {!changed && saved ? (
            <span className="flex h-8 items-center gap-1.5 px-2 text-sm text-faint">
              <Icon name="check" size={14} />
              {t("entities.saved")}
            </span>
          ) : (
            <Button type="submit" variant="primary" disabled={!result.ok || !changed || badInputs.size > 0}>
              {t("entities.saveType")}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}

function FieldRowEditor({
  field,
  problem,
  levels,
  onChange,
  onRemove,
  onValidity,
}: {
  field: FieldDraft;
  problem: MessageKey | null;
  levels: readonly { id: string; name: string }[];
  onChange(field: FieldDraft): void;
  onRemove(): void;
  onValidity(key: string, valid: boolean): void;
}) {
  const { key } = field;
  const reportValidity = useCallback((valid: boolean) => onValidity(key, valid), [onValidity, key]);
  const nameBad = problem === "entities.errFieldName" || problem === "entities.errFieldDup";
  const enumBad = problem === "entities.errEnumEmpty" || problem === "entities.errEnumDup";
  return (
    <div className="flex flex-col gap-1.5 border-b border-line-subtle px-2.5 py-2 last:border-b-0" data-field-row={field.name}>
      <div className="grid grid-cols-[minmax(0,1.1fr)_118px_minmax(0,1.3fr)_28px] items-start gap-2">
        <input
          value={field.name}
          aria-label={t("entities.fieldName")}
          onChange={(e) => onChange({ ...field, name: e.target.value })}
          maxLength={64}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={nameBad || undefined}
          className={`${inputClass} font-mono ${nameBad ? inputBad : inputOk}`}
        />
        <NativeSelect
          aria-label={t("entities.fieldType")}
          value={field.type}
          onChange={(e) => onChange(withFieldType(field, e.target.value as EntityFieldType))}
        >
          {ENTITY_FIELD_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`entities.ftype_${type}` as MessageKey)}
            </option>
          ))}
        </NativeSelect>
        <FieldValueEditor
          live
          field={{ type: field.type, enumValues: parseEnumValues(field.enumText) }}
          value={field.default}
          levels={levels}
          label={t("entities.fieldDefault")}
          onValidity={reportValidity}
          onCommit={(value) => onChange({ ...field, default: value })}
        />
        <IconButton aria-label={t("entities.removeField")} title={t("entities.removeField")} className="size-7 hover:text-danger" onClick={onRemove}>
          <Icon name="x" size={14} />
        </IconButton>
      </div>
      {field.type === "enum" && (
        <label className="flex items-center gap-2 pl-0.5">
          <span className="shrink-0 text-2xs text-faint">{t("entities.enumValues")}</span>
          <input
            value={field.enumText}
            aria-label={t("entities.enumValues")}
            onChange={(e) => onChange(withEnumText(field, e.target.value))}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={enumBad || undefined}
            className={`${inputClass} ${enumBad ? inputBad : inputOk}`}
          />
        </label>
      )}
      {problem && <span className="text-2xs leading-[14px] text-danger">{t(problem)}</span>}
    </div>
  );
}
