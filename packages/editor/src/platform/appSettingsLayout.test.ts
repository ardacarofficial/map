import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultDockLayout } from "../ui/layout/dockModel";

afterEach(() => vi.unstubAllGlobals());
async function setup() {
  const entries: Record<string, string> = {};
  vi.stubGlobal("localStorage", { getItem: (key: string) => entries[key] ?? null, setItem: (key: string, value: string) => { entries[key] = value; } });
  vi.stubGlobal("document", { documentElement: { lang: "tr" } });
  vi.resetModules();
  const platform = await import("./index");
  const app = await import("./appSettings");
  const { useDockStore } = await import("../ui/layout/dockStore");
  return { platform, app, dock: useDockStore };
}
describe("layout settings lifecycle", () => {
  it("does not let a delayed startup read overwrite a layout the user already edited", async () => {
    const { platform, app, dock } = await setup();
    const layout = defaultDockLayout(); layout.zones.left.expandedPx = 380;
    let file = JSON.stringify({ locale: "en", shortcuts: {}, layout });
    let resolve: (text: string) => void = () => undefined;
    let first = true;
    platform.setPlatform({ ...platform.getPlatform(), kind: "desktop", readSettings: () => {
      if (!first) return Promise.resolve(file);
      first = false; return new Promise<string>(done => { resolve = done; });
    }, writeSettings: async text => { file = text; } });
    const loading = app.loadAppSettings();
    dock.getState().setSize("left", 310, true); resolve(file);
    await loading;
    expect(dock.getState().layout.zones.left.expandedPx).toBe(310);
    await vi.waitFor(() => expect(JSON.parse(file).layout.zones.left.expandedPx).toBe(310));
    expect(JSON.parse(file).locale).toBe("en");
  });
  it("keeps local/session preferences on write failure and reports the failure only once", async () => {
    const { platform, app, dock } = await setup();
    const log = vi.fn();
    platform.setPlatform({ ...platform.getPlatform(), kind: "desktop", readSettings: async () => '{"locale":"tr","shortcuts":{}}', writeSettings: async () => { throw Error("disk full"); }, log });
    await app.loadAppSettings();
    dock.getState().setSize("bottom", 140, true);
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith("warn", expect.stringContaining("layout:")));
    dock.getState().setSize("bottom", 170, true);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(log.mock.calls.filter(call => String(call[1]).startsWith("layout:"))).toHaveLength(1);
    expect(dock.getState().layout.zones.bottom.expandedPx).toBe(170);
    expect(JSON.parse(localStorage.getItem("smap.layout.v2")!).zones.bottom.expandedPx).toBe(170);
  });
});

it("isolates preview, cancel, focus reload, and serialized shortcut/layout saves", async () => {
  const { platform, app, dock } = await setup();
  let file = '{"locale":"tr","shortcuts":{},"$future":17}';
  platform.setPlatform({ ...platform.getPlatform(), kind: "desktop", readSettings: async () => file, writeSettings: async text => { file = text; } });
  await app.loadAppSettings();
  dock.getState().setSize("left", 300, true);
  const session = await app.beginSettingsPreview();
  const snapshot = dock.getState().layout;
  dock.getState().move("stamps", { zone: "bottom" });
  await app.reloadAppSettingsIfChanged();
  expect(dock.getState().layout.zones.bottom.groups[0]!.tabs).toContain("stamps");
  expect(JSON.parse(file).layout.zones.bottom.groups[0].tabs).not.toContain("stamps");
  session.cancel();
  expect(dock.getState().layout).toEqual(snapshot);
  const next = await app.beginSettingsPreview();
  const layout = { ...dock.getState().layout, rulersVisible: false };
  await next.save(JSON.stringify({ ...JSON.parse(next.text), layout, shortcuts: { "tool.brush": ["Q"] } }));
  dock.getState().setSize("right", 330, true);
  await vi.waitFor(() => expect(JSON.parse(file).layout.zones.right.expandedPx).toBe(330));
  expect(JSON.parse(file).shortcuts).toEqual({ "tool.brush": ["Q"] });
  expect(JSON.parse(file).$future).toBe(17);
});
it("keeps a failed or invalid save draft active and permits cancellation", async () => {
  const { platform, app, dock } = await setup();
  platform.setPlatform({ ...platform.getPlatform(), readSettings: async () => '{"locale":"tr"}', writeSettings: async () => { throw Error("disk full"); } });
  const snapshot = dock.getState().layout;
  const session = await app.beginSettingsPreview();
  dock.getState().move("stamps", { zone: "bottom" });
  await expect(session.save("{")).rejects.toThrow();
  await expect(session.save('{"locale":"en"}')).rejects.toThrow("disk full");
  expect(dock.getState().layout).not.toEqual(snapshot);
  session.cancel();
  expect(dock.getState().layout).toEqual(snapshot);
});
it("ignores an older asynchronous preview cleanup after a new preview starts", async () => {
  const { platform, app, dock } = await setup();
  platform.setPlatform({ ...platform.getPlatform(), readSettings: async () => '{"locale":"tr"}' });
  const old = await app.beginSettingsPreview();
  const current = await app.beginSettingsPreview();
  dock.getState().move("stamps", { zone: "bottom" });
  old.cancel();
  expect(dock.getState().layout.zones.bottom.groups[0]!.tabs).toContain("stamps");
  current.cancel();
  expect(dock.getState().layout.zones.left.groups[0]!.tabs).toContain("stamps");
});
it("merges a layout commit queued during a shortcut save against the newly saved overrides", async () => {
  const { platform, app, dock } = await setup();
  let file = '{"locale":"tr","shortcuts":{}}';
  platform.setPlatform({ ...platform.getPlatform(), kind: "desktop", readSettings: async () => file, writeSettings: async text => { await Promise.resolve(); file = text; } });
  await app.loadAppSettings();
  const saving = app.saveSettingsText('{"locale":"en","shortcuts":{"tool.brush":["Q"]},"$future":1}');
  dock.getState().setSize("left", 350, true);
  await saving;
  await vi.waitFor(() => expect(JSON.parse(file).layout.zones.left.expandedPx).toBe(350));
  expect(JSON.parse(file)).toMatchObject({ locale: "en", shortcuts: { "tool.brush": ["Q"] }, $future: 1 });
});
