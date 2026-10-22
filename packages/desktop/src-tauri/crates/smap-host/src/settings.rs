//! Kullanıcı ayar dosyası: uygulama ayar klasöründe `settings.json`
//! (`{ "locale": "tr", "shortcuts": { "tool.brush": ["B"] } }`).
//!
//! Genel ayarları editör doğrular. AI uç noktası Rust tarafından CAS ile
//! yönetilir; tüm yazıcılar aynı kilidi kullanır ve eski genel ayar taslakları
//! AI bölümünü değiştiremez. Dosya yoksa `None` döner; editör ilk açılışta
//! tüm komutların mevcut tuşlarıyla bir varsayılan dosya yazar (JSON'da yorum
//! olmadığı için "örnekli" dosya budur).

use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::atomic;

/// Bundan büyük ayar dosyası okunmaz (yanlış dosya seçilmesine karşı).
pub const MAX_SETTINGS_BYTES: u64 = 1024 * 1024;

#[derive(Clone)]
pub struct SettingsFile {
    path: PathBuf,
    lock: Arc<Mutex<()>>,
}

impl SettingsFile {
    pub fn new(path: PathBuf) -> Self {
        Self { path, lock: Arc::new(Mutex::new(())) }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Dosyanın metni; yoksa `None`.
    pub fn read(&self) -> io::Result<Option<String>> {
        let _guard = self.lock.lock().unwrap();
        self.read_unlocked()
    }

    fn read_unlocked(&self) -> io::Result<Option<String>> {
        match std::fs::metadata(&self.path) {
            Ok(m) if m.len() > MAX_SETTINGS_BYTES => {
                return Err(io::Error::new(io::ErrorKind::InvalidData, "settings file is too large"))
            }
            Ok(_) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e),
        }
        let bytes = std::fs::read(&self.path)?;
        let text = String::from_utf8(bytes).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        // Not Defteri UTF-8 BOM ekleyebilir; JSON.parse onu kabul etmez.
        Ok(Some(text.strip_prefix('\u{feff}').map(str::to_owned).unwrap_or(text)))
    }

    /// Güvenli kayıt (geçici dosya → fsync → yeniden adlandırma). Klasör yoksa oluşturur.
    pub fn write(&self, text: &str) -> io::Result<()> {
        if text.len() as u64 > MAX_SETTINGS_BYTES { return Err(io::Error::new(io::ErrorKind::InvalidData, "settings file is too large")); }
        let _guard = self.lock.lock().unwrap();
        // AI configuration has its own CAS command. A stale general settings
        // draft must never restore its old endpoint or enable the service.
        let mut incoming: serde_json::Value = serde_json::from_str(text)?;
        let object = incoming.as_object_mut().ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "expected settings object"))?;
        let existing: serde_json::Value = serde_json::from_str(&self.read_unlocked()?.unwrap_or_else(|| "{}".into()))?;
        let old_ai = object.remove("ai");
        let ai = existing.get("ai").cloned();
        if let Some(ai) = &ai { object.insert("ai".into(), ai.clone()); }
        if old_ai == ai { self.write_unlocked(text) } else { self.write_unlocked(&(serde_json::to_string_pretty(&incoming)? + "\n")) }
    }

    pub fn read_ai(&self) -> io::Result<crate::mcp::AgentSettings> {
        self.read_ai_or(crate::mcp::AgentSettings::default())
    }

    pub fn read_ai_or(&self, defaults: crate::mcp::AgentSettings) -> io::Result<crate::mcp::AgentSettings> {
        let _guard = self.lock.lock().unwrap();
        let value: serde_json::Value = serde_json::from_str(&self.read_unlocked()?.unwrap_or_else(|| "{}".into()))?;
        if !value.is_object() {return Err(io::Error::new(io::ErrorKind::InvalidData,"expected settings object"));}
        match value.get("ai") { Some(ai) => serde_json::from_value(ai.clone()).map_err(Into::into), None => Ok(defaults) }
    }

    pub fn write_ai(&self, settings: &crate::mcp::AgentSettings) -> io::Result<()> {
        let _guard = self.lock.lock().unwrap();
        let mut value: serde_json::Value = serde_json::from_str(&self.read_unlocked()?.unwrap_or_else(|| "{}".into()))?;
        value.as_object_mut().ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "expected settings object"))?.insert("ai".into(), serde_json::to_value(settings)?);
        self.write_unlocked(&(serde_json::to_string_pretty(&value)? + "\n"))
    }

    fn write_unlocked(&self, text: &str) -> io::Result<()> {
        if text.len() as u64 > MAX_SETTINGS_BYTES {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "settings file is too large"));
        }
        // A settings.json linked from a dotfiles repo stays a link: write the target.
        let target = atomic::follow_symlink(&self.path);
        if let Some(dir) = target.parent() {
            std::fs::create_dir_all(dir)?;
        }
        atomic::write_file_atomic(&target, text.as_bytes())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_reads_as_none_and_write_creates_folders() {
        let dir = tempfile::tempdir().unwrap();
        let file = SettingsFile::new(dir.path().join("cfg").join("settings.json"));
        assert_eq!(file.read().unwrap(), None);
        file.write("{\n  \"locale\": \"en\"\n}\n").unwrap();
        assert_eq!(file.read().unwrap().as_deref(), Some("{\n  \"locale\": \"en\"\n}\n"));
        file.write("{}").unwrap();
        assert_eq!(file.read().unwrap().as_deref(), Some("{}"));
    }

    #[test]
    fn bom_is_stripped() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, "\u{feff}{\"locale\":\"tr\"}").unwrap();
        assert_eq!(SettingsFile::new(path).read().unwrap().as_deref(), Some("{\"locale\":\"tr\"}"));
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_file_stays_a_link() {
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("dotfiles").join("settings.json");
        std::fs::create_dir_all(real.parent().unwrap()).unwrap();
        std::fs::write(&real, "{}").unwrap();
        let link = dir.path().join("settings.json");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let file = SettingsFile::new(link.clone());
        file.write("{\"locale\":\"en\"}").unwrap();
        assert!(std::fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(std::fs::read_to_string(&real).unwrap(), "{\"locale\":\"en\"}");
        assert_eq!(file.read().unwrap().as_deref(), Some("{\"locale\":\"en\"}"));
    }

    #[test]
    fn oversized_text_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let file = SettingsFile::new(dir.path().join("settings.json"));
        let big = "x".repeat(MAX_SETTINGS_BYTES as usize + 1);
        assert!(file.write(&big).is_err());
        std::fs::write(file.path(), &big).unwrap();
        assert!(file.read().is_err());
    }
}
