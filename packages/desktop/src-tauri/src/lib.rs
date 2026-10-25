//! Tauri yapıştırıcısı: pencere, eklentiler ve `smap_host::Host`'u çağıran
//! ince komutlar. Mantık `crates/smap-host`'tadır ve orada test edilir.

mod ai;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use smap_host::close_guard::{CloseDecision, CloseGuard};
use smap_host::settings::SettingsFile;
use smap_host::{find_open_arg, percent_decode, ErrorKind, FileChange, Host, HostError, OpenedProject};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow, WebviewWindowBuilder, WebviewUrl, Window, WindowEvent};
use tauri_plugin_dialog::{DialogExt, FilePath};

const MAIN: &str = "main";
/// Ön yüz `app_ready` demezse pencere yine de bu süre sonunda görünür.
const SHOW_FALLBACK: Duration = Duration::from_secs(3);
pub const EVENT_FILE_CHANGED: &str = "smap://file-changed";
pub const EVENT_OPEN_FILE: &str = "smap://open-file";
/// Kaydedilmemiş iş varken pencere kapatılmak istendi: ön yüz sorar.
pub const EVENT_CLOSE_REQUESTED: &str = "smap://close-requested";
const PATH_HEADER: &str = "x-smap-path";

struct WorldWindow {
    host: Host,
    shown: AtomicBool,
    close_guard: CloseGuard,
    opening_path: Mutex<Option<PathBuf>>,
}

struct WindowHosts {
    worlds: Mutex<HashMap<String, Arc<WorldWindow>>>,
    recents: Arc<smap_host::recent::RecentStore>,
    next: AtomicU64,
    opening: Mutex<()>,
}

impl WindowHosts {
    fn get(&self, label: &str) -> Result<Arc<WorldWindow>, HostError> {
        self.worlds.lock().unwrap().get(label).cloned().ok_or_else(|| bad_input("unknown world window"))
    }
    fn insert(&self, app: &AppHandle, label: &str) -> Arc<WorldWindow> {
        let emitter = app.clone();
        let target = label.to_owned();
        let world = Arc::new(WorldWindow {
            host: Host::with_recents(self.recents.clone(), Arc::new(move |change: FileChange| {
                let _ = emitter.emit_to(&target, EVENT_FILE_CHANGED, change);
            })),
            shown: AtomicBool::new(false),
            close_guard: CloseGuard::new(),
            opening_path: Mutex::new(None),
        });
        self.worlds.lock().unwrap().insert(label.to_owned(), world.clone());
        world
    }
}


fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// One JS realm per world keeps histories, images, stamp editors and pending
/// AI transactions alive while the user works in another native window.
fn create_world_window(app: &AppHandle, path: Option<PathBuf>, template: Option<String>) -> Result<String, String> {
    let hosts = app.state::<WindowHosts>();
    let _opening = hosts.opening.lock().unwrap();
    let canonical = path.as_ref().map(|p| smap_host::scope::normalize(p).map_err(|e| e.to_string())).transpose()?;
    if let Some(file) = &canonical {
        let existing = hosts.worlds.lock().unwrap().iter().find_map(|(label, world)| {
            (world.opening_path.lock().unwrap().as_ref() == Some(file)
                || world.host.project_root().as_deref() == file.parent()).then(|| label.clone())
        });
        if let Some(label) = existing {
            if let Some(window) = app.get_webview_window(&label) {
                show_world(app, &label, "existing world");
                let _ = window.unminimize(); let _ = window.show(); let _ = window.set_focus();
                return Ok(label);
            }
        }
    }
    let label = format!("world-{}", hosts.next.fetch_add(1, Ordering::Relaxed));
    let world = hosts.insert(app, &label);
    if let Some(file) = canonical {
        *world.opening_path.lock().unwrap() = Some(file.clone());
        if world.host.offer_open(&file).is_none() {
            hosts.worlds.lock().unwrap().remove(&label);
            return Err("Could not open the selected world".into());
        }
    }
    let services = app.state::<smap_host::mcp::WindowServices>();
    let emitter = app.clone();
    let target = label.clone();
    let service = match services.register(&label, Arc::new(move |event, payload| {
        emitter.emit_to(&target, event, payload).map_err(|_| "renderer unavailable".into())
    })) {
        Ok(service) => service,
        Err(error) => { hosts.worlds.lock().unwrap().remove(&label); return Err(error.to_string()); }
    };
    // Templates are a fixed enum; never interpolate arbitrary text into a URL.
    let url = if template.is_some() { "index.html?newWorld=1" } else { "index.html" };
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
        .title("Harita Tasarlayıcı").inner_size(1440.0, 900.0)
        .min_inner_size(960.0, 600.0).visible(false)
        .theme(Some(tauri::Theme::Dark)).center()
        .zoom_hotkeys_enabled(false).disable_drag_drop_handler().build();
    match window {
        Ok(window) => {
            tauri::async_runtime::spawn(async move { service.start().await; });
            #[cfg(windows)] harden_webview(&window);
            let fallback = app.clone();
            let target = label.clone();
            std::thread::spawn(move || { std::thread::sleep(SHOW_FALLBACK); show_world(&fallback, &target, "fallback timeout"); });
            Ok(label)
        }
        Err(error) => {
            hosts.worlds.lock().unwrap().remove(&label);
            if let Some(service) = services.remove(&label) {
                tauri::async_runtime::spawn(async move { service.finish_shutdown().await; });
            }
            Err(error.to_string())
        }
    }
}

