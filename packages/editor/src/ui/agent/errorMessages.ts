import type { AgentErrorCode } from "@smap/agent";
import { t, type MessageKey } from "../../i18n";
const messages: Record<AgentErrorCode, MessageKey> = {
  REGION_CONFLICT: "ai.error.regionConflict", OUTSIDE_REGION: "ai.error.outsideRegion", MEMBER_REVISION_CONFLICT: "ai.error.memberRevisionConflict", EXCLUSIVE_OPERATION_REQUIRED: "ai.error.exclusiveOperation",
  NO_WORLD: "ai.error.noWorld", STALE_WORLD: "ai.error.staleWorld", EDITOR_UNAVAILABLE: "ai.error.editorUnavailable", WRITER_BUSY: "ai.error.writerBusy",
  TRANSACTION_REQUIRED: "ai.error.transactionRequired", TRANSACTION_NOT_OWNED: "ai.error.notOwned", TRANSACTION_SEALED: "ai.error.sealed", TRANSACTION_CANCELLED: "ai.error.cancelled",
  REVISION_CONFLICT: "ai.error.revisionConflict", IDEMPOTENCY_CONFLICT: "ai.error.idempotencyConflict", INVALID_ARGUMENT: "ai.error.invalidArgument", UNKNOWN_ID: "ai.error.unknownId", OUT_OF_BOUNDS: "ai.error.outOfBounds",
  LAYER_LOCKED: "ai.error.layerLocked", LAYER_HIDDEN: "ai.error.layerHidden", LAYER_KIND: "ai.error.layerKind", GRID_MISMATCH: "ai.error.gridMismatch", SOURCE_NOT_SMART: "ai.error.sourceNotSmart", SOURCE_CHANGED: "ai.error.sourceChanged",
  STAMP_MAPPING_REQUIRED: "ai.error.stampMapping", CROP_REQUIRES_EXPLICIT_ALLOW: "ai.error.cropRequiresAllow", ENTITY_SCHEMA: "ai.error.entitySchema", TAG_FINGERPRINT_CHANGED: "ai.error.tagFingerprint", DISK_CONFLICT: "ai.error.diskConflict",
  LIMIT_EXCEEDED: "ai.error.limitExceeded", TIMEOUT: "ai.error.timeout", CANCELLED: "ai.error.cancelledCall", INTERNAL_ERROR: "ai.error.internal",
};
export function agentErrorMessage(code: AgentErrorCode): string { return t(messages[code] ?? "ai.error.internal"); }
