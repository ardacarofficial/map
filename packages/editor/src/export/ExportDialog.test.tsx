import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExportTargetList } from "./ExportTargetList";
import { openExportDialog, useExportStore } from "./exportStore";
import { registerExportCommands } from "../commands/exportCommands";
import { getCommand } from "../commands/registry";
import { EXPORT_TARGETS } from "./targetRegistry";

describe("export dialog targets", () => {
  it("shows descriptive rows and selects exactly one target", () => {
    const html = renderToStaticMarkup(<ExportTargetList value="godot" onChange={() => {}} />);
    expect(html.match(/type="radio"/g)).toHaveLength(7);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Godot 4"');
    expect(html).toContain("TileMapLayer");
  });
  it("the generic opener clears target overrides while target commands select their own target", () => {
    registerExportCommands();
    for (const target of EXPORT_TARGETS) {
      getCommand(`file.export.${target.id}`)?.run();
      expect(useExportStore.getState().initialTarget).toBe(target.id);
    }
    openExportDialog();
    expect(useExportStore.getState().initialTarget).toBeNull();
    expect(useExportStore.getState().open).toBe(true);
    useExportStore.getState().setOpen(false);
  });
});