#[tauri::command]
async fn world_window_open(window: WebviewWindow, app: AppHandle, hosts: State<'_, WindowHosts>, kind: String, path: Option<String>) -> Result<bool, String> {
    let world = hosts.get(window.label()).map_err(|e| e.to_string())?;
    let selected = match kind.as_str() {
        "new" => return create_world_window(&app, None, Some("empty".into())).map(|_| true),
        "picker" => {
            let picked = window.dialog().file().set_parent(&window).add_filter("Harita Tasarlayıcı", &["smap"]).blocking_pick_file();
            let Some(picked) = picked else { return Ok(false) };
            let file = to_path(picked).map_err(|e| e.to_string())?;
            world.host.allow_user_file(&file).map_err(|e| e.to_string())?
        }
        "path" | "recent" => path.ok_or("missing world path")?,
        _ => return Err("unknown world action".into()),
    };
    let file = world.host.authorize_project_path(&selected).map_err(|e| e.to_string())?;
    create_world_window(&app, Some(file), None).map(|_| true)
}

fn bad_input(message: &str) -> HostError {
    HostError { kind: ErrorKind::InvalidPath, path: String::new(), message: message.to_owned() }
}

// ---- dosya komutları ------------------------------------------------------
// Hepsi `async`: Tauri senkron komutları ana iş parçacığında çalıştırır,
// disk beklerken arayüz donmasın.

#[tauri::command]
async fn read_file(window: WebviewWindow, hosts: State<'_, WindowHosts>, path: String) -> Result<Response, HostError> {
    let world = hosts.get(window.label())?;
    let host = &world.host;
    host.read_file(&path).map(Response::new)
}

/// A file referenced by a Tiled map the user picked (Dosya → İçe aktar →
/// Tiled haritası…): `.tsx`/`.tsj` tilesets and PNG sheets. Read-only.
#[tauri::command]
async fn tiled_read_related(window: WebviewWindow, hosts: State<'_, WindowHosts>, map_path: String, path: String) -> Result<Response, HostError> {
    let world = hosts.get(window.label())?;
    world.host.read_tiled_related(&map_path, &path).map(Response::new)
}

#[tauri::command]
async fn read_text(window: WebviewWindow, hosts: State<'_, WindowHosts>, path: String) -> Result<String, HostError> {
    let world = hosts.get(window.label())?;
    let host = &world.host;
    host.read_text(&path)
}

