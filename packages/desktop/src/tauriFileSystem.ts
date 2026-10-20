/**
 * Editörün `ProjectFileSystem` arayüzünün Tauri karşılığı. Yollar proje
 * klasörüne göreli ve `/` ayırıcılı gelir ("levels/main.json"); Rust
 * tarafındaki kapsamlı komutlar (`src-tauri/crates/smap-host`) mutlak yolu
 * doğrular. Yazma her zaman güvenli kayıttır: geçici dosya → fsync →
 * yeniden adlandırma → kilitliyse tekrar dene.
 */
import { invoke } from "@tauri-apps/api/core";
import { FileNotFoundError, type ProjectFileSystem, type GuardedPngRequest } from "@smap/editor";

/** Rust `HostError`'ın webview'e gelen biçimi. */
export interface HostErrorPayload {
  kind: "NotFound" | "OutOfScope" | "InvalidPath" | "Changed" | "Io";
  path: string;
  message: string;
}

/** `NotFound` dışındaki masaüstü dosya hataları. */
export class DesktopFsError extends Error {
  readonly kind: HostErrorPayload["kind"];
  readonly path: string;
  constructor(payload: HostErrorPayload, path: string) {
    super(`${payload.kind}: ${payload.message} (${path})`);
    this.name = "DesktopFsError";
    this.kind = payload.kind;
    this.path = path;
  }
}

function isHostError(value: unknown): value is HostErrorPayload {
  return typeof value === "object" && value !== null && "kind" in value && "message" in value;
}

/** Rust'ın reddettiği değeri editörün beklediği hataya çevirir. */
export function toFsError(error: unknown, path: string): Error {
  if (isHostError(error)) {
    return error.kind === "NotFound" ? new FileNotFoundError(path) : new DesktopFsError(error, path);
  }
  return error instanceof Error ? error : new Error(String(error));
}

/** Kökün kendi ayırıcısıyla birleştirir; `..` ve boş parçaları reddeder. */
export function joinPath(root: string, relative: string): string {
  const parts = relative.split(/[\\/]/).filter((p) => p.length > 0 && p !== ".");
  if (parts.includes("..")) throw new DesktopFsError({ kind: "InvalidPath", path: relative, message: "'..' is not allowed" }, relative);
  if (parts.length === 0) return root;
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  const base = root.endsWith("\\") || root.endsWith("/") ? root.slice(0, -1) : root;
  return base + sep + parts.join(sep);
}

/** Mutlak yolu proje köküne göreli `/` yoluna çevirir; kök dışındaysa `null`. */
export function toProjectPath(root: string, absolute: string): string | null {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const windows = /^[a-zA-Z]:/.test(root) || root.startsWith("\\\\");
  const r = norm(root);
  const a = norm(absolute);
  const same = (x: string, y: string) => (windows ? x.toLowerCase() === y.toLowerCase() : x === y);
  if (a.length <= r.length || a[r.length] !== "/" || !same(a.slice(0, r.length), r)) return null;
  return a.slice(r.length + 1);
}

async function call<T>(cmd: string, path: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (error) {
    throw toFsError(error, path);
  }
}

/** Writes `bytes` to an absolute, already permitted path (save dialog result) with the safe-save command. */
export async function writeFileAbsolute(path: string, bytes: Uint8Array): Promise<void> {
  try {
    await invoke<void>("write_file_atomic", bytes, { headers: { "x-smap-path": encodeURIComponent(path) } });
  } catch (error) {
    throw toFsError(error, path);
  }
}

export class TauriFileSystem implements ProjectFileSystem {
  /** Proje klasörünün mutlak yolu (Rust'ın döndürdüğü kanonik biçim). */
  readonly root: string;
  readonly name: string;

  constructor(root: string, name?: string) {
    this.root = root;
    this.name = name ?? root.split(/[\\/]/).filter(Boolean).pop() ?? root;
  }

  /** Göreli yolun mutlak hâli (izleyici olaylarıyla eşleştirmek için). */
  resolve(path: string): string {
    return joinPath(this.root, path);
  }

  readText(path: string): Promise<string> {
    return call<string>("read_text", path, { path: this.resolve(path) });
  }

  writeText(path: string, text: string): Promise<void> {
    return call<void>("write_text_atomic", path, { path: this.resolve(path), text });
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const buffer = await call<ArrayBuffer>("read_file", path, { path: this.resolve(path) });
    return new Uint8Array(buffer);
  }

  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    // Ham gövde: JSON'a çevirme yok; yol başlıkta (ASCII olmalı → kodlanır).
    try {
      await invoke<void>("write_file_atomic", bytes, {
        headers: { "x-smap-path": encodeURIComponent(this.resolve(path)) },
      });
    } catch (error) {
      throw toFsError(error, path);
    }
  }

  async replacePngGuarded(request: GuardedPngRequest): Promise<void> {
    const body = new Uint8Array(request.expected.length + request.replacement.length);
    body.set(request.expected); body.set(request.replacement, request.expected.length);
    try {
      await invoke<void>("replace_png_guarded", body, { headers: {
        "x-smap-path": encodeURIComponent(this.resolve(request.path)),
        "x-smap-backup": encodeURIComponent(this.resolve(request.backupPath)),
        "x-smap-expected-length": String(request.expected.length),
      } });
    } catch (error) { throw toFsError(error, request.path); }
  }

  list(dir: string): Promise<string[]> {
    return call<string[]>("list_dir", dir, { path: this.resolve(dir) });
  }

  remove(path: string): Promise<void> {
    return call<void>("remove_file", path, { path: this.resolve(path) });
  }

  mkdir(dir: string): Promise<void> {
    return call<void>("create_dir_all", dir, { path: this.resolve(dir) });
  }
}
