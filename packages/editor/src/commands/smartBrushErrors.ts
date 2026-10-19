import { t } from "../i18n";
import { toast } from "../ui/toast/toastStore";
import { getPlatform } from "../platform";
export type SmartBrushErrorCode = "cancelled" | "sourceChanged" | "sourceMissing" | "gridMismatch" | "invalidSource" | "io";
export class SmartBrushError extends Error {
 constructor(readonly code: SmartBrushErrorCode, options?: ErrorOptions) { super(code, options); }
}
export function smartBrushError(error: unknown): SmartBrushError {
 return error instanceof SmartBrushError ? error : new SmartBrushError("io", {cause:error});
}
/** Native details belong in the local log, never in a translated user message. */
export function formatSmartBrushError(error: unknown): string {
 const failure=smartBrushError(error);
 const cause=failure.cause instanceof Error?` (${failure.cause.name}: ${failure.cause.message})`:"";
 getPlatform().log("debug", `smart-brush error ${failure.code}${cause}`);
 return failure.code === "cancelled" ? "" : t(`smartStamp.error_${failure.code}`);
}
export function logSmartBrush(event: string, facts: Record<string, unknown>): void {
 getPlatform().log("debug", `smart-brush ${event} ${JSON.stringify(facts)}`);
}

export function reportSmartBrushError(error:unknown):void {
 const detail=formatSmartBrushError(error);if(detail)toast.error(t("smartStamp.failed",{detail}));
}