/// İkili gövde (JSON'a çevirmeden): yol `x-smap-path` başlığında,
/// `encodeURIComponent` ile kodlanmış.
#[tauri::command]
async fn write_file_atomic(window: WebviewWindow, hosts: State<'_, WindowHosts>, request: Request<'_>) -> Result<(), HostError> {
    let world = hosts.get(window.label())?;
    let host = &world.host;
    let path = request
        .headers()
        .get(PATH_HEADER)
        .and_then(|v| v.to_str().ok())
        .and_then(percent_decode)
        .ok_or_else(|| bad_input("missing x-smap-path header"))?;
    match request.body() {
        InvokeBody::Raw(bytes) => host.write_file_atomic(&path, bytes),
        InvokeBody::Json(_) => Err(bad_input("expected a raw byte body")),
    }
}

#[tauri::command]
async fn write_text_atomic(window: WebviewWindow, hosts: State<'_, WindowHosts>, path: String, text: String) -> Result<(), HostError> {
    let world = hosts.get(window.label())?;
    let host = &world.host;
    host.write_file_atomic(&path, text.as_bytes())
}

#[tauri::command]
async fn list_dir(window: WebviewWindow, hosts: State<'_, WindowHosts>, path: String) -> Result<Vec<String>, HostError> {
    let world = hosts.get(window.label())?;
    let host = &world.host;
    host.list_dir(&path)
}

#[tauri::command]
async fn create_dir_all(window: WebviewWindow, hosts: State<'_, WindowHosts>, path: String) -> Result<(), HostError> {
    let world = hosts.get(window.label())?;
    let host = &world.host;
    host.create_dir_all(&path)
}

#[tauri::command]
async fn remove_file(window: WebviewWindow, hosts: State<'_, WindowHosts>, path: String) -> Result<(), HostError> {
    let world = hosts.get(window.label())?;
    let host = &world.host;
    host.remove_file(&path)
}

#[tauri::command]
async fn exists(window: WebviewWindow, hosts: State<'_, WindowHosts>, path: String) -> Result<bool, HostError> {
    let world = hosts.get(window.label())?;
    let host = &world.host;
    host.exists(&path)
}

#[tauri::command]
async fn dir_has_entries(window: WebviewWindow, hosts: State<'_, WindowHosts>, path: String) -> Result<bool, HostError> {
    let world = hosts.get(window.label())?;
    let host = &world.host;
    host.dir_has_entries(&path)
}

#[tauri::command]
async fn replace_png_guarded(window: WebviewWindow, hosts: State<'_, WindowHosts>, request: Request<'_>) -> Result<(), HostError> {
    let world = hosts.get(window.label())?;
    let host = &world.host;
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok());
    let path = header(PATH_HEADER).and_then(percent_decode).ok_or_else(|| bad_input("missing x-smap-path header"))?;
    let backup = header("x-smap-backup").and_then(percent_decode).ok_or_else(|| bad_input("missing x-smap-backup header"))?;
    let length = header("x-smap-expected-length").and_then(|v| v.parse::<usize>().ok()).ok_or_else(|| bad_input("invalid expected length"))?;
    match request.body() {
        InvokeBody::Raw(bytes) if length <= bytes.len() => host.replace_png_guarded(&path, &backup, &bytes[..length], &bytes[length..]),
        _ => Err(bad_input("expected original and replacement PNG bytes")),
    }
}

// ---- ayar dosyası ---------------------------------------------------------
// `settings.json` uygulama ayar klasöründe; yol webview'den gelmez.

fn settings_error(settings: &SettingsFile, e: std::io::Error) -> HostError {
    let kind = if e.kind() == std::io::ErrorKind::NotFound { ErrorKind::NotFound } else { ErrorKind::Io };
    HostError { kind, path: settings.path().to_string_lossy().into_owned(), message: e.to_string() }
}

#[tauri::command]
async fn settings_read(settings: State<'_, SettingsFile>) -> Result<Option<String>, HostError> {
    settings.read().map_err(|e| settings_error(&settings, e))
}

#[tauri::command]
async fn settings_write(settings: State<'_, SettingsFile>, text: String) -> Result<(), HostError> {
    settings.write(&text).map_err(|e| settings_error(&settings, e))
}

