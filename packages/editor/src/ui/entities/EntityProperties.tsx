import {
  entityCell,
  PORTAL_TARGET_POINT,
  PORTAL_TYPE_ID,
  portalStatus,
  portalTarget,
  resolveEntityFields,
  type Entity,
  type MapDocument,
  type PortalStatus,
} from "@smap/core";
import { useState, type KeyboardEvent, type ReactNode } from "react";

import { startPointPick } from "../../commands/levelActions";
import { deleteEntity, entityFieldLabel, entityTypeName, moveEntityToCell, setEntityField } from "../../commands/entityActions";
import { t, type MessageKey } from "../../i18n";
import { useProjectLibrary } from "../../io/projectLibrary";
import { Icon } from "../primitives/Icon";
import { Kbd } from "../primitives/Kbd";
import { Tooltip } from "../primitives/Tooltip";
import { TypeMark } from "./EntityPalette";
import { FieldValueEditor } from "./FieldValueEditor";
import { parseIntText } from "./fieldValues";

/**
 * Denetçi card of the selected entity: type, id, position in cells and a typed
 * form for its fields. Each committed edit is one undo step (core ops).
 */
export function EntityProperties({ doc, entity }: { doc: MapDocument; entity: Entity }) {
  const type = doc.getEntityType(entity.typeId);
  const levels = useProjectLibrary((s) => s.levels);
  const cell = entityCell(entity, doc.map);
  const fields = resolveEntityFields(entity, type);

  return (
    <div className="flex flex-col pb-3" data-entity-properties={entity.id}>
      <div className="flex items-center gap-3 px-3 pt-3 pb-1">
        <TypeMark type={type} size={40} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[16px] leading-[22px] font-semibold text-text" data-inspector-title>
            {type ? entityTypeName(type) : t("entities.unknownType", { id: entity.typeId })}
          </span>
          <span className="truncate font-mono text-xs text-faint" title={t("entities.id")}>
            {entity.id}
          </span>
        </div>
      </div>

      <Heading>{t("inspector.transform")}</Heading>
      <div className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-x-2 gap-y-2 px-3 py-1.5 text-md">
        <span className="text-muted">{t("entities.position")}</span>
        <div className="flex min-w-0 items-center gap-1.5">
          <CellInput axis="x" value={cell.x} max={doc.map.width - 1} onCommit={(x) => moveEntityToCell(entity.id, x, cell.y)} />
          <CellInput axis="y" value={cell.y} max={doc.map.height - 1} onCommit={(y) => moveEntityToCell(entity.id, cell.x, y)} />
        </div>
        {entity.typeId === PORTAL_TYPE_ID && (
          <>
            <span className="text-muted">{t("entities.portalStatus")}</span>
            <PortalBadge status={portalStatus({ name: "", levels, tilesets: [] }, entity)} target={portalTarget(entity)} levels={levels} />
          </>
        )}
      </div>

      {fields.length > 0 && <Heading>{t("inspector.fields")}</Heading>}
      <dl className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-3 py-1.5 text-sm">
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
              {entity.typeId === PORTAL_TYPE_ID && field.name === PORTAL_TARGET_POINT && (
                <PickOnMapButton entityId={entity.id} enabled={portalStatus({ name: "", levels, tilesets: [] }, entity) === "ok"} />
              )}
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

      <div className="px-3 pt-2">
        <button
          type="button"
          data-action="entity.delete"
          onClick={() => deleteEntity(entity.id)}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-sm border border-line bg-raised text-md text-danger transition-colors hover:border-danger/60 hover:bg-danger-soft"
        >
          <Icon name="trash" size={14} />
          {t("inspector.deleteEntity")}
          <Kbd keys="Delete" className="ml-1 opacity-70" />
        </button>
      </div>
    </div>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-8 items-center px-3 pt-2">
      <h3 className="truncate text-xs font-semibold tracking-[0.06em] text-muted uppercase">{children}</h3>
    </div>
  );
}

/** "Haritada seç": opens the target level to click the point there (Esc cancels). */
function PickOnMapButton({ entityId, enabled }: { entityId: string; enabled: boolean }) {
  return (
    <Tooltip label={enabled ? t("levels.pickHint") : t("levels.pickNeedsLevel")}>
      <button
        type="button"
        disabled={!enabled}
        onClick={() => void startPointPick(entityId)}
        className="mt-1.5 flex h-7 w-full items-center justify-center gap-1.5 rounded-md border border-line text-sm text-muted transition-colors hover:border-line-strong hover:bg-hover hover:text-text disabled:pointer-events-none disabled:opacity-40"
      >
        <Icon name="crosshair" size={13} />
        {t("levels.pickButton")}
      </button>
    </Tooltip>
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
      className={`flex min-w-0 flex-1 items-center rounded-md border bg-raised pl-2 transition-colors focus-within:border-accent ${
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
