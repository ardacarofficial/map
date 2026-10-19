import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultExportSettings } from "../../export/exportSettings";
import { EXPORT_TARGETS, targetOptions } from "../../export/targetRegistry";
import { t } from "../../i18n";
import { ExportSection } from "./ExportSection";

describe("export settings section", () => {
  it.each(EXPORT_TARGETS)("shows the remembered $id target and its registry defaults", target => {
    const settings = { ...defaultExportSettings("World"), target: target.id };
    const html = renderToStaticMarkup(<ExportSection settings={settings} onChange={() => {}} />);
    expect(html).toContain(`value="${target.id}" selected=""`);
    for (const entry of EXPORT_TARGETS) expect(html).toContain(`value="${entry.id}"`);
    for (const option of target.options) {
      expect(html).toContain(t(option.labelKey));
      if (option.type === "text") expect(html).toContain(`value="${targetOptions(target.id, settings)[option.id]}"`);
    }
    if (target.id !== "unity") expect(html).not.toContain(t("settingsUi.unityTiles"));
  });
  it("shows stored target options rather than replacing them with defaults", () => {
    const settings = { ...defaultExportSettings("World"), target: "godot" as const, targetOptions: { godot: { resourceRoot: "custom/maps", collision: false } } };
    const html = renderToStaticMarkup(<ExportSection settings={settings} onChange={() => {}} />);
    expect(html).toContain('value="custom/maps"');
    expect(html).toContain('aria-checked="false"');
  });
});