#[tauri::command]
fn settings_path(settings: State<'_, SettingsFile>) -> String {
    settings.path().to_string_lossy().into_owned()
}

#[tauri::command]
fn window_set_title(window: WebviewWindow, title: String) {
    let _ = window.set_title(&title);
}

// ---- pencere kapatma ----------------------------------------------------------
// X / Alt+F4 / görev çubuğu: kaydedilmemiş iş yoksa hemen kapanır, varsa ön
// yüz sorar (Kaydet / Kaydetme / Vazgeç) ve kararı `window_close` ile verir.

#[tauri::command]
fn close_guard_set(window: WebviewWindow, hosts: State<'_, WindowHosts>, unsaved: bool) {
    if let Ok(world) = hosts.get(window.label()) { world.close_guard.set_unsaved(unsaved); }
}

#[tauri::command]
fn close_request_ack(window: WebviewWindow, hosts: State<'_, WindowHosts>) {
    if let Ok(world) = hosts.get(window.label()) { world.close_guard.ack(); }
}

/// Ön yüz "kapat" dedi. `destroy` `CloseRequested` üretmez; son pencereyle uygulama çıkar.
#[tauri::command]
fn window_close(window: WebviewWindow) {
    log::info!("window closed by the user");
    let _ = window.destroy();
}

fn on_window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::Destroyed = event {
        if let Some(hosts) = window.try_state::<WindowHosts>() {
            hosts.worlds.lock().unwrap().remove(window.label());
        }
        if let Some(services) = window.try_state::<smap_host::mcp::WindowServices>() {
            if let Some(service) = services.remove(window.label()) {
                tauri::async_runtime::spawn(async move { service.finish_shutdown().await; });
            }
        }
        return;
    }
    let WindowEvent::CloseRequested { api, .. } = event else { return };
    let Some(hosts) = window.try_state::<WindowHosts>() else { return };
    let Ok(world) = hosts.get(window.label()) else { return };
    match world.close_guard.on_close_requested(Instant::now()) {
        CloseDecision::Close => log::info!("window closing {}", window.label()),
        CloseDecision::Ask => {
            api.prevent_close();
            let _ = window.app_handle().emit_to(window.label(), EVENT_CLOSE_REQUESTED, Poke {});
        }
    }
}

// ---- diyaloglar -------------------------------------------------------------
// Diyaloglar Rust'tan açılır: seçilen yol kapsama burada eklenir, webview'e
// dialog eklentisi izni verilmez.

fn to_path(fp: FilePath) -> Result<PathBuf, HostError> {
    fp.into_path().map_err(|e| bad_input(&e.to_string()))
}

#[tauri::command]
async fn dialog_open_project(
    window: WebviewWindow,
    hosts: State<'_, WindowHosts>,
    title: Option<String>,
    filter_name: Option<String>,
) -> Result<Option<String>, HostError> {
    let world = hosts.get(window.label())?;
    let host = &world.host;
    let mut d = window
        .dialog()
        .file()
        .set_parent(&window)
        .add_filter(filter_name.as_deref().unwrap_or("Harita Tasarlayıcı"), &["smap"]);
    if let Some(t) = title {
        d = d.set_title(t);
    }
    d.blocking_pick_file().map(|fp| host.allow_user_file(&to_path(fp)?)).transpose()
}

#[tauri::command]
async fn dialog_pick_folder(window: WebviewWindow, hosts: State<'_, WindowHosts>, title: Option<String>) -> Result<Option<String>, HostError> {
    let world = hosts.get(window.label())?;
    let host = &world.host;
    let mut d = window.dialog().file().set_parent(&window);
    if let Some(t) = title {
        d = d.set_title(t);
    }
    d.blocking_pick_folder().map(|fp| host.allow_user_dir(&to_path(fp)?)).transpose()
}

