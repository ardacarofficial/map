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
