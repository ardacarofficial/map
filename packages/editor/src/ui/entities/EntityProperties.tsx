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
import { type ReactNode } from "react";

import { startPointPick } from "../../commands/levelActions";
import { deleteEntity, entityFieldLabel, entityTypeName, moveEntityToCell, setEntityField } from "../../commands/entityActions";
import { t, type MessageKey } from "../../i18n";
import { useProjectLibrary } from "../../io/projectLibrary";
import { Icon } from "../primitives/Icon";
import { KbdText } from "../primitives/Kbd";
import { Tooltip } from "../primitives/Tooltip";
import { TypeMark } from "./EntityPalette";
import { FieldValueEditor } from "./FieldValueEditor";
import { Button } from "../primitives/Button";
import { CardTitle, CardDivider, IntField, PropGrid, PropRow, SectionHeader } from "../inspector/parts";

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
      <CardTitle leading={<TypeMark type={type} size={16} />} title={type ? entityTypeName(type) : t("entities.unknownType", { id: entity.typeId })} subtitle={<span className="font-mono" title={t("entities.id")}>{entity.id}</span>} />
      <SectionHeader>{t("inspector.transform")}</SectionHeader>
      <PropGrid>
        <PropRow label={t("entities.position")}>
          <IntField label={`${t("entities.position")} x`} prefix="X" value={cell.x} min={0} max={doc.map.width - 1} onCommit={(x) => moveEntityToCell(entity.id, x, cell.y)} />
          <IntField label={`${t("entities.position")} y`} prefix="Y" value={cell.y} min={0} max={doc.map.height - 1} onCommit={(y) => moveEntityToCell(entity.id, cell.x, y)} />
        </PropRow>
        {entity.typeId === PORTAL_TYPE_ID && <PropRow label={t("entities.portalStatus")}><PortalBadge status={portalStatus({ name: "", levels, tilesets: [] }, entity)} target={portalTarget(entity)} levels={levels} /></PropRow>}
      </PropGrid>
      {fields.length > 0 && <><CardDivider /><SectionHeader>{t("inspector.fields")}</SectionHeader></>}
      <dl className="flex flex-col px-3 text-sm">
        {fields.map((field) => {
          const def = type?.fields.find((f) => f.name === field.name);
          if (!def) return null;
          const label = entityFieldLabel(entity.typeId, field.name);
          return (
            <FieldRow key={field.name} name={field.name} label={label} typeLabel={t(`entities.ftype_${field.type}` as MessageKey)}>
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
        <div className="flex items-center gap-2 px-3 text-sm text-warning">
          <Icon name="triangle-alert" size={16} className="shrink-0" />
          {t("entities.unknownTypeHint")}
        </div>
      )}

      <div className="px-3 pt-2">
        <Button size="sm" variant="ghost"
          data-action="entity.delete"
          onClick={() => deleteEntity(entity.id)}
          className="-ml-2 text-danger! hover:text-danger!"
        >
          <Icon name="trash-2" size={16} />
          {t("inspector.deleteEntity")}
          <KbdText keys="Delete" className="ml-1" />
        </Button>
      </div>
    </div>
  );
}

/** "Haritada seç": opens the target level to click the point there (Esc cancels). */
function PickOnMapButton({ entityId, enabled }: { entityId: string; enabled: boolean }) {
  return (
    <Tooltip label={enabled ? t("levels.pickHint") : t("levels.pickNeedsLevel")}>
      <Button size="sm"
        aria-disabled={!enabled || undefined}
        onClick={() => { if (enabled) void startPointPick(entityId); }}
        className={`mt-1 ${enabled ? "" : "opacity-40"}`}
      >
        <Icon name="crosshair" size={16} />
        {t("levels.pickButton")}
      </Button>
    </Tooltip>
  );
}

function FieldRow({ name, label, typeLabel, children }: { name: string; label: string; typeLabel: string; children: ReactNode }) {
  return (
    <div className="flex min-h-control-md items-start gap-2" data-field={name}>
      <dt className="flex h-control-md w-proplabel shrink-0 items-center"><span className="truncate text-muted" title={`${label} · ${typeLabel}`}>{label}</span></dt>
      <dd className="min-w-0 flex-1 py-0.5">{children}</dd>
    </div>
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
      <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${s.dot}`} />
      <span className="truncate">{t(s.key, { name })}</span>
    </span>
  );
}