#[tauri::command]
async fn dialog_pick_files(
    window: WebviewWindow,
    hosts: State<'_, WindowHosts>,
    title: Option<String>,
    filter_name: Option<String>,
    extensions: Vec<String>,
) -> Result<Vec<String>, HostError> {
    let world = hosts.get(window.label())?;
    let host = &world.host;
    let mut d = window.dialog().file().set_parent(&window);
    if !extensions.is_empty() {
        let exts: Vec<&str> = extensions.iter().map(String::as_str).collect();
        d = d.add_filter(filter_name.as_deref().unwrap_or(""), &exts);
    }
    if let Some(t) = title {
        d = d.set_title(t);
    }
    let picked = d.blocking_pick_files().unwrap_or_default();
    picked.into_iter().map(|fp| host.allow_user_file(&to_path(fp)?)).collect()
}

#[tauri::command]
async fn dialog_save_file(
    window: WebviewWindow,
    hosts: State<'_, WindowHosts>,
    title: Option<String>,
    default_name: Option<String>,
    filter_name: Option<String>,
    extensions: Vec<String>,
) -> Result<Option<String>, HostError> {
    let world = hosts.get(window.label())?;
    let host = &world.host;
    let mut d = window.dialog().file().set_parent(&window);
    if !extensions.is_empty() {
        let exts: Vec<&str> = extensions.iter().map(String::as_str).collect();
        d = d.add_filter(filter_name.as_deref().unwrap_or(""), &exts);
    }
    if let Some(t) = title {
        d = d.set_title(t);
    }
    if let Some(n) = default_name {
        d = d.set_file_name(n);
    }
    d.blocking_save_file().map(|fp| host.allow_user_file(&to_path(fp)?)).transpose()
}

// ---- proje, son projeler ---------------------------------------------------

#[tauri::command]
async fn project_open(window: WebviewWindow, hosts: State<'_, WindowHosts>, path: String, name: Option<String>) -> Result<OpenedProject, HostError> {
    let world = hosts.get(window.label())?;
    let host = &world.host;
    let opened = host.open_project(&path, name.as_deref().unwrap_or(""), now_ms());
    *world.opening_path.lock().unwrap() = None;
    opened
}

#[tauri::command]
async fn project_set_root(window: WebviewWindow, hosts: State<'_, WindowHosts>, dir: String) -> Result<String, HostError> {
    let world = hosts.get(window.label())?;
    let host = &world.host;
    host.set_project_root(&dir)
}

#[tauri::command]
async fn project_close(window: WebviewWindow, hosts: State<'_, WindowHosts>) -> Result<(), HostError> {
    let world = hosts.get(window.label())?;
    let host = &world.host;
    host.close_project();
    *world.opening_path.lock().unwrap() = None;
    Ok(())
}

/// Çift tıklamayla gelen, henüz işlenmemiş `.smap` yolu (bir kez döner).
#[tauri::command]
fn take_open_request(window: WebviewWindow, hosts: State<'_, WindowHosts>) -> Option<String> {
    hosts.get(window.label()).ok()?.host.take_pending_open()
}

#[tauri::command]
async fn recent_list(window: WebviewWindow, hosts: State<'_, WindowHosts>) -> Result<Vec<smap_host::recent::RecentView>, HostError> {
    let world = hosts.get(window.label())?;
    let host = &world.host;
    Ok(host.recent_list())
}

#[tauri::command]
async fn recent_add(window: WebviewWindow, hosts: State<'_, WindowHosts>, path: String, name: String, thumbnail: Option<String>) -> Result<(), HostError> {
    let world = hosts.get(window.label())?;
    let host = &world.host;
    host.recent_add(&path, &name, thumbnail.as_deref(), now_ms()).map(|_| ())
}

#[tauri::command]
async fn recent_remove(window: WebviewWindow, hosts: State<'_, WindowHosts>, path: String) -> Result<(), HostError> {
    let world = hosts.get(window.label())?;
    let host = &world.host;
    host.recent_remove(&path).map(|_| ())
}

// ---- log, açılış ----------------------------------------------------------

#[tauri::command]
fn log_write(level: String, message: String) {
    let level = match level.as_str() {
        "error" => log::Level::Error,
        "warn" => log::Level::Warn,
        "debug" => log::Level::Debug,
        "trace" => log::Level::Trace,
        _ => log::Level::Info,
    };
    log::log!(target: "frontend", level, "{message}");
}

