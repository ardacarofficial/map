/**
 * Before overwriting dependents, publish the previous project pointing at a
 * complete backup. The final project.smap replacement commits the new set.
 * Both roots are ordinary project files; there is no persisted undo/journal.
 */
import { parseProject, PROJECT_FILE_NAME } from "@smap/core";
import { FileNotFoundError, type ProjectFileSystem } from "./fs";
import { contentHash, SNAPSHOT_IMAGE_DIR, writeImmutable } from "./immutableFiles";
import { generatedRecipePath } from "./smartStampRecipes";

const DIR = "backups/save";
const snapshotPattern = /^backups\/save\/([a-f0-9]{64})-/;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const snapshotPath = (hash: string, path: string) => `${DIR}/${hash}-${encodeURIComponent(path)}`;

async function readOptional(fs: ProjectFileSystem, path: string): Promise<Uint8Array | undefined> {
  try { return await fs.readBytes(path); }
  catch (error) { if (error instanceof FileNotFoundError) return undefined; throw error; }
}

/** Called before save and open. Recovery is itself restartable at every write. */
export async function recoverSavedProject(fs: ProjectFileSystem): Promise<void> {
  const root = await readOptional(fs, PROJECT_FILE_NAME);
  if (!root) return;
  const project = parseProject(decoder.decode(root));
  const hash = project.levels[0]?.path.match(snapshotPattern)?.[1];
  if (!hash) return;
  const original = await fs.readText(snapshotPath(hash, PROJECT_FILE_NAME));
  const previous = parseProject(original);
  const allowed = new Set([
    ...previous.levels.map(l => l.path),
    ...previous.tilesets.filter(t => t.generated).flatMap(t => [t.imagePath, generatedRecipePath(t.id)]),
  ]);
  const prefix = `${hash}-`, stamps = new Set<string>();
  for (const name of await fs.list(DIR)) {
    if (!name.startsWith(prefix)) continue;
    const path = decodeURIComponent(name.slice(prefix.length));
    const stamp = /^stamps\/[^/]+\.json$/.test(path);
    if (!allowed.has(path) && !stamp) continue;
    if (stamp) stamps.add(path);
    await fs.writeBytes(path, await fs.readBytes(`${DIR}/${name}`));
  }
  // Stamps created during an interrupted save must not join the old library.
  for (const name of await fs.list("stamps")) {
    if (name.endsWith(".json") && !stamps.has(`stamps/${name}`)) await fs.remove(`stamps/${name}`);
  }
  // Keep the backup root published until every original dependent is restored.
  await fs.writeText(PROJECT_FILE_NAME, original);
  await discardSaveBackups(fs);
}

/** Protects ALL saved maps, including unloaded ones and mutable generated art. */
export async function protectSavedProject(fs: ProjectFileSystem): Promise<void> {
  await recoverSavedProject(fs);
  const root = await readOptional(fs, PROJECT_FILE_NAME);
  if (!root) return;
  const project = parseProject(decoder.decode(root));
  const files = new Map<string, Uint8Array>([[PROJECT_FILE_NAME, root]]);
  for (const level of project.levels) files.set(level.path, await fs.readBytes(level.path));
  for (const tileset of project.tilesets) if (tileset.generated) {
    for (const path of [tileset.imagePath, generatedRecipePath(tileset.id)]) {
      const bytes = await readOptional(fs, path);
      if (bytes) files.set(path, bytes);
    }
  }
  for (const name of await fs.list("stamps")) if (name.endsWith(".json")) {
    const path = `stamps/${name}`;
    files.set(path, await fs.readBytes(path));
  }
  // Hash paths as well as bytes, with deterministic order and unambiguous framing.
  const identities = await Promise.all([...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(async ([path, bytes]) => [path, await contentHash(bytes)]));
  const hash = await contentHash(encoder.encode(JSON.stringify(identities)));
  await fs.mkdir(DIR);
  for (const [path, bytes] of files) await writeImmutable(fs, snapshotPath(hash, path), bytes);
  const rasterPaths = new Map<string, string>();
  for (const tileset of project.tilesets) if (tileset.generated) {
    const bytes = files.get(tileset.imagePath);
    if (!bytes) continue;
    const path = `${SNAPSHOT_IMAGE_DIR}/${await contentHash(bytes)}.png`;
    await fs.mkdir(SNAPSHOT_IMAGE_DIR);
    await writeImmutable(fs, path, bytes);
    rasterPaths.set(tileset.imagePath, path);
  }

  // Preserve the previous format version and all optional metadata verbatim.
  const backupRoot = JSON.parse(decoder.decode(root)) as { levels: unknown; tilesets: { id: string; imagePath: string }[] };
  backupRoot.levels = project.levels.map(l => ({ ...l, path: snapshotPath(hash, l.path) }));
  backupRoot.tilesets = backupRoot.tilesets.map(t => rasterPaths.has(t.imagePath) ? { ...t, imagePath: rasterPaths.get(t.imagePath)! } : t);
  await fs.writeText(PROJECT_FILE_NAME, `${JSON.stringify(backupRoot, null, 2)}\n`);
}

/** Only after a coherent root is published. Timestamped backups/assets are separate. */
export async function discardSaveBackups(fs: ProjectFileSystem): Promise<void> {
  try {
    for (const name of await fs.list(DIR)) if (/^[a-f0-9]{64}-/.test(name)) await fs.remove(`${DIR}/${name}`);
  } catch (error) {
    // Cleanup is optional; a complete save must not be reported as failed.
    console.warn("Save backup cleanup failed", error);
  }
}
