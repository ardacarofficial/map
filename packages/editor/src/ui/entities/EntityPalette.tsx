import { entityCell, isEntityLayer, SPAWN_TYPE_ID, type Entity, type EntityType, type MapDocument } from "@smap/core";

import type { ReactNode } from "react";

import { chooseEntityType, entityCounts, entityTypeName } from "../../commands/entityActions";
import { runCommand } from "../../commands/registry";
import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { useStructureVersion } from "../hooks";
import { LibraryTabs } from "../panels/LibraryPanel";
import { PanelSection } from "../panels/PanelSection";
import { Button, IconButton } from "../primitives/Button";
import { Icon, type IconName } from "../primitives/Icon";
import { Tooltip } from "../primitives/Tooltip";
import { useUiStore } from "../uiStore";

/** Icon of an entity type: built-ins have their own, user types a box. */
export function entityTypeIcon(type: Pick<EntityType, "id" | "icon"> | undefined): IconName {
  if (type?.id === SPAWN_TYPE_ID) return "flag";
  if (type?.id === "portal") return "portal";
  return "box";
}

/** Color dot with the type's icon (the same mark the canvas uses for the type). */
export function TypeMark({ type, size = 18 }: { type: EntityType | undefined; size?: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-sm text-inverse"
      style={{ width: size, height: size, background: type?.color ?? "var(--color-line-strong)" }}
    >
      <Icon name={entityTypeIcon(type)} size={Math.round(size * 0.66)} strokeWidth={2.25} />
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
    <PanelSection
      title={t("panels.entities")}
      heading={<LibraryTabs />}
      className="min-h-[160px] flex-1"
      actions={
        <Tooltip label={t("commands.entity.editTypes")}>
          <IconButton aria-label={t("commands.entity.editTypes")} className="size-7" onClick={() => runCommand("entity.editTypes")}>
            <Icon name="pencilLine" size={14} />
          </IconButton>
        </Tooltip>
      }
    >
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
          {custom.length === 0 && (
            <div className="flex items-center gap-2 rounded-md border border-dashed border-line-strong py-1.5 pr-1.5 pl-2.5">
              <span className="min-w-0 flex-1 text-xs text-faint">{t("entities.noCustom")}</span>
              <Button className="h-6 shrink-0 px-2 text-sm" onClick={() => useUiStore.getState().setEntityTypesOpen(true, true)}>
                <Icon name="plus" size={13} />
                {t("entities.newType")}
              </Button>
            </div>
          )}
        </Group>
        {isEntityLayer(layer) && layer.entities.length > 0 && <EntityList doc={doc} entities={layer.entities} />}
      </div>
      <div className="flex h-7 shrink-0 items-center border-t border-line-subtle px-3 text-2xs text-faint">
        <span className="truncate">{t("entities.paletteHint")}</span>
      </div>
    </PanelSection>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-2 pb-2">
      <div className="px-1 text-2xs font-semibold tracking-wide text-faint">{label}</div>
      <div role="radiogroup" aria-label={label} className="flex flex-col gap-1">
        {children}
      </div>
    </div>
  );
}

function TypeChip({ type, count }: { type: EntityType; count: number }) {
  const on = useEditorStore((s) => s.tool === "entity" && s.entityTypeId === type.id);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      data-entity-type={type.id}
      onClick={() => chooseEntityType(type.id)}
      className={`flex h-8 min-w-0 items-center gap-2 rounded-md border pr-2 pl-1.5 text-sm transition-colors ${
        on ? "border-accent bg-accent-soft text-text" : "border-line text-muted hover:border-line-strong hover:text-text"
      }`}
    >
      <TypeMark type={type} />
      <span className="min-w-0 flex-1 truncate text-left">{entityTypeName(type)}</span>
      {count > 0 && <span className="shrink-0 font-mono text-2xs text-faint tabular">{count}</span>}
    </button>
  );
}

function EntityList({ doc, entities }: { doc: MapDocument; entities: readonly Entity[] }) {
  const selectedId = useEditorStore((s) => s.selectedEntityId);
  const select = useEditorStore((s) => s.setSelectedEntity);
  return (
    <div className="flex flex-col gap-0.5 border-t border-line-subtle px-1.5 pt-2">
      <div className="px-1.5 pb-0.5 text-2xs font-semibold tracking-wide text-faint">
        {t("entities.inLayer")}
        <span className="ml-1.5 font-mono font-normal tabular">{entities.length}</span>
      </div>
      <ul role="listbox" aria-label={t("panels.entities")} className="flex flex-col">
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
              className={`relative flex h-7 shrink-0 cursor-default items-center gap-2 rounded-md pr-2 pl-2 text-sm ${
                on ? "bg-active text-text" : "text-muted hover:bg-hover hover:text-text"
              }`}
            >
              {on && <span aria-hidden className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-accent" />}
              <TypeMark type={type} size={14} />
              <span className="min-w-0 flex-1 truncate">{type ? entityTypeName(type) : entity.typeId}</span>
              <span className="shrink-0 font-mono text-2xs text-faint tabular">
                {cell.x}, {cell.y}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
