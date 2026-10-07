import { describe, expect, it } from "vitest";
import { backupFileName, listBackups, parseBackupFileName, rotateBackups, writeBackup } from "./backups";
import { MemoryFileSystem } from "./memoryFs";

const at = (minute: number, second = 0) => new Date(2026, 9, 7, 12, minute, second);

describe("backups", () => {
  it("names files with a sortable local timestamp and parses them back", () => {
    const name = backupFileName("main", new Date(2026, 0, 2, 3, 4, 5));
    expect(name).toBe("main-2026-01-02_03-04-05.json");
    expect(parseBackupFileName("main", name)?.getTime()).toBe(new Date(2026, 0, 2, 3, 4, 5).getTime());
    expect(parseBackupFileName("other", name)).toBeNull();
    expect(parseBackupFileName("main", "main-notes.json")).toBeNull();
  });

  it("keeps only the 10 newest backups", async () => {
    const fs = new MemoryFileSystem();
    for (let i = 0; i < 14; i++) await writeBackup(fs, "main", `v${i}`, at(i));
    const list = await listBackups(fs, "main");
    expect(list).toHaveLength(10);
    expect(list[0]?.date.getTime()).toBe(at(13).getTime()); // newest first
    expect(list.at(-1)?.date.getTime()).toBe(at(4).getTime());
    expect(await fs.readText(list[0]!.path)).toBe("v13");
    expect(fs.files.has(`backups/${backupFileName("main", at(3))}`)).toBe(false);
  });

  it("orders by time, not by write order, and leaves unrelated files alone", async () => {
    const fs = new MemoryFileSystem();
    await fs.writeText("backups/readme.txt", "mine");
    await fs.writeText("backups/main-copy.json", "mine");
    await fs.writeText(`backups/${backupFileName("cave", at(0))}`, "other level");
    for (const minute of [5, 1, 9, 3]) await fs.writeText(`backups/${backupFileName("main", at(minute))}`, `m${minute}`);
    expect((await listBackups(fs, "main")).map((b) => b.date.getMinutes())).toEqual([9, 5, 3, 1]);
    const removed = await rotateBackups(fs, "main", 2);
    expect(removed).toEqual([`backups/${backupFileName("main", at(3))}`, `backups/${backupFileName("main", at(1))}`]);
    expect(fs.files.has("backups/readme.txt")).toBe(true);
    expect(fs.files.has("backups/main-copy.json")).toBe(true);
    expect((await listBackups(fs, "cave")).length).toBe(1);
  });
});
