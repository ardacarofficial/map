import type { Stamp } from "@smap/core";
import { t } from "../../i18n";
import { PropRow } from "../primitives/PropRow";
/** Inspector facts only; the options bar owns the single smart switch. */
export function SmartStampProperties({stamp}:{stamp:Stamp}) {
  return stamp.nineSlice ? <PropRow label={t("smartBrush.source")}><span className="text-sm text-muted">{t("smartBrush.bands",{border:stamp.nineSlice.border})}</span></PropRow> : null;
}
