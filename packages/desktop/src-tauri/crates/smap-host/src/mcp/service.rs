use super::{BridgeSink, Options, RunningServer, SecretFile, Transport};
use crate::settings::SettingsFile;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{io, sync::Arc};
use tokio::sync::Mutex;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AgentSettings {
    pub enabled: bool,
    pub port: u16,
}
impl Default for AgentSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            port: 48765,
        }
    }
}
#[derive(Clone, Deserialize, Serialize)]
pub struct SettingsSnapshot {
    pub revision: u64,
    pub settings: AgentSettings,
}
struct Config {
    snapshot: SettingsSnapshot,
    running: Option<RunningServer>,
    state: String,
    detail: Option<String>,
}
pub struct Service {
    settings: SettingsFile,
    secret: SecretFile,
    transport: Arc<Transport>,
    config: Mutex<Config>,
}
impl Service {
    pub fn new(settings: SettingsFile, secret: SecretFile, sink: BridgeSink) -> io::Result<Self> {
        let (config, state, detail) = match settings.read_ai() {
            Ok(config) if config.port >= 1024 => (config, "disabled", None),
            _ => (
                AgentSettings::default(),
                "failed",
                Some("Invalid AI settings".to_owned()),
            ),
        };
        Ok(Self {
            settings,
            secret,
            transport: Transport::new(String::new(), sink, Options::default()),
            config: Mutex::new(Config {
                snapshot: SettingsSnapshot {
                    revision: 0,
                    settings: config,
                },
                running: None,
                state: state.into(),
                detail,
            }),
        })
    }
    pub fn transport(&self) -> &Arc<Transport> {
        &self.transport
    }
    pub async fn start(&self) {
        let mut config = self.config.lock().await;
        if !config.snapshot.settings.enabled || config.running.is_some() {
            return;
        }
        let result = match self.secret.load_or_create() {
            Ok(token) => {
                self.transport.rotate_token(token);
                self.transport.bind(config.snapshot.settings.port).await
            }
            Err(e) => Err(e),
        };
        match result {
            Ok(server) => {
                config.running = Some(server);
                config.state = "listening".into();
            }
            Err(e) => {
                config.state = if e.kind() == io::ErrorKind::AddrInUse {
                    "portInUse"
                } else {
                    "failed"
                }
                .into();
                config.detail = Some("AI endpoint could not start".into());
            }
        }
        self.transport.push_status(
            &config.state,
            config.snapshot.settings.port,
            config.detail.as_deref(),
        );
    }
    fn status_locked(&self, config: &Config) -> Value {
        let clients = self.transport.clients();
        let state = if config.state == "listening" && !clients.is_empty() {
            "connected"
        } else {
            &config.state
        };
        let mut status =
            json!({"state":state,"port":config.snapshot.settings.port,"clients":clients});
        if let Some(detail) = &config.detail {
            status["detail"] = json!(detail);
        }
        status
    }
    pub async fn get_status(&self) -> Value {
        let config = self.config.lock().await;
        json!({"snapshot":config.snapshot,"status":self.status_locked(&config)})
    }
    pub async fn set_config_json(&self, settings: Value, expected_revision: u64) -> Value {
        match serde_json::from_value::<AgentSettings>(settings) {
            Ok(settings) => self.set_config(settings, expected_revision).await,
            Err(_) => {
                let config = self.config.lock().await;
                json!({"ok":false,"code":"INVALID_ARGUMENT","snapshot":config.snapshot,"status":self.status_locked(&config)})
            }
        }
    }
    pub async fn set_config(&self, settings: AgentSettings, expected_revision: u64) -> Value {
        let mut config = self.config.lock().await;
        let failure = |code: &str, config: &Config| json!({"ok":false,"code":code,"snapshot":config.snapshot,"status":self.status_locked(config)});
        if expected_revision != config.snapshot.revision {
            return failure("CONFLICT", &config);
        }
        if settings.port < 1024 {
            return failure("INVALID_ARGUMENT", &config);
        }
        let endpoint_changed = settings != config.snapshot.settings;
        let needs_bind = settings.enabled
            && (config.running.is_none() || settings.port != config.snapshot.settings.port);
        let mut candidate = None;
        if needs_bind {
            let token = match self.secret.load_or_create() {
                Ok(token) => token,
                Err(_) => return failure("IO", &config),
            };
            // A candidate socket is bound first; old sessions remain live if bind/persistence fails.
            let listener =
                match tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, settings.port))
                    .await
                {
                    Ok(listener) => listener,
                    Err(e) => {
                        let code = if e.kind() == io::ErrorKind::AddrInUse {
                            "PORT_IN_USE"
                        } else {
                            "IO"
                        };
                        let state = if code == "PORT_IN_USE" {
                            "portInUse"
                        } else {
                            "failed"
                        };
                        self.transport.push_status(
                            state,
                            settings.port,
                            Some("AI endpoint could not bind"),
                        );
                        return failure(code, &config);
                    }
                };
            candidate = Some((listener, token));
        }
        if endpoint_changed || needs_bind {
            self.transport.end_sessions("disabled");
            if self.transport.wait_for_ends().await.is_err() {
                return failure("IO", &config);
            }
        }
        if self.settings.write_ai(&settings).is_err() {
            return failure("IO", &config);
        }
        if endpoint_changed || needs_bind {
            self.transport.end_all("disabled");
            if let Some(server) = config.running.take() {
                server.stop().await;
            }
        }
        if let Some((listener, token)) = candidate {
            self.transport.rotate_token(token);
            // Reuse the reserved socket; never release it between validation and startup.
            config.running = Some(self.transport.serve_listener(listener));
        }
        config.snapshot = SettingsSnapshot {
            revision: config.snapshot.revision + 1,
            settings,
        };
        config.state = if config.running.is_some() {
            "listening"
        } else {
            "disabled"
        }
        .into();
        config.detail = None;
        self.transport
            .push_status(&config.state, config.snapshot.settings.port, None);
        json!({"ok":true,"snapshot":config.snapshot,"status":self.status_locked(&config)})
    }
    pub async fn reveal_token(&self) -> Result<String, String> {
        let _guard = self.config.lock().await;
        self.secret
            .load_or_create()
            .map_err(|_| "AI secret unavailable; regenerate it".into())
    }
    pub async fn regenerate_token(
        &self,
        expected_revision: u64,
    ) -> Result<SettingsSnapshot, String> {
        let mut config = self.config.lock().await;
        if expected_revision != config.snapshot.revision {
            return Err("CONFLICT".into());
        }
        self.transport.end_sessions("tokenRegenerated");
        self.transport
            .wait_for_ends()
            .await
            .map_err(|_| "Editor cancellation timed out".to_string())?;
        let token = self
            .secret
            .regenerate()
            .map_err(|_| "AI secret could not be written".to_string())?;
        self.transport.rotate_token(token);
        if config.snapshot.settings.enabled && config.running.is_none() {
            match self.transport.bind(config.snapshot.settings.port).await {
                Ok(server) => {
                    config.running = Some(server);
                    config.state = "listening".into();
                    config.detail = None;
                }
                Err(e) => {
                    config.state = if e.kind() == io::ErrorKind::AddrInUse {
                        "portInUse"
                    } else {
                        "failed"
                    }
                    .into();
                    config.detail = Some("AI endpoint could not start".into());
                }
            }
        }
        config.snapshot.revision += 1;
        self.transport.push_status(
            &config.state,
            config.snapshot.settings.port,
            config.detail.as_deref(),
        );
        Ok(config.snapshot.clone())
    }
    pub fn shutdown(&self) {
        self.transport.end_all("shutdown");
        if let Ok(mut config) = self.config.try_lock() {
            config.running.take();
        }
    }
}
