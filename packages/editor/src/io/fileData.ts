/** PNGs can be listed in previews before encoding; writers resolve them before touching disk. */
export type PngBytes = Uint8Array | (() => Promise<Uint8Array>);
export type FileData = string | PngBytes;
export async function resolveFileData(data: FileData): Promise<string | Uint8Array> { return typeof data === "function" ? data() : data; }
