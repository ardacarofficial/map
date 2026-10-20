//! Tauri yapıştırıcısı: pencere, eklentiler ve `smap_host::Host`'u çağıran
//! ince komutlar. Mantık `crates/smap-host`'tadır ve orada test edilir.

mod ai;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use smap_host::close_guard::{CloseDecision, CloseGuard};
use smap_host::settings::SettingsFile;
use smap_host::{find_open_arg, percent_decode, ErrorKind, FileChange, Host, HostError, OpenedProject};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow, Window, WindowEvent};
use tauri_plugin_dialog::{DialogExt, FilePath};

const MAIN: &str = "main";
/// Ön yüz `app_ready` demezse pencere yine de bu süre sonunda görünür.
const SHOW_FALLBACK: Duration = Duration::from_secs(3);
pub const EVENT_FILE_CHANGED: &str = "smap://file-changed";
pub const EVENT_OPEN_FILE: &str = "smap://open-file";
/// Kaydedilmemiş iş varken pencere kapatılmak istendi: ön yüz sorar.
pub const EVENT_CLOSE_REQUESTED: &str = "smap://close-requested";
const PATH_HEADER: &str = "x-smap-path";

struct Shown(AtomicBool);

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn bad_input(message: &str) -> HostError {
    HostError { kind: ErrorKind::InvalidPath, path: String::new(), message: message.to_owned() }
}

// ---- dosya komutları ------------------------------------------------------
// Hepsi `async`: Tauri senkron komutları ana iş parçacığında çalıştırır,
// disk beklerken arayüz donmasın.

#[tauri::command]
async fn read_file(host: State<'_, Host>, path: String) -> Result<Response, HostError> {
    host.read_file(&path).map(Response::new)
}

#[tauri::command]
async fn read_text(host: State<'_, Host>, path: String) -> Result<String, HostError> {
    host.read_text(&path)
}

