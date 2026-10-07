//! Kullanıcı ayar dosyası: uygulama ayar klasöründe `settings.json`
//! (`{ "locale": "tr", "shortcuts": { "tool.brush": ["B"] } }`).
//!
//! Rust içeriği yorumlamaz; doğrulama ve varsayılanlarla birleştirme
//! editördedir (`packages/editor/src/platform/settings.ts`). Burada yalnızca
//! okuma ve güvenli kayıt var. Dosya yoksa `None` döner; editör ilk açılışta
//! tüm komutların mevcut tuşlarıyla bir varsayılan dosya yazar (JSON'da yorum
//! olmadığı için "örnekli" dosya budur).

use std::io;
use std::path::{Path, PathBuf};

use crate::atomic;

/// Bundan büyük ayar dosyası okunmaz (yanlış dosya seçilmesine karşı).
pub const MAX_SETTINGS_BYTES: u64 = 1024 * 1024;

pub struct SettingsFile {
    path: PathBuf,
}

impl SettingsFile {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Dosyanın metni; yoksa `None`.
    pub fn read(&self) -> io::Result<Option<String>> {
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
