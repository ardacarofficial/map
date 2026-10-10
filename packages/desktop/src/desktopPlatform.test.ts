import { beforeEach, describe, expect, it, vi } from "vitest";
import { FolderTakenError, RecentGoneError } from "@smap/editor";

type Handler = (args: Record<string, unknown>) => unknown;
const handlers = new Map<string, Handler>();
const calls: [string, Record<string, unknown>][] = [];
let fileChanged: ((event: { payload: unknown }) => void) | null = null;
let closeRequested: ((event: { payload: unknown }) => void) | null = null;

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
    if (event === "smap://close-requested") closeRequested = cb;
    return Promise.resolve(() => undefined);
  },
}));

const { createDesktopPlatform, listenCloseRequests } = await import("./desktopPlatform");

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

beforeEach(() => {
  handlers.clear();
  calls.length = 0;
  fileChanged = null;
  closeRequested = null;
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

  it("passes recent thumbnails both ways", async () => {
    const platform = createDesktopPlatform();
    handlers.set("dialog_pick_folder", () => "/p/new");
    handlers.set("dir_has_entries", () => false);
    const location = (await platform.pickProjectFolder("Yeni", null))!;
    const png = "data:image/png;base64,AAAA";
    await platform.recents.add(location, "Yeni", png);
    await platform.recents.add(location, "Yeni");
    const adds = calls.filter(([c]) => c === "recent_add").map(([, args]) => args);
    expect(adds).toEqual([
      { path: "/p/new/project.smap", name: "Yeni", thumbnail: png },
      { path: "/p/new/project.smap", name: "Yeni" },
    ]);
    handlers.set("recent_list", () => [
      { path: "/p/new/project.smap", name: "Yeni", openedAt: 2, exists: true, thumbnail: png },
      { path: "/p/old/project.smap", name: "Eski", openedAt: 1, exists: true },
    ]);
    const [withPicture, without] = await platform.recents.list();
    expect(withPicture?.thumbnail).toBe(png);
    expect(without && "thumbnail" in without).toBe(false);
  });

  it("tells Rust whether closing would lose work", () => {
    const platform = createDesktopPlatform();
    platform.setUnsavedChanges(true);
    platform.setUnsavedChanges(false);
    expect(calls.filter(([c]) => c === "close_guard_set")).toEqual([
      ["close_guard_set", { unsaved: true }],
      ["close_guard_set", { unsaved: false }],
    ]);
  });

  it("acknowledges close requests and closes only when the editor agrees", async () => {
    const answers = [false, true];
    let asked = 0;
    let release: () => void = () => undefined;
    const unsubscribe = listenCloseRequests(async () => {
      asked++;
      if (asked === 2) await new Promise<void>((r) => (release = r));
      return answers.shift()!;
    });
    await flush();
    closeRequested?.({ payload: {} });
    await flush();
    expect(calls.filter(([c]) => c === "close_request_ack")).toHaveLength(1);
    expect(calls.some(([c]) => c === "window_close")).toBe(false); // Vazgeç

    closeRequested?.({ payload: {} });
    await flush();
    closeRequested?.({ payload: {} }); // X again while the dialog is open: not asked twice
    await flush();
    expect(asked).toBe(2);
    release();
    await flush();
    expect(calls.filter(([c]) => c === "window_close")).toHaveLength(1);
    unsubscribe();
  });
});
