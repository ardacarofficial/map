import {
  entityCell,
  PORTAL_TYPE_ID,
  portalStatus,
  portalTarget,
  resolveEntityFields,
  type Entity,
  type MapDocument,
  type PortalStatus,
} from "@smap/core";
import { useState, type KeyboardEvent, type ReactNode } from "react";

import { deleteEntity, entityFieldLabel, entityTypeName, moveEntityToCell, setEntityField } from "../../commands/entityActions";
import { t, type MessageKey } from "../../i18n";
import { useProjectLibrary } from "../../io/projectLibrary";
import { IconButton } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { Tooltip } from "../primitives/Tooltip";
import { TypeMark } from "./EntityPalette";
import { FieldValueEditor } from "./FieldValueEditor";
import { parseIntText } from "./fieldValues";

/**
 * Özellik for the selected entity: type, id, position in cells and a typed
 * form for its fields. Each committed edit is one undo step (core ops).
 */
export function EntityProperties({ doc, entity }: { doc: MapDocument; entity: Entity }) {
  const type = doc.getEntityType(entity.typeId);
  const levels = useProjectLibrary((s) => s.levels);
  const cell = entityCell(entity, doc.map);
  const fields = resolveEntityFields(entity, type);

  return (
    <div className="flex flex-col gap-3 px-3 pb-3" data-entity-properties={entity.id}>
      <div className="flex items-center gap-2.5">
        <TypeMark type={type} size={28} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-md text-text">{type ? entityTypeName(type) : t("entities.unknownType", { id: entity.typeId })}</span>
          <span className="truncate font-mono text-2xs text-faint" title={t("entities.id")}>
            {entity.id}
          </span>
        </div>
        <Tooltip label={t("entities.delete")}>
          <IconButton aria-label={t("entities.delete")} className="size-7 hover:text-danger" onClick={() => deleteEntity(entity.id)}>
            <Icon name="trash" size={14} />
          </IconButton>
        </Tooltip>
      </div>

      <dl className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-sm">
        <dt className="text-faint">{t("entities.position")}</dt>
        <dd className="flex min-w-0 items-center gap-1.5">
          <CellInput axis="x" value={cell.x} max={doc.map.width - 1} onCommit={(x) => moveEntityToCell(entity.id, x, cell.y)} />
          <CellInput axis="y" value={cell.y} max={doc.map.height - 1} onCommit={(y) => moveEntityToCell(entity.id, cell.x, y)} />
          <span className="shrink-0 text-2xs text-faint">{t("entities.cellUnit")}</span>
        </dd>
        {entity.typeId === PORTAL_TYPE_ID && (
          <>
            <dt className="text-faint">{t("entities.portalStatus")}</dt>
            <dd>
              <PortalBadge status={portalStatus({ name: "", levels, tilesets: [] }, entity)} target={portalTarget(entity)} levels={levels} />
            </dd>
          </>
        )}
        {fields.map((field) => {
          const def = type?.fields.find((f) => f.name === field.name);
          if (!def) return null;
          const label = entityFieldLabel(entity.typeId, field.name);
          return (
            <FieldRow key={field.name} label={label} typeLabel={t(`entities.ftype_${field.type}` as MessageKey)}>
              <FieldValueEditor
                field={def}
                value={field.value}
                levels={levels}
                label={label}
                onCommit={(value) => setEntityField(entity.id, field.name, value)}
              />
            </FieldRow>
          );
        })}
      </dl>

      {!type && (
        <div className="flex items-start gap-2 rounded-md bg-warning-soft px-2.5 py-2 text-xs leading-4 text-warning">
          <Icon name="warning" size={13} className="mt-px shrink-0" />
          {t("entities.unknownTypeHint")}
        </div>
      )}
    </div>
  );
}

function FieldRow({ label, typeLabel, children }: { label: string; typeLabel: string; children: ReactNode }) {
  return (
    <>
      <dt className="flex min-w-0 flex-col self-start pt-1.5 leading-4">
        <span className="truncate text-muted" title={label}>
          {label}
        </span>
        <span className="truncate text-2xs text-faint">{typeLabel}</span>
      </dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

const STATUS: Record<PortalStatus, { tone: string; dot: string; key: MessageKey }> = {
  ok: { tone: "text-success", dot: "bg-success", key: "entities.portalOk" },
  missingLevel: { tone: "text-danger", dot: "bg-danger", key: "entities.portalMissing" },
  unset: { tone: "text-faint", dot: "bg-line-strong", key: "entities.portalUnset" },
};

function PortalBadge({ status, target, levels }: { status: PortalStatus; target: string | null; levels: readonly { id: string; name: string }[] }) {
  const s = STATUS[status];
  const name = levels.find((l) => l.id === target)?.name ?? "";
  return (
    <span className={`flex min-w-0 items-center gap-1.5 ${s.tone}`} data-portal-status={status}>
      <span aria-hidden className={`size-2 shrink-0 rounded-full ${s.dot}`} />
      <span className="truncate">{t(s.key, { name })}</span>
    </span>
  );
}

/** One cell coordinate; commits on Enter / blur, Esc reverts, ↑↓ step. */
function CellInput({ axis, value, max, onCommit }: { axis: "x" | "y"; value: number; max: number; onCommit(v: number): void }) {
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setText(String(value));
  }
  const parsed = parseIntText(text);
  const valid = parsed !== null && parsed >= 0 && parsed <= max;
  const commit = (v: number | null = parsed) => {
    if (v === null || v < 0 || v > max) {
      setText(String(value));
      return;
    }
    if (v !== value) onCommit(v);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setText(String(value));
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const next = Math.min(max, Math.max(0, value + (event.key === "ArrowUp" ? 1 : -1)));
      setText(String(next));
      commit(next);
    }
  };
  return (
    <label
      className={`flex min-w-0 flex-1 items-center rounded-md border bg-panel pl-2 transition-colors focus-within:border-accent ${
        valid ? "border-line hover:border-line-strong" : "border-danger"
      }`}
    >
      <span className="font-mono text-2xs text-faint">{axis}</span>
      <input
        value={text}
        aria-label={`${t("entities.position")} ${axis}`}
        inputMode="numeric"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => commit()}
        spellCheck={false}
        autoComplete="off"
        className="h-[26px] w-full min-w-0 bg-transparent px-1.5 font-mono text-md text-text tabular focus-visible:outline-none"
      />
    </label>
  );
}
