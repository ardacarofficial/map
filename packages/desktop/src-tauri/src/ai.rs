//! Main-window-only glue for the pure Rust MCP service.
use serde_json::Value;
use smap_host::mcp::{Service, SettingsSnapshot};
use std::sync::Arc;
use tauri::{State, WebviewWindow};

type Ai<'a> = State<'a, Arc<Service>>;
fn main_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("AI commands require the main window".into())
    }
}
#[tauri::command]
pub async fn ai_get_status(window: WebviewWindow, service: Ai<'_>) -> Result<Value, String> {
    main_window(&window)?;
    Ok(service.get_status().await)
}
#[tauri::command]
pub async fn ai_set_config(
    window: WebviewWindow,
    service: Ai<'_>,
    settings: Value,
    expected_revision: u64,
) -> Result<Value, String> {
    main_window(&window)?;
    Ok(service.set_config_json(settings, expected_revision).await)
}
#[tauri::command]
pub async fn ai_reveal_token(window: WebviewWindow, service: Ai<'_>) -> Result<String, String> {
    main_window(&window)?;
    service.reveal_token().await
}
#[tauri::command]
pub async fn ai_regenerate_token(
    window: WebviewWindow,
    service: Ai<'_>,
    expected_revision: u64,
) -> Result<SettingsSnapshot, String> {
    main_window(&window)?;
    service.regenerate_token(expected_revision).await
}
#[tauri::command]
pub fn agent_ready(window: WebviewWindow, service: Ai<'_>, epoch: String) -> Result<(), String> {
    main_window(&window)?;
    service.transport().ready(epoch)
}
#[tauri::command]
pub fn agent_reply(window: WebviewWindow, service: Ai<'_>, reply: Value) -> Result<(), String> {
    main_window(&window)?;
    service.transport().reply(reply)
}
#[tauri::command]
pub fn agent_publish_status(
    window: WebviewWindow,
    service: Ai<'_>,
    status: Value,
) -> Result<(), String> {
    main_window(&window)?;
    service.transport().publish_status(status)
}
