/**
 * Backup folder (CLAUDE.md → Dosya düzeni: `backups/`, son 10 kayıt).
 *
 * Every save also writes the level to `backups/<level>-<YYYY-MM-DD_HH-MM-SS>.json`
 * and deletes all but the newest {@link BACKUP_KEEP}. Going back to an older
 * version means opening a backup — there is no other history.
 *
 * Only files whose name matches the pattern exactly are listed or deleted,
 * so anything else the user keeps in the folder is left alone.
 */
import type { ProjectFileSystem } from "./fs";

export const BACKUP_DIR = "backups";
export const BACKUP_KEEP = 10;

export interface BackupEntry {
  /** Path inside the project, e.g. "backups/main-2026-10-07_12-04-05.json". */
  readonly path: string;
  readonly fileName: string;
  /** When the backup was taken (local time, second precision). */
  readonly date: Date;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** "main", 2026-10-07 12:04:05 → "main-2026-10-07_12-04-05.json" (local time). */
export function backupFileName(level: string, date: Date): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  return `${level}-${day}_${time}.json`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The date encoded in a backup file name of `level`, or `null` when the name is not one. */
export function parseBackupFileName(level: string, fileName: string): Date | null {
  const match = new RegExp(`^${escapeRegExp(level)}-(\\d{4})-(\\d{2})-(\\d{2})_(\\d{2})-(\\d{2})-(\\d{2})\\.json$`).exec(
    fileName,
  );
  if (!match) return null;
  const [y, mo, d, h, mi, s] = match.slice(1).map(Number) as [number, number, number, number, number, number];
  const date = new Date(y, mo - 1, d, h, mi, s);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Backups of `level`, newest first. */
export async function listBackups(fs: ProjectFileSystem, level: string): Promise<BackupEntry[]> {
  const entries: BackupEntry[] = [];
  for (const fileName of await fs.list(BACKUP_DIR)) {
    const date = parseBackupFileName(level, fileName);
    if (date) entries.push({ path: `${BACKUP_DIR}/${fileName}`, fileName, date });
  }
  return entries.sort((a, b) => b.date.getTime() - a.date.getTime() || (a.fileName < b.fileName ? 1 : -1));
}

/** Deletes all but the newest `keep` backups of `level`. Returns the deleted paths. */
export async function rotateBackups(fs: ProjectFileSystem, level: string, keep = BACKUP_KEEP): Promise<string[]> {
  const old = (await listBackups(fs, level)).slice(keep);
  for (const entry of old) await fs.remove(entry.path);
  return old.map((e) => e.path);
}

/**
 * Writes a backup of `level` taken at `date`, then rotates. Two backups in
 * the same second share a name; the later one wins. Returns the path written.
 */
export async function writeBackup(
  fs: ProjectFileSystem,
  level: string,
  text: string,
  date: Date,
  keep = BACKUP_KEEP,
): Promise<string> {
  await fs.mkdir(BACKUP_DIR);
  const path = `${BACKUP_DIR}/${backupFileName(level, date)}`;
  await fs.writeText(path, text);
  await rotateBackups(fs, level, keep);
  return path;
}
