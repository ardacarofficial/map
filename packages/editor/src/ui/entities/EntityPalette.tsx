import { entityCell, isBuiltinEntityTypeId, isEntityLayer, SPAWN_TYPE_ID, type Entity, type EntityType, type MapDocument } from "@smap/core";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { chooseEntityType, entityCounts, entityTypeName, removeEntityType, saveEntityType } from "../../commands/entityActions";
import { runCommand } from "../../commands/registry";
import { t, type MessageKey } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { useStructureVersion } from "../hooks";
import { SectionHeader } from "../primitives/SectionHeader";
import { Button, IconButton } from "../primitives/Button";
import { Icon, type IconName } from "../primitives/Icon";
import { TextField } from "../primitives/TextField";
import { Tooltip } from "../primitives/Tooltip";
import { toast } from "../toast/toastStore";
import { useUiStore } from "../uiStore";
import { getCanvasHandle } from "../canvas/canvasHandle";
import { RowContextMenu } from "../contextMenus/RowContextMenu";
import { SEPARATOR, type ContextEntry } from "../contextMenus/contextItems";
import { TYPE_COLORS, typeFromDraft } from "./fieldValues";

/** Icon of an entity type: built-ins have their own, user types a box. */
export function entityTypeIcon(type: Pick<EntityType, "id" | "icon"> | undefined): IconName {
  if (type?.id === SPAWN_TYPE_ID) return "flag";
  if (type?.id === "portal") return "portal";
  return "box";
}

/** Color dot with the type's icon (the same mark the canvas uses for the type). */
export function TypeMark({ type, size = 16 }: { type: EntityType | undefined; size?: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center text-muted"
      style={{ width: size, height: size }}
    >
      <Icon name={entityTypeIcon(type)} size={16} />
    </span>
  );
}

/**
 * Right column while an entity layer is active: the types to place (click →
 * entity tool with that type) and the entities of the layer (click → select).
 */
export function EntityPalette() {
  const store = useEditorStore((s) => s.project?.store);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  useStructureVersion(store);
  const doc = store?.document;
  if (!doc) return null;
  const layer = activeLayerId ? doc.getLayer(activeLayerId) : undefined;
  const counts = entityCounts(doc);
  const custom = doc.entityTypes;

  return (
    <section aria-label={t("entities.title")} className="flex min-h-0 flex-1 flex-col">
      <SectionHeader title={t("entities.title")} actions={
        <Tooltip label={t("entities.editTypes")}>
          <IconButton size="sm" aria-label={t("entities.editTypes")} onClick={() => runCommand("entity.editTypes")}><Icon name="pencil" size={16} /></IconButton>
        </Tooltip>
      } />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-2">
        <Group label={t("entities.builtin")}>
          {doc.allEntityTypes().slice(0, 2).map((type) => (
            <TypeChip key={type.id} type={type} count={counts.get(type.id) ?? 0} />
          ))}
        </Group>
        <Group label={t("entities.custom")}>
          {custom.map((type) => (
            <TypeChip key={type.id} type={type} count={counts.get(type.id) ?? 0} />
          ))}
          <NewTypeRow doc={doc} />
        </Group>
        {isEntityLayer(layer) && layer.entities.length > 0 && <EntityList doc={doc} entities={layer.entities} />}
      </div>
    </section>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col px-2 pb-2">
      <div className="flex h-control-md items-center px-1 text-xs font-semibold tracking-section text-muted uppercase">{label}</div>
      <div role="radiogroup" aria-label={label} className="flex flex-col">
        {children}
      </div>
    </div>
  );
}

function TypeChip({ type, count }: { type: EntityType; count: number }) {
  const on = useEditorStore((s) => s.tool === "entity" && s.entityTypeId === type.id);
  return (
    <RowContextMenu
      items={() => typeChipItems(type, count)}
      render={
        <button
          type="button"
          role="radio"
          aria-checked={on}
          data-entity-type={type.id}
          onClick={() => chooseEntityType(type.id)}
          className={`flex h-row min-w-0 items-center gap-2 rounded-sm pr-2 pl-1.5 text-sm transition-colors ${
            on ? "bg-accent-soft text-title ring-1 ring-inset ring-accent-line" : "text-text hover:bg-hover"
          }`}
        />
      }
    >
      <TypeMark type={type} />
      <span className="min-w-0 flex-1 truncate text-left">{entityTypeName(type)}</span>
      {count > 0 && <span className="shrink-0 text-xs text-faint tabular">{count}</span>}
    </RowContextMenu>
  );
}

/**
 * "Haritada bul": selects the next entity of `typeId` on the open level
 * (after the selected one, wrapping) and centres the view on it. Selection
 * holds one entity, so repeated use steps through them.
 */
export function selectNextOfType(typeId: string): boolean {
  const state = useEditorStore.getState();
  const doc = state.project?.store.document;
  if (!doc) return false;
  const all = doc.entityLayers().flatMap((layer) => layer.entities.filter((e) => e.typeId === typeId).map((entity) => ({ entity, layer })));
  if (all.length === 0) return false;
  const at = all.findIndex((x) => x.entity.id === state.selectedEntityId);
  const next = all[(at + 1) % all.length]!;
  state.setActiveLayer(next.layer.id);
  state.setSelectedEntity(next.entity.id);
  const cell = entityCell(next.entity, doc.map);
  getCanvasHandle()?.centerOn(cell.x, cell.y);
  return true;
}

