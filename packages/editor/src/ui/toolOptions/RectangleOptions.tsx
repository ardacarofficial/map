import { t } from "../../i18n";
import { useRectangleOptions } from "../../state/rectangleOptions";
import { Segmented } from "../primitives/Segmented";
import { TextField } from "../primitives/TextField";
import { OptionLabel } from "./parts";

export function RectangleOptions() {
  const { mode, thickness, setMode, setThickness } = useRectangleOptions();
  return <div className="flex shrink-0 items-center gap-2" data-tool-option="rectangle">
    <Segmented label={t("toolOptions.rectangleMode")} value={mode} onValueChange={setMode} items={[
      { value: "filled", label: t("toolOptions.rectangleFilled") },
      { value: "outline", label: t("toolOptions.rectangleOutline") },
    ]} />
    {mode === "outline" && <label className="flex items-center gap-2" title={t("toolOptions.rectangleThicknessHint")}>
      <OptionLabel>{t("toolOptions.rectangleThickness")}</OptionLabel>
      <TextField size="sm" className="w-12" aria-label={t("toolOptions.rectangleThickness")} type="number" min={1} max={8} value={thickness} onChange={e => setThickness(Number(e.target.value))} />
    </label>}
  </div>;
}