/// Ön yüz ilk karesini çizdi: pencereyi şimdi göster (beyaz/boş kare yok).
#[tauri::command]
fn app_ready(window: WebviewWindow) {
    show_world(window.app_handle(), window.label(), "frontend ready");
}

fn show_main(app: &AppHandle, why: &str) {
    show_world(app, MAIN, why);
}

fn show_world(app: &AppHandle, label: &str, why: &str) {
    let Some(hosts) = app.try_state::<WindowHosts>() else { return };
    let Ok(world) = hosts.get(label) else { return };
    if world.shown.swap(true, Ordering::SeqCst) { return; }
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.show();
        let _ = w.set_focus();
    }
    log::info!("window shown ({why})");
}

fn focus_main(app: &AppHandle) {
    show_main(app, "second instance");
    if let Some(w) = app.get_webview_window(MAIN).or_else(|| app.webview_windows().into_values().next()) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// WebView2'yi tarayıcı değil uygulama gibi davrandırır:
///
/// - Kendi zoom'u (Ctrl+tekerlek, Ctrl+±, dokunmatik yüzey sıkıştırma)
///   kapalı; olaylar sayfaya gider, tuval kendi zoom'unu yapar.
///   `zoomHotkeysEnabled: false` wry'de zaten `IsZoomControlEnabled`'ı
///   kapatır; burada açıkça bir kez daha ve pinch için de yapılır.
/// - Tarayıcı kısayolları (F5, Ctrl+R, Ctrl+P, Ctrl+F, F7, Ctrl+U...) kapalı.
///   Düzenleme tuşları (Ctrl+C/V/X/Z/A) tarayıcı kısayolu sayılmaz, metin
///   kutularında çalışmaya devam eder; olaylar sayfaya yine gelir.
/// - Sağ tık menüsü (Geri / Yenile / Yazdır) yalnız metin kutularında
///   (Kes / Kopyala / Yapıştır) açılır; başka her yerde sayfa kendi menüsünü
///   gösterir ya da hiçbir şey olmaz. Olay kaydı olmazsa menü tamamen kapanır.
#[cfg(windows)]
fn harden_webview(window: &WebviewWindow) {
    let result = window.with_webview(|webview| unsafe {
        use webview2_com::ContextMenuRequestedEventHandler;
        use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2Settings3, ICoreWebView2Settings5, ICoreWebView2_11};
        use windows_core::{Interface, BOOL};
        let Ok(core) = webview.controller().CoreWebView2() else { return };
        let Ok(settings) = core.Settings() else { return };
        let _ = settings.SetIsZoomControlEnabled(false);
        if let Ok(s5) = settings.cast::<ICoreWebView2Settings5>() {
            let _ = s5.SetIsPinchZoomEnabled(false);
        }
        if let Ok(s3) = settings.cast::<ICoreWebView2Settings3>() {
            if let Err(e) = s3.SetAreBrowserAcceleratorKeysEnabled(false) {
                log::warn!("could not disable WebView2 accelerator keys: {e}");
            }
        }
        let handler = ContextMenuRequestedEventHandler::create(Box::new(|_, args| {
            let Some(args) = args else { return Ok(()) };
            let mut editable = BOOL::default();
            let is_editable = args.ContextMenuTarget().and_then(|t| t.IsEditable(&mut editable)).is_ok() && editable.as_bool();
            if !is_editable {
                args.SetHandled(true)?;
            }
            Ok(())
        }));
        let mut token = 0i64;
        let filtered = core.cast::<ICoreWebView2_11>().and_then(|core11| core11.add_ContextMenuRequested(&handler, &mut token));
        if let Err(e) = filtered {
            log::warn!("WebView2 context menu filter unavailable ({e}); disabling default context menus");
            let _ = settings.SetAreDefaultContextMenusEnabled(false);
        }
    });
    if let Err(e) = result {
        log::warn!("could not configure WebView2: {e}");
    }
}

#[derive(Clone, Serialize)]
struct Poke {}

