import { FileNotFoundError, type ProjectFileSystem } from "./fs";

export const SNAPSHOT_IMAGE_DIR = "tilesets/snapshots";
/** Reserved immutable namespace, including Windows' case-insensitive spelling. */
export const isSnapshotImagePath = (path: string): boolean => path.toLowerCase().startsWith(`${SNAPSHOT_IMAGE_DIR}/`);

/** Save-time byte identity; never called from the input/preview path. */
export async function contentHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function writeImmutable(fs: ProjectFileSystem, path: string, bytes: Uint8Array): Promise<void> {
  try {
    const existing = await fs.readBytes(path);
    if (existing.length === bytes.length && existing.every((b, i) => b === bytes[i])) return;
    throw new Error(`Immutable file differs: ${path}`);
  } catch (error) {
    if (!(error instanceof FileNotFoundError)) throw error;
  }
  await fs.writeBytes(path, bytes);
}
