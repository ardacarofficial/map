//! Loopback-only JSON Streamable HTTP MCP transport. Map semantics stay in the renderer.
mod secret;
mod service;
mod transport;
mod windows;
pub use secret::SecretFile;
pub use service::{AgentSettings, Service, SettingsSnapshot};
pub use windows::WindowServices;
pub use transport::{
    BridgeSink, Options, RunningServer, Transport, EVENT_CONTROL, EVENT_REQUEST, EVENT_STATUS,
};
#[cfg(test)]
mod tests;
