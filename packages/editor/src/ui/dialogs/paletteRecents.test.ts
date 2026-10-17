import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "smap.palette.recent";

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

function storage(initial: string | null = null) {
  let value = initial;
  const api = { getItem: vi.fn(() => value), setItem: vi.fn((_key: string, next: string) => { value = next; }) };
  vi.stubGlobal("localStorage", api);
  return api;
}

describe("palette recent commands", () => {
  it("stores five unique commands, newest first, and promotes a repeated command", async () => {
    const api = storage();
    const { readPaletteRecents, rememberPaletteCommand } = await import("./paletteRecents");
    for (const id of ["a", "b", "c", "d", "e", "f", "c"]) rememberPaletteCommand(id);
    expect(readPaletteRecents()).toEqual(["c", "f", "e", "d", "b"]);
    expect(api.setItem).toHaveBeenLastCalledWith(KEY, '["c","f","e","d","b"]');
    vi.resetModules();
    expect((await import("./paletteRecents")).readPaletteRecents()).toEqual(["c", "f", "e", "d", "b"]);
  });

  it("sanitizes stored values and tolerates malformed JSON", async () => {
    const api = storage('["a",null,7,"a","b"]');
    const { readPaletteRecents, rememberPaletteCommand } = await import("./paletteRecents");
    expect(readPaletteRecents()).toEqual(["a", "b"]);
    api.getItem.mockReturnValue("broken JSON");
    rememberPaletteCommand("c");
    expect(readPaletteRecents()).toEqual(["c", "a", "b"]);
  });

  it("keeps history in memory when storage is blocked", async () => {
    const api = storage();
    api.getItem.mockImplementation(() => { throw new Error("blocked"); });
    const { readPaletteRecents, rememberPaletteCommand } = await import("./paletteRecents");
    rememberPaletteCommand("a");
    rememberPaletteCommand("b");
    expect(readPaletteRecents()).toEqual(["b", "a"]);
  });

  it("keeps newer history when reads work but writes fail", async () => {
    const api = storage('["a"]');
    api.setItem.mockImplementation(() => { throw new Error("quota exceeded"); });
    const { readPaletteRecents, rememberPaletteCommand } = await import("./paletteRecents");
    rememberPaletteCommand("b");
    rememberPaletteCommand("c");
    expect(readPaletteRecents()).toEqual(["c", "b", "a"]);
  });
});
