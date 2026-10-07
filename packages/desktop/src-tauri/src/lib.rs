//! Tauri yapıştırıcısı: pencere, eklentiler ve `smap_host::Host`'u çağıran
//! ince komutlar. Mantık `crates/smap-host`'tadır ve orada test edilir.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use smap_host::{find_open_arg, percent_decode, ErrorKind, FileChange, Host, HostError, OpenedProject};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, FilePath};

const MAIN: &str = "main";
/// Ön yüz `app_ready` demezse pencere yine de bu süre sonunda görünür.
const SHOW_FALLBACK: Duration = Duration::from_secs(3);
pub const EVENT_FILE_CHANGED: &str = "smap://file-changed";
pub const EVENT_OPEN_FILE: &str = "smap://open-file";
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
async fn recent_add(host: State<'_, Host>, path: String, name: String) -> Result<(), HostError> {
    host.recent_add(&path, &name, now_ms()).map(|_| ())
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

/// WebView2'nin kendi zoom'u (Ctrl+tekerlek, Ctrl+±, dokunmatik yüzey
/// sıkıştırma) kapalı; olaylar sayfaya gider, tuval kendi zoom'unu yapar.
/// `zoomHotkeysEnabled: false` wry'de zaten `IsZoomControlEnabled`'ı
/// kapatır; burada açıkça bir kez daha ve pinch için de yapılır.
#[cfg(windows)]
fn disable_browser_zoom(window: &WebviewWindow) {
    let result = window.with_webview(|webview| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings5;
        use windows_core::Interface;
        let Ok(core) = webview.controller().CoreWebView2() else { return };
        let Ok(settings) = core.Settings() else { return };
        let _ = settings.SetIsZoomControlEnabled(false.into());
        if let Ok(s5) = settings.cast::<ICoreWebView2Settings5>() {
            let _ = s5.SetIsPinchZoomEnabled(false.into());
        }
    });
    if let Err(e) = result {
        log::warn!("could not disable WebView2 zoom: {e}");
    }
}

#[derive(Clone, Serialize)]
struct OpenFilePoke {}

pub fn run() {
    let started = std::time::Instant::now();
    tauri::Builder::default()
        // İlk eklenti olmalı: ikinci örnek hiçbir şey kurmadan çıkar.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            if let Some(path) = find_open_arg(&argv, Path::new(&cwd)) {
                if app.state::<Host>().offer_open(&path).is_some() {
                    let _ = app.emit_to(MAIN, EVENT_OPEN_FILE, OpenFilePoke {});
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

            let recent_file = app.path().app_config_dir().map(|d| d.join("recent.json")).unwrap_or_else(|_| PathBuf::from("recent.json"));
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

            #[cfg(windows)]
            if let Some(w) = app.get_webview_window(MAIN) {
                disable_browser_zoom(&w);
            }

            std::thread::spawn(move || {
                std::thread::sleep(SHOW_FALLBACK);
                show_main(&handle, "fallback timeout");
            });
            log::info!("setup done in {} ms", started.elapsed().as_millis());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_file,
            read_text,
            write_file_atomic,
            write_text_atomic,
            list_dir,
            create_dir_all,
            remove_file,
            exists,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Harita Tasarlayıcı");
}

fn install_panic_hook() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!("panic: {info}");
        default(info);
    }));
}
