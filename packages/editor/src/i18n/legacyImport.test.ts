import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { IntlMessageFormat } from "intl-messageformat";
import { importLegacyFiles } from "../../scripts/i18n-migrate.ts";

it("imports a future Godot section from files, preserves reviewed messages and deletes nothing", async () => {
  const folder = mkdtempSync(join(tmpdir(), "i18n-legacy-"));
  try {
    const localesDir = join(folder, "locales");
    const paths = { tr: join(folder, "tr.ts"), en: join(folder, "en.ts") };
    const sources = {
      tr: 'export const tr = { godotExport: { count: "{count} harita", reviewed: "Eski {name}", apostrophe: "Godot’a {name}" } } as const;\n',
      en: 'export const en = { godotExport: { count: "{count} maps", reviewed: "Old {name}", apostrophe: "Godot\'s {name}" } } as const;\n',
    };
    for (const id of ["tr", "en"] as const) {
      mkdirSync(join(localesDir, id), { recursive: true });
      writeFileSync(paths[id], sources[id]);
      writeFileSync(join(localesDir, id, "godotExport.json"), '{"reviewed":"Reviewed {name}"}\n');
      writeFileSync(join(localesDir, id, "unrelated.json"), '{"keep":"Keep me"}\n');
      writeFileSync(join(localesDir, id, "meta.json"), JSON.stringify({ id, nativeName: "Reviewed name", fallback: "tr" }));
    }
    await importLegacyFiles(paths.tr, paths.en, { localesDir });
    for (const id of ["tr", "en"] as const) {
      const resource = readFileSync(join(localesDir, id, "godotExport.json"), "utf8");
      const messages = JSON.parse(resource) as Record<string, string>;
      expect(messages.reviewed).toBe("Reviewed {name}");
      for (const count of [0, 1, 2]) {
        expect(new IntlMessageFormat(messages.count!, id).format({ count }))
          .toBe(`${count} ${id === "tr" ? "harita" : count === 1 ? "map" : "maps"}`);
      }
      expect(new IntlMessageFormat(messages.apostrophe!, id).format({ name: "{name}'" }))
        .toBe(`${id === "tr" ? "Godot’a" : "Godot's"} {name}'`);
      expect(readFileSync(paths[id], "utf8")).toBe(sources[id]);
      expect(readFileSync(join(localesDir, id, "unrelated.json"), "utf8")).toBe('{"keep":"Keep me"}\n');
      expect(JSON.parse(readFileSync(join(localesDir, id, "meta.json"), "utf8")).nativeName).toBe("Reviewed name");
      await importLegacyFiles(paths.tr, paths.en, { localesDir });
      expect(readFileSync(join(localesDir, id, "godotExport.json"), "utf8")).toBe(resource);
    }
    const before = readFileSync(join(localesDir, "en", "godotExport.json"), "utf8");
    writeFileSync(paths.en, 'export const en = { godotExport: { count: "{wrong} maps" } };');
    await expect(importLegacyFiles(paths.tr, paths.en, { localesDir })).rejects.toThrow("key or placeholder mismatch");
    expect(readFileSync(join(localesDir, "en", "godotExport.json"), "utf8")).toBe(before);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