/// İkili gövde (JSON'a çevirmeden): yol `x-smap-path` başlığında,
/// `encodeURIComponent` ile kodlanmış.
#[tauri::command]
async fn write_file_atomic(host: State<'_, Host>, request: Request<'_>) -> Result<(), HostError> {
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
async fn write_text_atomic(host: State<'_, Host>, path: String, text: String) -> Result<(), HostError> {
    host.write_file_atomic(&path, text.as_bytes())
}

#[tauri::command]
async fn list_dir(host: State<'_, Host>, path: String) -> Result<Vec<String>, HostError> {
    host.list_dir(&path)
}

#[tauri::command]
async fn create_dir_all(host: State<'_, Host>, path: String) -> Result<(), HostError> {
    host.create_dir_all(&path)
}

#[tauri::command]
async fn remove_file(host: State<'_, Host>, path: String) -> Result<(), HostError> {
    host.remove_file(&path)
}

#[tauri::command]
async fn exists(host: State<'_, Host>, path: String) -> Result<bool, HostError> {
    host.exists(&path)
}

#[tauri::command]
async fn dir_has_entries(host: State<'_, Host>, path: String) -> Result<bool, HostError> {
    host.dir_has_entries(&path)
}

#[tauri::command]
async fn replace_png_guarded(host: State<'_, Host>, request: Request<'_>) -> Result<(), HostError> {
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
fn close_guard_set(guard: State<'_, CloseGuard>, unsaved: bool) {
    guard.set_unsaved(unsaved);
}

#[tauri::command]
fn close_request_ack(guard: State<'_, CloseGuard>) {
    guard.ack();
}

/// Ön yüz "kapat" dedi. `destroy` `CloseRequested` üretmez; son pencereyle uygulama çıkar.
#[tauri::command]
fn window_close(window: WebviewWindow) {
    log::info!("window closed by the user");
    let _ = window.destroy();
}

fn on_window_event(window: &Window, event: &WindowEvent) {
    let WindowEvent::CloseRequested { api, .. } = event else { return };
    if window.label() != MAIN {
        return;
    }
    let Some(guard) = window.try_state::<CloseGuard>() else { return };
    match guard.on_close_requested(Instant::now()) {
        CloseDecision::Close => log::info!("window closing"),
        CloseDecision::Ask => {
            api.prevent_close();
            let _ = window.app_handle().emit_to(MAIN, EVENT_CLOSE_REQUESTED, Poke {});
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
    host: State<'_, Host>,
    title: Option<String>,
    filter_name: Option<String>,
) -> Result<Option<String>, HostError> {
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
async fn dialog_pick_folder(window: WebviewWindow, host: State<'_, Host>, title: Option<String>) -> Result<Option<String>, HostError> {
    let mut d = window.dialog().file().set_parent(&window);
    if let Some(t) = title {
        d = d.set_title(t);
    }
    d.blocking_pick_folder().map(|fp| host.allow_user_dir(&to_path(fp)?)).transpose()
}

#[tauri::command]
async fn dialog_pick_files(
    window: WebviewWindow,
    host: State<'_, Host>,
    title: Option<String>,
    filter_name: Option<String>,
    extensions: Vec<String>,
) -> Result<Vec<String>, HostError> {
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
    host: State<'_, Host>,
    title: Option<String>,
    default_name: Option<String>,
    filter_name: Option<String>,
    extensions: Vec<String>,
) -> Result<Option<String>, HostError> {
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
async fn project_open(host: State<'_, Host>, path: String, name: Option<String>) -> Result<OpenedProject, HostError> {
    host.open_project(&path, name.as_deref().unwrap_or(""), now_ms())
}

#[tauri::command]
async fn project_set_root(host: State<'_, Host>, dir: String) -> Result<String, HostError> {
    host.set_project_root(&dir)
}

#[tauri::command]
async fn project_close(host: State<'_, Host>) -> Result<(), HostError> {
    host.close_project();
    Ok(())
}

/// Çift tıklamayla gelen, henüz işlenmemiş `.smap` yolu (bir kez döner).
#[tauri::command]
fn take_open_request(host: State<'_, Host>) -> Option<String> {
    host.take_pending_open()
}

#[tauri::command]
async fn recent_list(host: State<'_, Host>) -> Result<Vec<smap_host::recent::RecentView>, HostError> {
    Ok(host.recent_list())
}

#[tauri::command]
async fn recent_add(host: State<'_, Host>, path: String, name: String, thumbnail: Option<String>) -> Result<(), HostError> {
    host.recent_add(&path, &name, thumbnail.as_deref(), now_ms()).map(|_| ())
}

#[tauri::command]
async fn recent_remove(host: State<'_, Host>, path: String) -> Result<(), HostError> {
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
fn app_ready(app: AppHandle) {
    show_main(&app, "frontend ready");
}

fn show_main(app: &AppHandle, why: &str) {
    if app.state::<Shown>().0.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.show();
        let _ = w.set_focus();
    }
    log::info!("window shown ({why})");
}

fn focus_main(app: &AppHandle) {
    show_main(app, "second instance");
    if let Some(w) = app.get_webview_window(MAIN) {
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
                if app.state::<Host>().offer_open(&path).is_some() {
                    let _ = app.emit_to(MAIN, EVENT_OPEN_FILE, Poke {});
                }
            }
            focus_main(app);
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
            let ai_service = Arc::new(smap_host::mcp::Service::new(
                settings.clone(),
                smap_host::mcp::SecretFile::new(config_dir.join("ai-secret.json")),
                Arc::new(move |event, payload| ai_emitter.emit_to(MAIN, event, payload).map_err(|_| "renderer unavailable".into())),
            )?);
            app.manage(ai_service.clone());
            tauri::async_runtime::spawn(async move { ai_service.start().await; });
            app.manage(settings);
            let emitter = handle.clone();
            let host = Host::new(
                recent_file,
                Arc::new(move |change: FileChange| {
                    let _ = emitter.emit_to(MAIN, EVENT_FILE_CHANGED, change);
                }),
            );
            let args: Vec<String> = std::env::args().collect();
            let cwd = std::env::current_dir().unwrap_or_default();
            if let Some(path) = find_open_arg(&args, &cwd) {
                host.offer_open(&path);
            }
            app.manage(host);
            app.manage(Shown(AtomicBool::new(false)));
            app.manage(CloseGuard::new());

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
            if window.label() == MAIN && matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                if let Some(service) = window.try_state::<Arc<smap_host::mcp::Service>>() {
                    service.transport().renderer_lost();
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
            ai::ai_get_status,
            ai::ai_set_config,
            ai::ai_reveal_token,
            ai::ai_regenerate_token,
            ai::agent_ready,
            ai::agent_reply,
            ai::agent_publish_status,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Harita Tasarlayıcı")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                if let Some(service) = app.try_state::<Arc<smap_host::mcp::Service>>() { service.shutdown(); }
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
