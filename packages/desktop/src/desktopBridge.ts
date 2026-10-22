/**
 * Tauri komutlarının ince TS sarmalayıcıları. Editör bunu tanımaz:
 * `desktopPlatform.ts` bunlardan editörün `Platform` arayüzünü kurar.
 *
 * Dosya erişimi uygulamanın kendi kapsamlı Rust komutlarıyladır: webview
 * yalnız açık projenin klasörüne ve kullanıcının diyalogla / çift tıklamayla
 * / son projelerden seçtiği yollara dokunabilir.
 */
import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { TauriFileSystem, toFsError } from "./tauriFileSystem";

export { isTauri } from "./isTauri";
export { DesktopFsError, TauriFileSystem, joinPath, toProjectPath, type HostErrorPayload } from "./tauriFileSystem";

export const EVENT_FILE_CHANGED = "smap://file-changed";
export const EVENT_OPEN_FILE = "smap://open-file";
export const EVENT_CLOSE_REQUESTED = "smap://close-requested";

export function openWorldWindow(request: { kind: "new" | "picker" | "path" | "recent"; path?: string }): Promise<boolean> {
  return command("world_window_open", request);
}

export type FileChangeKind = "created" | "modified" | "removed";

/** Dışarıda (Aseprite, git, başka editör) değişen dosya. `path` mutlak. */
export interface FileChange {
  path: string;
  kind: FileChangeKind;
}

export interface OpenedProject {
  /** `project.smap`'in mutlak yolu. */
  file: string;
  /** Proje klasörü. */
  root: string;
  /** Klasör adı. */
  name: string;
}

export interface RecentProjectEntry {
  path: string;
  name: string;
  /** Unix ms. */
  openedAt: number;
  /** Liste okunurken diskte hâlâ var mı. */
  exists: boolean;
  /** Son kayıttaki haritanın küçük resmi (PNG data URL). */
  thumbnail?: string;
}

export interface DialogFilter {
  name: string;
  extensions: string[];
}

async function command<T>(cmd: string, args: Record<string, unknown> = {}, path = ""): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (error) {
    throw toFsError(error, path);
  }
}

// ---- diyaloglar ------------------------------------------------------------

/** `.smap` seçtirir; seçilen yol kapsama eklenmiş olarak döner, iptal → `null`. */
export function openProjectDialog(options: { title?: string; filterName?: string } = {}): Promise<string | null> {
  return command("dialog_open_project", { title: options.title, filterName: options.filterName });
}

/** Klasör seçtirir (yeni proje, dışa aktarma hedefi). Altındaki her şey izinli olur. */
export function pickFolderDialog(options: { title?: string } = {}): Promise<string | null> {
  return command("dialog_pick_folder", { title: options.title });
}

/** Dosya(lar) seçtirir (ör. PNG tileset). Seçilenler izinli olur. */
export function pickFilesDialog(options: { title?: string; filter?: DialogFilter } = {}): Promise<string[]> {
  return command("dialog_pick_files", {
    title: options.title,
    filterName: options.filter?.name,
    extensions: options.filter?.extensions ?? [],
  });
}

/** Kaydetme yeri seçtirir (zip/PNG/TMJ dışa aktarma). */
export function saveFileDialog(options: { title?: string; defaultName?: string; filter?: DialogFilter } = {}): Promise<string | null> {
  return command("dialog_save_file", {
    title: options.title,
    defaultName: options.defaultName,
    filterName: options.filter?.name,
    extensions: options.filter?.extensions ?? [],
  });
}

// ---- proje -----------------------------------------------------------------

/**
 * `project.smap`'i açar: klasörü kök yapar, izleyiciyi başlatır, son
 * projelere ekler. Yol diyalogdan, çift tıklamadan ya da son projelerden
 * gelmiş olmalı (yoksa `OutOfScope`). `name` son projelerde görünen ad.
 */
export async function openProject(path: string, name?: string): Promise<{ project: OpenedProject; fs: TauriFileSystem }> {
  const project = await command<OpenedProject>("project_open", { path, name }, path);
  return { project, fs: new TauriFileSystem(project.root, project.name) };
}

/** Yeni proje: `pickFolderDialog` ile seçilmiş klasörü kök yapar. */
export async function useFolderAsProject(dir: string): Promise<TauriFileSystem> {
  const root = await command<string>("project_set_root", { dir }, dir);
  return new TauriFileSystem(root);
}

