//! Each editor window owns its endpoint, renderer bridge, sessions and secret.
//! The caller's native window label selects the service; renderer payloads
//! cannot select another world's service.
use super::{AgentSettings, BridgeSink, SecretFile, Service};
use crate::settings::SettingsFile;
use std::{
    collections::HashMap,
    io,
    path::PathBuf,
    sync::{Arc, Mutex},
};

pub struct WindowServices {
    config_dir: PathBuf,
    main_settings: SettingsFile,
    services: Mutex<HashMap<String, Arc<Service>>>,
}

impl WindowServices {
    pub fn new(config_dir: PathBuf, main_settings: SettingsFile) -> Self {
        Self {
            config_dir,
            main_settings,
            services: Mutex::new(HashMap::new()),
        }
    }

    pub fn register(&self, label: &str, sink: BridgeSink) -> io::Result<Arc<Service>> {
        let mut services = self.services.lock().unwrap();
        if services.contains_key(label) {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "window already registered",
            ));
        }
        let (settings, secret, defaults) = if label == "main" {
            (
                self.main_settings.clone(),
                self.config_dir.join("ai-secret.json"),
                AgentSettings::default(),
            )
        } else {
            let number = label
                .strip_prefix("world-")
                .and_then(|s| s.parse::<u16>().ok())
                .filter(|&number| number > 0 && label == format!("world-{number}"))
                .ok_or_else(|| {
                    io::Error::new(io::ErrorKind::InvalidInput, "invalid world window label")
                })?;
            let directory = self.config_dir.join("windows").join(label);
            (
                SettingsFile::new(directory.join("ai-settings.json")),
                directory.join("ai-secret.json"),
                AgentSettings {
                    enabled: false,
                    port: 48765u16.saturating_add(number),
                },
            )
        };
        let service = Arc::new(Service::with_defaults(
            settings,
            SecretFile::new(secret),
            sink,
            defaults,
        )?);
        services.insert(label.to_owned(), service.clone());
        Ok(service)
    }

    pub fn get(&self, label: &str) -> Option<Arc<Service>> {
        self.services.lock().unwrap().get(label).cloned()
    }

    pub fn remove(&self, label: &str) -> Option<Arc<Service>> {
        let service = self.services.lock().unwrap().remove(label)?;
        service.shutdown();
        Some(service)
    }

    pub fn shutdown_all(&self) -> Vec<Arc<Service>> {
        let services: Vec<_> = self
            .services
            .lock()
            .unwrap()
            .drain()
            .map(|(_, service)| service)
            .collect();
        for service in &services {
            service.shutdown();
        }
        services
    }
}