pub fn run() {
    let started = std::time::Instant::now();
    tauri::Builder::default()
        // İlk eklenti olmalı: ikinci örnek hiçbir şey kurmadan çıkar.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            if let Some(path) = find_open_arg(&argv, Path::new(&cwd)) {
                // WM_COPYDATA runs on the Windows UI thread. Building another
                // webview can wait for that thread, so never hold launch locks here.
                let handle = app.clone();
                std::thread::spawn(move || {
                    if let Err(error) = create_world_window(&handle, Some(path), None) { log::error!("open world: {error}"); }
                });
            } else {
                focus_main(app);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            let handle = app.handle().clone();
            if let Ok(dir) = app.path().app_log_dir() {
                let level = if cfg!(debug_assertions) { log::LevelFilter::Debug } else { log::LevelFilter::Info };
                smap_host::logfile::init(dir, level);
            }
            install_panic_hook();
            log::info!("starting v{}", app.package_info().version);

            let config_dir = app.path().app_config_dir()?;
            let recent_file = config_dir.join("recent.json");
            let settings = SettingsFile::new(config_dir.join("settings.json"));
            let ai_emitter = handle.clone();
            let ai_services = smap_host::mcp::WindowServices::new(config_dir.clone(), settings.clone());
            let ai_service = ai_services.register(MAIN,
                Arc::new(move |event, payload| ai_emitter.emit_to(MAIN, event, payload).map_err(|_| "renderer unavailable".into())),
            )?;
            app.manage(ai_services);
            tauri::async_runtime::spawn(async move { ai_service.start().await; });
            app.manage(settings);
            let hosts = WindowHosts {
                worlds: Mutex::new(HashMap::new()),
                recents: Arc::new(smap_host::recent::RecentStore::new(recent_file)),
                next: AtomicU64::new(1),
                opening: Mutex::new(()),
            };
            let world = hosts.insert(&handle, MAIN);
            let args: Vec<String> = std::env::args().collect();
            let cwd = std::env::current_dir().unwrap_or_default();
            if let Some(path) = find_open_arg(&args, &cwd) {
                *world.opening_path.lock().unwrap() = smap_host::scope::normalize(&path).ok();
                world.host.offer_open(&path);
            }
            app.manage(hosts);

            #[cfg(windows)]
            if let Some(w) = app.get_webview_window(MAIN) {
                harden_webview(&w);
            }

            std::thread::spawn(move || {
                std::thread::sleep(SHOW_FALLBACK);
                show_main(&handle, "fallback timeout");
            });
            log::info!("setup done in {} ms", started.elapsed().as_millis());
            Ok(())
        })
        .on_page_load(|window, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                if let Some(services) = window.try_state::<smap_host::mcp::WindowServices>() {
                    if let Some(service) = services.get(window.label()) {
                        service.transport().renderer_lost();
                    }
                }
            }
        })
        .on_window_event(on_window_event)
        .invoke_handler(tauri::generate_handler![
            read_file,
            read_text,
            write_file_atomic,
            write_text_atomic,
            replace_png_guarded,
            list_dir,
            create_dir_all,
            remove_file,
            exists,
            dir_has_entries,
            settings_read,
            settings_write,
            settings_path,
            window_set_title,
            close_guard_set,
            close_request_ack,
            window_close,
            dialog_open_project,
            dialog_pick_folder,
            dialog_pick_files,
            dialog_save_file,
            project_open,
            project_set_root,
            project_close,
            take_open_request,
            recent_list,
            recent_add,
            recent_remove,
            log_write,
            app_ready,
            world_window_open,
            ai::ai_get_status,
            ai::ai_set_config,
            ai::ai_reveal_token,
            ai::ai_regenerate_token,
            ai::agent_ready,
            ai::agent_reply,
            ai::agent_publish_status,
            ai::ai_read_reference_image,
            ai::ai_read_tiled_file,
            tiled_read_related,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Harita Tasarlayıcı")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                if let Some(services) = app.try_state::<smap_host::mcp::WindowServices>() { services.shutdown_all(); }
            }
        });
}

fn install_panic_hook() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!("panic: {info}");
        default(info);
    }));
}