/** İzleyiciyi durdurur. */
export function closeProject(): Promise<void> {
  return command("project_close");
}

// ---- olaylar ---------------------------------------------------------------

/**
 * Açılması istenen `.smap` yolları: hem açılıştaki argv (çift tıklama) hem
 * de program açıkken ikinci çift tıklama (tek örnek eklentisi pencereyi öne
 * getirir). Rust yolu saklar, olay yalnız "sor" dürtüsüdür; böylece dinleyici
 * geç kurulsa da istek kaybolmaz ve iki kez işlenmez.
 */
export async function onOpenFile(cb: (path: string) => void): Promise<UnlistenFn> {
  const drain = async () => {
    const path = await invoke<string | null>("take_open_request");
    if (path) cb(path);
  };
  const unlisten = await getCurrentWebviewWindow().listen(EVENT_OPEN_FILE, () => void drain());
  await drain();
  return unlisten;
}

/** Dışarıdan gelen gerçek değişiklikler (kendi kayıtlarımız ve tekrarlanan olaylar elenmiş). */
export function onFileChanged(cb: (change: FileChange) => void): Promise<UnlistenFn> {
  return getCurrentWebviewWindow().listen<FileChange>(EVENT_FILE_CHANGED, (event) => cb(event.payload));
}

// ---- son projeler -----------------------------------------------------------

export function recentList(): Promise<RecentProjectEntry[]> {
  return command("recent_list");
}

export function recentAdd(path: string, name: string, thumbnail?: string): Promise<void> {
  return command("recent_add", thumbnail ? { path, name, thumbnail } : { path, name }, path);
}

export function recentRemove(path: string): Promise<void> {
  return command("recent_remove", { path }, path);
}

// ---- log, açılış ------------------------------------------------------------

export type LogLevel = "error" | "warn" | "info" | "debug";

/** Uygulama log dosyasına yazar (`%APPDATA%/…/logs/harita.log`, 5 × 1 MB). */
export function log(level: LogLevel, message: string): void {
  void invoke("log_write", { level, message }).catch(() => undefined);
}

// ---- ayarlar, pencere --------------------------------------------------------

/** `settings.json`'un metni (uygulama ayar klasöründe); yoksa `null`. */
export function settingsRead(): Promise<string | null> {
  return command("settings_read");
}

/** `settings.json`'u güvenli kayıtla yazar. */
export function settingsWrite(text: string): Promise<void> {
  return command("settings_write", { text });
}

/** `settings.json`'un mutlak yolu (ayar diyaloğunda gösterilir). */
export function settingsPath(): Promise<string> {
  return command("settings_path");
}

export function setWindowTitle(title: string): Promise<void> {
  return command("window_set_title", { title });
}

// ---- pencere kapatma ----------------------------------------------------------

/** Kaydedilmemiş iş var mı: yoksa Rust pencereyi sormadan kapatır. */
export function setCloseGuard(unsaved: boolean): Promise<void> {
  return invoke("close_guard_set", { unsaved });
}

/**
 * Kaydedilmemiş iş varken X / Alt+F4 / görev çubuğu. Alındığı hemen Rust'a
 * bildirilir (bildirilmezse sayfa donmuş sayılır, ikinci istek kapatır).
 */
export function onCloseRequested(cb: () => void): Promise<UnlistenFn> {
  return getCurrentWebviewWindow().listen(EVENT_CLOSE_REQUESTED, () => {
    void invoke("close_request_ack").catch(() => undefined);
    cb();
  });
}

/** Pencereyi kapatır (soru sorulmadan; karar verilmiş olmalı). */
export function closeWindow(): Promise<void> {
  return invoke("window_close");
}

/** Kapsamdaki bir yol var mı. */
export function pathExists(path: string): Promise<boolean> {
  return command("exists", { path }, path);
}

/** Klasörde gizli olmayan bir girdi var mı (yoksa ya da boşsa `false`). */
export function dirHasEntries(path: string): Promise<boolean> {
  return command("dir_has_entries", { path }, path);
}

/**
 * İlk kare çizildi: pencereyi göster. Pencere gizli açılır (boş/beyaz kare
 * görünmesin); bu çağrı gelmezse Rust 3 sn sonra yine gösterir.
 */
export function appReady(): Promise<void> {
  return invoke("app_ready");
}
