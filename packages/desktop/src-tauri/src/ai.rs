//! Caller-window-bound glue for the pure Rust MCP service.
use serde_json::Value;
use smap_host::mcp::{Service, SettingsSnapshot, WindowServices};
use std::sync::Arc;
use tauri::{State, WebviewWindow};

type Ai<'a> = State<'a, WindowServices>;
fn caller_service(
    window: &WebviewWindow,
    services: &WindowServices,
) -> Result<Arc<Service>, String> {
    services
        .get(window.label())
        .ok_or_else(|| "AI window unavailable".into())
}
#[tauri::command]
pub async fn ai_get_status(window: WebviewWindow, services: Ai<'_>) -> Result<Value, String> {
    let service = caller_service(&window, &services)?;
    Ok(service.get_status().await)
}
#[tauri::command]
pub async fn ai_set_config(
    window: WebviewWindow,
    services: Ai<'_>,
    settings: Value,
    expected_revision: u64,
) -> Result<Value, String> {
    let service = caller_service(&window, &services)?;
    Ok(service.set_config_json(settings, expected_revision).await)
}
#[tauri::command]
pub async fn ai_reveal_token(window: WebviewWindow, services: Ai<'_>) -> Result<String, String> {
    let service = caller_service(&window, &services)?;
    service.reveal_token().await
}
#[tauri::command]
pub async fn ai_regenerate_token(
    window: WebviewWindow,
    services: Ai<'_>,
    expected_revision: u64,
) -> Result<SettingsSnapshot, String> {
    let service = caller_service(&window, &services)?;
    service.regenerate_token(expected_revision).await
}
#[tauri::command]
pub fn agent_ready(window: WebviewWindow, services: Ai<'_>, epoch: String) -> Result<(), String> {
    let service = caller_service(&window, &services)?;
    service.transport().ready(epoch)
}
#[tauri::command]
pub fn agent_reply(window: WebviewWindow, services: Ai<'_>, reply: Value) -> Result<(), String> {
    let service = caller_service(&window, &services)?;
    service.transport().reply(reply)
}
#[tauri::command]
pub fn agent_publish_status(
    window: WebviewWindow,
    services: Ai<'_>,
    status: Value,
) -> Result<(), String> {
    let service = caller_service(&window, &services)?;
    service.transport().publish_status(status)
}

/// Largest reference picture the agent may hand over by path (`reference_add`).
const REFERENCE_MAX_BYTES: u64 = 16 * 1024 * 1024;

/// Read-only intake of one agent-named local picture. Only absolute paths to
/// `.png`/`.jpg`/`.jpeg`/`.webp` regular files up to 16 MB; the bytes go to this
/// window's editor, which decodes them in memory and never writes them anywhere.
#[tauri::command]
pub async fn ai_read_reference_image(
    window: WebviewWindow,
    services: Ai<'_>,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    caller_service(&window, &services)?;
    read_reference_image(std::path::Path::new(&path)).map(tauri::ipc::Response::new)
}

pub(crate) fn read_reference_image(path: &std::path::Path) -> Result<Vec<u8>, String> {
    if !path.is_absolute() {
        return Err("path must be absolute".into());
    }
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if !matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "webp") {
        return Err("unsupported type: use .png, .jpg, .jpeg or .webp".into());
    }
    let metadata = std::fs::metadata(path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "not found".to_string()
        } else {
            e.to_string()
        }
    })?;
    if !metadata.is_file() {
        return Err("not found".into());
    }
    if metadata.len() > REFERENCE_MAX_BYTES {
        return Err("file too large (16 MB limit)".into());
    }
    use std::io::Read;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    std::fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take(REFERENCE_MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > REFERENCE_MAX_BYTES {
        return Err("file too large (16 MB limit)".into());
    }
    Ok(bytes)
}

#[cfg(test)]
mod reference_tests {
    use super::read_reference_image;

    #[test]
    fn reads_only_absolute_image_files_within_the_limit() {
        let dir = std::env::temp_dir().join(format!("smap-ref-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let png = dir.join("map.PNG");
        std::fs::write(&png, b"\x89PNG data").unwrap();
        assert_eq!(read_reference_image(&png).unwrap(), b"\x89PNG data");
        assert!(read_reference_image(std::path::Path::new("relative.png")).unwrap_err().contains("absolute"));
        let text = dir.join("notes.txt");
        std::fs::write(&text, b"x").unwrap();
        assert!(read_reference_image(&text).unwrap_err().contains("unsupported"));
        assert_eq!(read_reference_image(&dir.join("missing.webp")).unwrap_err(), "not found");
        assert_eq!(read_reference_image(&dir.join("folder.jpg")).unwrap_err(), "not found");
        let big = dir.join("big.jpg");
        std::fs::File::create(&big).unwrap().set_len(16 * 1024 * 1024 + 1).unwrap();
        assert!(read_reference_image(&big).unwrap_err().contains("too large"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
