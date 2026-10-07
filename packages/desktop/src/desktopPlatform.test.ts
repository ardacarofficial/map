import { beforeEach, describe, expect, it, vi } from "vitest";
import { FolderTakenError, RecentGoneError } from "@smap/editor";

type Handler = (args: Record<string, unknown>) => unknown;
const handlers = new Map<string, Handler>();
const calls: [string, Record<string, unknown>][] = [];
let fileChanged: ((event: { payload: unknown }) => void) | null = null;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    calls.push([cmd, args]);
    const handler = handlers.get(cmd);
    if (!handler) return Promise.resolve(null);
    try {
      return Promise.resolve(handler(args));
    } catch (error) {
      return Promise.reject(error);
    }
  },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, cb: (event: { payload: unknown }) => void) => {
    if (event === "smap://file-changed") fileChanged = cb;
    return Promise.resolve(() => undefined);
  },
}));

const { createDesktopPlatform } = await import("./desktopPlatform");

beforeEach(() => {
  handlers.clear();
  calls.length = 0;
  fileChanged = null;
  handlers.set("settings_path", () => "/cfg/settings.json");
});

describe("desktop platform", () => {
  it("saves a new project into an empty picked folder, else into a sub-folder", async () => {
    const platform = createDesktopPlatform();
    handlers.set("dialog_pick_folder", () => "/home/a/maps");
    handlers.set("dir_has_entries", () => false);
    expect((await platform.pickProjectFolder("Dünyam", null))?.label).toBe("/home/a/maps");

    handlers.set("dir_has_entries", () => true);
    handlers.set("exists", () => false);
    const sub = await platform.pickProjectFolder("Dünya: 2", null);
    expect(sub?.label).toBe("/home/a/maps/Dünya- 2");
    expect(calls.some(([cmd, args]) => cmd === "create_dir_all" && args.path === "/home/a/maps/Dünya- 2")).toBe(true);

    handlers.set("exists", () => true);
    await expect(platform.pickProjectFolder("Dünyam", null)).rejects.toBeInstanceOf(FolderTakenError);

    handlers.set("dialog_pick_folder", () => null);
    expect(await platform.pickProjectFolder("x", null)).toBeNull();
  });

  it("maps watcher paths to project paths of the open project only", async () => {
    const platform = createDesktopPlatform();
    handlers.set("project_open", () => ({ file: "C:\\m\\Dünyam\\project.smap", root: "C:\\m\\Dünyam", name: "Dünyam" }));
    const seen: unknown[] = [];
    platform.onFileChanged((c) => seen.push(c));
    await Promise.resolve();
    fileChanged?.({ payload: { path: "C:\\m\\Dünyam\\tilesets\\grass.png", kind: "modified" } });
    expect(seen).toEqual([]); // nothing open yet
    await platform.openPath("C:\\m\\Dünyam\\project.smap");
    fileChanged?.({ payload: { path: "C:\\m\\Dünyam\\tilesets\\grass.png", kind: "modified" } });
    fileChanged?.({ payload: { path: "C:\\other\\x.png", kind: "modified" } });
    expect(seen).toEqual([{ path: "tilesets/grass.png", kind: "modified" }]);
  });

  it("watches a newly saved folder once and stops on close", async () => {
    const platform = createDesktopPlatform();
    handlers.set("project_open", () => ({ file: "/p/a/project.smap", root: "/p/a", name: "a" }));
    const opened = await platform.openPath("/p/a/project.smap");
    calls.length = 0;
    platform.watchProject(opened);
    expect(calls.filter(([c]) => c === "project_set_root")).toEqual([]);
    handlers.set("dialog_pick_folder", () => "/p/b");
    handlers.set("dir_has_entries", () => false);
    const fresh = await platform.pickProjectFolder("b", opened);
    platform.watchProject(fresh);
    expect(calls.filter(([c]) => c === "project_set_root")).toEqual([["project_set_root", { dir: "/p/b" }]]);
    platform.watchProject(null);
    expect(calls.some(([c]) => c === "project_close")).toBe(true);
  });

  it("reports vanished recents", async () => {
    const platform = createDesktopPlatform();
    handlers.set("recent_list", () => [
      { path: "/p/a/project.smap", name: "A", openedAt: 2, exists: true },
      { path: "/p/gone/project.smap", name: "G", openedAt: 1, exists: false },
    ]);
    const [a, gone] = await platform.recents.list();
    expect(a).toMatchObject({ key: "/p/a/project.smap", location: "/p/a", exists: true });
    await expect(platform.recents.open(gone!)).rejects.toBeInstanceOf(RecentGoneError);
    handlers.set("project_open", () => {
      throw { kind: "NotFound", path: "/p/a/project.smap", message: "gone" };
    });
    await expect(platform.recents.open(a!)).rejects.toBeInstanceOf(RecentGoneError);
  });
});
