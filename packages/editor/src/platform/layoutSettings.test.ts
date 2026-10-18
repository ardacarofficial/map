import { describe, expect, it } from "vitest";
import { defaultDockLayout } from "../ui/layout/dockModel";
import { mergeLayoutSettings, SettingsWriteQueue } from "./layoutSettings";
import { parseSettings } from "./settings";
import { SHORTCUTS } from "../shortcuts/shortcuts";

describe("desktop layout settings", () => {
  it("parses the optional layout without discarding language or keys", () => {
    const layout = defaultDockLayout();
    const result = parseSettings(JSON.stringify({ locale: "en", shortcuts: { "tool.brush": ["P"] }, layout }), SHORTCUTS);
    expect(result.problems).toEqual([]);
    expect(result.settings.layout).toEqual(layout);
    expect(result.settings.locale).toBe("en");
    expect(result.settings.shortcuts.get("tool.brush")).toEqual(["P"]);
  });
  it("ignores invalid layout and reports its path", () => {
    const result = parseSettings('{"locale":"en","layout":{"version":99}}', SHORTCUTS);
    expect(result.settings.layout).toBeUndefined();
    expect(result.problems[0]?.entry).toBe("layout");
  });
  it("merges layout while preserving shortcuts, locale and metadata; never overwrites broken text", () => {
    const result = mergeLayoutSettings('{"locale":"en","shortcuts":{"tool.brush":["P"]},"$schema":"mine"}', defaultDockLayout(), "{}");
    expect(JSON.parse(result!)).toMatchObject({ locale: "en", shortcuts: { "tool.brush": ["P"] }, $schema: "mine", layout: { version: 2 } });
    expect(mergeLayoutSettings("broken", defaultDockLayout(), "{}")).toBeNull();
  });
  it("serializes concurrent read/merge/write updates against the latest file", async () => {
    let text: string | null = '{"locale":"tr","shortcuts":{}}';
    const queue = new SettingsWriteQueue(async () => text, async value => { await Promise.resolve(); text = value; });
    await Promise.all([
      queue.update(raw => mergeLayoutSettings(raw, defaultDockLayout(), "{}")),
      queue.update(raw => JSON.stringify({ ...JSON.parse(raw!), locale: "en" })),
      queue.update(raw => JSON.stringify({ ...JSON.parse(raw!), $test: true })),
    ]);
    expect(JSON.parse(text!)).toMatchObject({ locale: "en", layout: { version: 2 }, $test: true });
    await expect(queue.update(() => { throw Error("write failed"); })).rejects.toThrow();
    await queue.update(raw => raw);
  });
});
