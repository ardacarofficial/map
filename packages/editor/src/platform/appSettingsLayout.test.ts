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
