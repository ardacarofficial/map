//! Son projeler: uygulama ayar klasöründe `recent.json`.
//!
//! Tarayıcıdaki gibi "klasör tutamacı izni" yok: masaüstünde yol yeterli.
//! Tauri'nin fs eklentisinin kapsamı yeniden başlatınca kaybolur (CLAUDE.md
//! › Bilinen tuzaklar); biz o eklentiyi kullanmıyoruz. Bu listede duran bir
//! yol, kullanıcının daha önce açtığı bir projedir ve tekrar açılmasına izin
//! verilir — kalıcı izin budur. Açarken yolun hâlâ var olduğu doğrulanır.
//!
//! Dosya her yazımda aynı bayttır: sabit alan sırası, iki boşluk girinti,
//! `\n` satır sonu.

use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

pub const MAX_RECENTS: usize = 10;
const FORMAT_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentEntry {
    /// `project.smap` dosyasının mutlak yolu.
    pub path: String,
    /// Proje adı (son açılış/kayıttaki).
    pub name: String,
    /// Unix zamanı, milisaniye.
    pub opened_at: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecentFile {
    version: u32,
    projects: Vec<RecentEntry>,
}

/// Arayüze dönen satır: girdi + şu an diskte var mı.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentView {
    #[serde(flatten)]
    pub entry: RecentEntry,
    pub exists: bool,
}

pub struct RecentStore {
    file: PathBuf,
    /// Oku → değiştir → yaz adımlarını sıraya koyar: komutlar eşzamanlı
    /// çalışır (async), aynı anda iki ekleme birbirinin girdisini silmesin.
    edit: Mutex<()>,
}

impl RecentStore {
    pub fn new(file: PathBuf) -> Self {
        Self { file, edit: Mutex::new(()) }
    }

    /// En yeni önce. Bozuk ya da eksik dosya boş liste demektir.
    pub fn load(&self) -> Vec<RecentEntry> {
        let Ok(text) = std::fs::read_to_string(&self.file) else { return Vec::new() };
        match serde_json::from_str::<RecentFile>(&text) {
            Ok(f) => f.projects,
            Err(e) => {
                log::warn!("ignoring unreadable {}: {e}", self.file.display());
                Vec::new()
            }
        }
    }

    pub fn list(&self) -> Vec<RecentView> {
        self.load()
            .into_iter()
            .map(|entry| {
                let exists = Path::new(&entry.path).is_file();
                RecentView { entry, exists }
            })
            .collect()
    }

    pub fn contains(&self, path: &str) -> bool {
        self.load().iter().any(|e| same_path(&e.path, path))
    }

    pub fn add(&self, path: &str, name: &str, now_ms: u64) -> io::Result<Vec<RecentEntry>> {
        let _edit = self.edit.lock().unwrap_or_else(|e| e.into_inner());
        let mut list = self.load();
        list.retain(|e| !same_path(&e.path, path));
        list.insert(0, RecentEntry { path: path.to_owned(), name: name.to_owned(), opened_at: now_ms });
        list.truncate(MAX_RECENTS);
        self.save(&list)?;
        Ok(list)
    }

    pub fn remove(&self, path: &str) -> io::Result<Vec<RecentEntry>> {
        let _edit = self.edit.lock().unwrap_or_else(|e| e.into_inner());
        let mut list = self.load();
        list.retain(|e| !same_path(&e.path, path));
        self.save(&list)?;
        Ok(list)
    }

    fn save(&self, list: &[RecentEntry]) -> io::Result<()> {
        if let Some(dir) = self.file.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let body = RecentFile { version: FORMAT_VERSION, projects: list.to_vec() };
        let mut text = serde_json::to_string_pretty(&body).map_err(io::Error::other)?;
        text.push('\n');
        // Bağlıysa (ayarlar bir dotfile deposundan bağlanmış) bağı koru.
        crate::atomic::write_file_atomic(&crate::atomic::follow_symlink(&self.file), text.as_bytes())
    }
}

/// Windows'ta yollar büyük/küçük harf duyarsız ve iki ayırıcı kabul eder.
fn same_path(a: &str, b: &str) -> bool {
    if cfg!(windows) {
        let n = |s: &str| s.replace('/', "\\").to_lowercase();
        n(a) == n(b)
    } else {
        a == b
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_dedupes_orders_and_caps() {
        let tmp = tempfile::tempdir().unwrap();
        let store = RecentStore::new(tmp.path().join("cfg/recent.json"));
        assert!(store.load().is_empty());
        for i in 0..12u64 {
            store.add(&format!("/p{i}/project.smap"), &format!("P{i}"), i).unwrap();
        }
        store.add("/p5/project.smap", "Beş", 100).unwrap();
        let list = store.load();
        assert_eq!(list.len(), MAX_RECENTS);
        assert_eq!(list[0], RecentEntry { path: "/p5/project.smap".into(), name: "Beş".into(), opened_at: 100 });
        assert_eq!(list[1].path, "/p11/project.smap");
        assert_eq!(list.iter().filter(|e| e.path == "/p5/project.smap").count(), 1);
        assert!(store.contains("/p5/project.smap"));
        store.remove("/p5/project.smap").unwrap();
        assert!(!store.contains("/p5/project.smap"));
    }

    #[test]
    fn file_format_is_deterministic() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("recent.json");
        let store = RecentStore::new(file.clone());
        store.add("/a/project.smap", "Dünyam", 1).unwrap();
        let text = std::fs::read_to_string(&file).unwrap();
        assert_eq!(
            text,
            "{\n  \"version\": 1,\n  \"projects\": [\n    {\n      \"path\": \"/a/project.smap\",\n      \"name\": \"Dünyam\",\n      \"openedAt\": 1\n    }\n  ]\n}\n"
        );
    }

    #[test]
    fn concurrent_adds_are_not_lost() {
        let tmp = tempfile::tempdir().unwrap();
        let store = std::sync::Arc::new(RecentStore::new(tmp.path().join("recent.json")));
        let threads: Vec<_> = (0..8u64)
            .map(|i| {
                let store = store.clone();
                std::thread::spawn(move || store.add(&format!("/p{i}/project.smap"), "P", i).unwrap())
            })
            .collect();
        for t in threads {
            t.join().unwrap();
        }
        assert_eq!(store.load().len(), 8);
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_file_stays_a_symlink() {
        let tmp = tempfile::tempdir().unwrap();
        let real = tmp.path().join("dotfiles/recent.json");
        std::fs::create_dir_all(real.parent().unwrap()).unwrap();
        std::fs::write(&real, b"{\"version\":1,\"projects\":[]}").unwrap();
        let link = tmp.path().join("recent.json");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let store = RecentStore::new(link.clone());
        store.add("/a/project.smap", "A", 1).unwrap();
        assert!(std::fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(RecentStore::new(real).load().len(), 1);
    }

    #[test]
    fn list_reverifies_existence_and_survives_garbage() {
        let tmp = tempfile::tempdir().unwrap();
        let real = tmp.path().join("project.smap");
        std::fs::write(&real, b"{}").unwrap();
        let store = RecentStore::new(tmp.path().join("recent.json"));
        store.add("/definitely/missing/project.smap", "Gone", 1).unwrap();
        store.add(&real.to_string_lossy(), "Here", 2).unwrap();
        let views = store.list();
        assert!(views[0].exists);
        assert!(!views[1].exists);
        std::fs::write(tmp.path().join("recent.json"), b"not json").unwrap();
        assert!(store.load().is_empty());
    }
}