/** Right-click on a type chip. Built-in types cannot be edited or deleted. */
function typeChipItems(type: EntityType, count: number): ContextEntry[] {
  const builtin = isBuiltinEntityTypeId(type.id);
  return [
    { type: "item", id: "select", label: t("contextMenu.typeSelect"), icon: "pin", run: () => chooseEntityType(type.id) },
    {
      type: "item",
      id: "edit",
      label: t("contextMenu.typeEdit"),
      icon: "pencilLine",
      disabled: builtin,
      run: () => useUiStore.getState().setEntityTypesOpen(true, false, type.id),
    },
    {
      type: "item",
      id: "find",
      label: count > 0 ? t("contextMenu.typeFind", { count }) : t("contextMenu.typeFindNone"),
      icon: "crosshair",
      disabled: count === 0,
      run: () => void selectNextOfType(type.id),
    },
    SEPARATOR,
    { type: "item", id: "delete", label: t("contextMenu.typeDelete"), icon: "trash", danger: true, disabled: builtin, run: () => void removeEntityType(type.id) },
  ];
}

function EntityList({ doc, entities }: { doc: MapDocument; entities: readonly Entity[] }) {
  const selectedId = useEditorStore((s) => s.selectedEntityId);
  const select = useEditorStore((s) => s.setSelectedEntity);
  return (
    <div className="flex flex-col gap-0.5 border-t border-line-subtle px-1.5 pt-2">
      <div className="px-1.5 pb-0.5 text-xs font-semibold tracking-section text-muted uppercase">
        {t("entities.inLayer")}
        <span className="ml-1.5 font-mono font-normal tabular">{entities.length}</span>
      </div>
      <ul role="listbox" aria-label={t("entities.title")} className="flex flex-col">
        {[...entities].reverse().map((entity) => {
          const type = doc.getEntityType(entity.typeId);
          const cell = entityCell(entity, doc.map);
          const on = entity.id === selectedId;
          return (
            <li
              key={entity.id}
              role="option"
              aria-selected={on}
              data-entity-id={entity.id}
              onClick={() => select(entity.id)}
              className={`relative flex h-row shrink-0 cursor-default items-center gap-2 rounded-sm pr-2 pl-2 text-sm ${
                on ? "bg-accent-soft text-title ring-1 ring-inset ring-accent-line" : "text-text hover:bg-hover"
              }`}
            >
              <TypeMark type={type} size={16} />
              <span className="min-w-0 flex-1 truncate">{type ? entityTypeName(type) : entity.typeId}</span>
              <span className="shrink-0 text-xs text-faint tabular">
                {cell.x}, {cell.y}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * "+ Yeni tür" under the user's types: turns into an inline name field with a
 * color chip (click: next color). Enter creates the type with no fields and
 * picks it for placing; Esc / an empty blur cancels. "Düzenle…" opens the
 * full dialog (fields, color, delete) on the chosen type.
 */
function NewTypeRow({ doc }: { doc: MapDocument }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [colorIndex, setColorIndex] = useState(0);
  const chosen = useEditorStore((s) => (s.tool === "entity" ? s.entityTypeId : null));
  const done = useRef(false);
  const custom = doc.entityTypes;

  const start = () => {
    done.current = false;
    setName("");
    setColorIndex(custom.length % TYPE_COLORS.length);
    setEditing(true);
  };
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    if (!commit || name.trim().length === 0) return;
    const result = typeFromDraft({ id: null, name, color: TYPE_COLORS[colorIndex]!, fields: [] }, custom.map((ty) => ty.id));
    if (!result.ok) {
      toast.error(result.error.startsWith("entities.") ? t(result.error as MessageKey) : result.error);
      return;
    }
    if (!saveEntityType(result.type)) return;
    chooseEntityType(result.type.id);
    const id = result.type.id;
    toast.withAction(t("entities.typeAdded", { name: result.type.name }), {
      label: t("entities.editFields"),
      run: () => useUiStore.getState().setEntityTypesOpen(true, false, id),
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    }
  };

  if (editing) {
    const color = TYPE_COLORS[colorIndex]!;
    return (
      <div className="flex h-row min-w-0 items-center gap-2 rounded-sm bg-field pr-1.5 pl-1.5 ring-1 ring-inset ring-accent-line" data-new-entity-type>
        <Tooltip label={t("entities.nextColor")}>
          <IconButton size="sm"
            aria-label={t("entities.nextColor")}
            // Keep focus in the name field.
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => setColorIndex((i) => (i + 1) % TYPE_COLORS.length)}
            className="text-text"
            style={{ background: color }}
          >
            <Icon name="box" size={16} />
          </IconButton>
        </Tooltip>
        <TextField size="sm"
          autoFocus
          value={name}
          aria-label={t("entities.name")}
          placeholder={t("entities.typeNamePlaceholder")}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
          maxLength={64}
          className="flex-1"
        />
      </div>
    );
  }

  const editTarget = chosen && custom.some((ty) => ty.id === chosen) ? chosen : null;

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost"
          data-new-entity-type-button
          onClick={start}
          className="flex-1 justify-start"
        >
          <span aria-hidden className="grid size-4 shrink-0 place-items-center">
            <Icon name="plus" size={16} />
          </span>
          {/* The label never truncates; the empty-state hint gets its own wrapping line below. */}
          <span className="flex-1 text-left whitespace-nowrap">{t("entities.newType")}</span>
        </Button>
        <Button size="sm" variant="ghost"
          onClick={() => useUiStore.getState().setEntityTypesOpen(true, false, editTarget)}

        >
          {t("entities.editType")}
        </Button>
      </div>

    </div>
  );
}
