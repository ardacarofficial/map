import { describe, expect, it } from "vitest";
import { FileNotFoundError } from "@smap/editor/src/io/fs";
import { DesktopFsError, joinPath, toFsError, toProjectPath } from "./tauriFileSystem";

describe("joinPath", () => {
  it("uses the root's separator", () => {
    expect(joinPath("C:\\Users\\a\\Dünyam", "levels/main.json")).toBe("C:\\Users\\a\\Dünyam\\levels\\main.json");
    expect(joinPath("/home/a/Dünyam", "levels/main.json")).toBe("/home/a/Dünyam/levels/main.json");
    expect(joinPath("/home/a/p/", "project.smap")).toBe("/home/a/p/project.smap");
    expect(joinPath("/home/a/p", "")).toBe("/home/a/p");
    expect(joinPath("/home/a/p", "./levels//x.json")).toBe("/home/a/p/levels/x.json");
  });
  it("rejects parent segments", () => {
    expect(() => joinPath("/p", "../etc/passwd")).toThrow(DesktopFsError);
  });
});

describe("toProjectPath", () => {
  it("maps absolute watcher paths back to project paths", () => {
    expect(toProjectPath("C:\\a\\Dünyam", "C:\\a\\Dünyam\\tilesets\\grass.png")).toBe("tilesets/grass.png");
    expect(toProjectPath("C:\\a\\Dünyam", "c:\\A\\dünyam\\project.smap")).toBe("project.smap");
    expect(toProjectPath("/a/p", "/a/p/levels/main.json")).toBe("levels/main.json");
    expect(toProjectPath("/a/p", "/a/p2/x")).toBeNull();
    expect(toProjectPath("/a/p", "/a/p")).toBeNull();
  });
});

describe("toFsError", () => {
  it("maps NotFound to the editor's FileNotFoundError", () => {
    const e = toFsError({ kind: "NotFound", path: "/p/x", message: "no" }, "x");
    expect(e).toBeInstanceOf(FileNotFoundError);
    expect((e as FileNotFoundError).path).toBe("x");
    const s = toFsError({ kind: "OutOfScope", path: "/etc", message: "outside" }, "/etc");
    expect(s).toBeInstanceOf(DesktopFsError);
    expect((s as DesktopFsError).kind).toBe("OutOfScope");
  });
});
