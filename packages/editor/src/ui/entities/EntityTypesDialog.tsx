import { Dialog } from "@base-ui/react/dialog";
import { ENTITY_FIELD_TYPES, isBuiltinEntityTypeId, type EntityFieldType, type EntityType, type MapDocument } from "@smap/core";
import { useCallback, useState, type FormEvent, type ReactNode } from "react";

import { undoStepAction } from "../../commands/undoStepAction";
import { entityCounts, entityFieldLabel, entityTypeName, removeEntityType, saveEntityType } from "../../commands/entityActions";
import { t, type MessageKey } from "../../i18n";
import { useProjectLibrary } from "../../io/projectLibrary";
import { useEditorStore } from "../../state/editorStore";
import { backdropClass, popupClass } from "../dialogs/styles";
import { useStructureVersion } from "../hooks";
import { Button, IconButton } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { inputBad, inputOk, NativeSelect } from "../primitives/NativeSelect";
import { TextField } from "../primitives/TextField";
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
import { selectAll } from "../primitives/selectAll";

/** "Entity türleri…": list, add, edit and delete entity types (each save / delete is one undo step). */
export function EntityTypesDialog() {
  const open = useUiStore((s) => s.entityTypesOpen);
  const setOpen = useUiStore((s) => s.setEntityTypesOpen);
  const hasProject = useEditorStore((s) => s.project !== null);
  const show = open && hasProject;
  return (
    <Dialog.Root open={show} onOpenChange={(next) => setOpen(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdropClass} />
        <Dialog.Popup className={`${popupClass} flex h-[min(600px,calc(100vh-48px))] w-dialog-l max-w-[calc(100vw-32px)] flex-col`}>
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
  const startsNew = useUiStore.getState().entityTypesStartNew;
  const selectId = useUiStore.getState().entityTypesSelect;
  const newDraft = (): TypeDraft => {
    const n = doc.entityTypes.length;
    return { id: null, name: t("entities.newTypeName"), color: TYPE_COLORS[n % TYPE_COLORS.length]!, fields: [] };
  };
  const [selected, setSelected] = useState<string>(() => (startsNew ? NEW_KEY : selectId && doc.getEntityType(selectId) ? selectId : (doc.entityTypes[0]?.id ?? all[0]!.id)));
  /** Unsaved edits per type (kept while switching between types; dropped on close). */
  const [drafts, setDrafts] = useState<Record<string, TypeDraft>>(() => (startsNew ? { [NEW_KEY]: newDraft() } : {}));

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
    setDrafts((d) => ({ ...d, [NEW_KEY]: d[NEW_KEY] ?? newDraft() }));
    setSelected(NEW_KEY);
  };

  return (
    <>
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <Dialog.Title className="flex-1 text-lg font-semibold text-title">{t("entities.typesTitle")}</Dialog.Title>
        <Dialog.Close render={<IconButton size="md" aria-label={t("common.close")}><Icon name="x" size={16} /></IconButton>} />
      </header>
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-52 shrink-0 flex-col border-r border-line">
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
            {doc.entityTypes.length === 0 && !drafts[NEW_KEY] && <div className="px-2 py-1 text-xs text-muted">{t("entities.noCustom")}</div>}
          </div>
          <div className="border-t border-line p-2">
            <Button className="h-control-md w-full text-sm" onClick={startNew}>
              <Icon name="plus" size={16} />
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
  return <div className="flex h-row items-center px-2 text-xs font-semibold tracking-section text-muted uppercase">{children}</div>;
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
      className={`relative flex h-control-md shrink-0 items-center gap-2 rounded-sm pr-2 pl-2 text-left text-md ${
        active ? "bg-accent-soft text-title ring-1 ring-inset ring-accent-line" : "text-text hover:bg-hover"
      }`}
    >
      <TypeMark type={type} size={16} />
      <span className="min-w-0 flex-1 truncate">{entityTypeName(type)}</span>
      {locked && <Icon name="lock" size={12} className="shrink-0 text-muted" />}
      {dirty && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warning" />}
    </button>
  );
}

function BuiltinView({ type }: { type: EntityType }) {
  return (
    <div className="flex flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center gap-3">
        <TypeMark type={type} size={16} />
        <div className="flex min-w-0 flex-col">
          <span className="text-lg font-semibold">{entityTypeName(type)}</span>
          <span className="font-mono text-xs text-muted">{type.id}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 text-sm text-muted">
        <Icon name="lock" size={16} className="mt-px shrink-0 text-muted" />
        {t("entities.builtinReadOnly")}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-muted">{t("entities.fields")}</span>
        {type.fields.length === 0 ? (
          <span className="text-sm text-muted">—</span>
        ) : (
          <ul className="flex flex-col divide-y divide-line-subtle">
            {type.fields.map((f) => (
              <li key={f.name} className="flex h-control-md items-center gap-3 px-3 text-sm">
                <span className="min-w-0 flex-1 truncate text-text">{entityFieldLabel(type.id, f.name)}</span>
                <span className="font-mono text-2xs text-muted">{f.name}</span>
                <span className="w-24 text-right text-muted">{t(`entities.ftype_${f.type}` as MessageKey)}</span>
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
    toast.withAction(t("entities.typeRemoved", { name: saved.name }), undoStepAction(store));
  };

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.5fr)] gap-3">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-sm font-medium text-muted">{t("entities.name")}</span>
            <TextField size="md"
              value={draft.name}
              onChange={(e) => onChange({ ...draft, name: e.target.value })}
              autoFocus={!saved}
              {...selectAll}
              maxLength={64}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={nameError ? true : undefined}
              className={nameError ? "[&>input]:border-danger" : ""}
            />
            {nameError && <span className="text-xs text-danger">{nameError}</span>}
          </label>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-sm font-medium text-muted">{t("entities.color")}</span>
            <span className={`flex h-control-md items-center gap-2 rounded-sm border bg-panel pr-2 pl-1 focus-within:border-accent ${colorError ? inputBad : inputOk}`}>
              <input
                type="color"
                aria-label={t("entities.color")}
                value={colorError ? TYPE_COLORS[0]! : draft.color.toLowerCase()}
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
        <div className="-mt-2 flex items-center gap-2 text-xs text-muted">
          <span>{t("entities.id")}</span>
          <span className="font-mono text-muted">{draft.id ?? (result.ok ? result.type.id : "—")}</span>
          {!draft.id && <span>· {t("entities.idPending")}</span>}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center">
            <span className="text-sm font-medium text-muted">{t("entities.fields")}</span>
            <Button variant="ghost" className="ml-auto h-control-md px-2 text-sm" onClick={addField}>
              <Icon name="plus" size={16} />
              {t("entities.addField")}
            </Button>
          </div>
          {draft.fields.length === 0 ? (
            <div className="py-2 text-sm text-muted">{t("entities.noFields")}</div>
          ) : (
            <div className="flex flex-col rounded-sm border border-line">
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

      </div>
      <div className="flex items-center gap-2 border-t border-line px-4 py-3">
        {saved && (
          <Button variant="ghost" title={count > 0 ? t("entities.inUse", { count }) : undefined} className="text-danger! hover:text-danger!" onClick={remove}>
            <Icon name="trash" size={16} />
            {t("entities.deleteType")}
          </Button>
        )}
        {footerError && <span className="min-w-0 truncate text-xs text-danger" title={footerError}>{footerError.startsWith("entities.") ? t(footerError as MessageKey) : footerError}</span>}
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={() => { onDiscard(); useUiStore.getState().setEntityTypesOpen(false); }}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={!result.ok || !changed || badInputs.size > 0}>
            {t("entities.saveType")}
          </Button>
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
      <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,0.8fr)_minmax(0,1.3fr)_var(--spacing-control-md)] items-start gap-2">
        <label className="flex min-w-0 flex-col gap-1 text-sm text-muted">
          <span>{t("entities.fieldName")}</span>
        <TextField size="md"
          value={field.name}
          {...selectAll}
          aria-label={t("entities.fieldName")}
          onChange={(e) => onChange({ ...field, name: e.target.value })}
          maxLength={64}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={nameBad || undefined}
          className={nameBad ? "[&>input]:border-danger" : ""}
        />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-sm text-muted">
          <span>{t("entities.fieldType")}</span>
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
        </label>
        <div className="flex min-w-0 flex-col gap-1 text-sm text-muted">
          <span>{t("entities.fieldDefault")}</span>
        <FieldValueEditor
          size="md"
          live
          field={{ type: field.type, enumValues: parseEnumValues(field.enumText) }}
          value={field.default}
          levels={levels}
          label={t("entities.fieldDefault")}
          onValidity={reportValidity}
          onCommit={(value) => onChange({ ...field, default: value })}
        />
        </div>
        <IconButton size="md" aria-label={t("entities.removeField")} title={t("entities.removeField")} className="mt-5 hover:text-danger!" onClick={onRemove}>
          <Icon name="x" size={16} />
        </IconButton>
      </div>
      {field.type === "enum" && (
        <label className="flex flex-col gap-1 text-sm text-muted">
          <span className="text-sm text-muted">{t("entities.enumValues")}</span>
          <TextField size="md"
            value={field.enumText}
            aria-label={t("entities.enumValues")}
            onChange={(e) => onChange(withEnumText(field, e.target.value))}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={enumBad || undefined}
            className={enumBad ? "[&>input]:border-danger" : ""}
          />
        </label>
      )}
      {problem && <span className="text-2xs  text-danger">{t(problem)}</span>}
    </div>
  );
}
