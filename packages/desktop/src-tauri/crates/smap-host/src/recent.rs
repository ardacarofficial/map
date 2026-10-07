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
use std::time::Duration;

use serde::{Deserialize, Serialize};

pub const MAX_RECENTS: usize = 10;

/// `recent.json` geçici olarak okunamazsa (antivirüs/yedekleme kilidi)
/// denemeler arasındaki beklemeler. Hepsi başarısızsa dosyaya dokunulmaz.
pub const READ_RETRY_DELAYS: [Duration; 3] =
    [Duration::from_millis(50), Duration::from_millis(100), Duration::from_millis(200)];

type ReadFn = Box<dyn Fn(&Path) -> io::Result<Vec<u8>> + Send + Sync>;
type SleepFn = Box<dyn Fn(Duration) + Send + Sync>;
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
    read: ReadFn,
    sleep: SleepFn,
}

impl RecentStore {
    pub fn new(file: PathBuf) -> Self {
        Self::with_io(file, Box::new(|p| std::fs::read(p)), Box::new(std::thread::sleep))
    }

    /// Test edilebilir kurucu: okuma ve bekleme dışarıdan verilir.
    pub fn with_io(file: PathBuf, read: ReadFn, sleep: SleepFn) -> Self {
        Self { file, edit: Mutex::new(()), read, sleep }
    }

    /// En yeni önce. Bozuk, eksik ya da okunamayan dosya boş liste demektir
    /// (yalnız gösterim için; değiştirmeden önce `load_for_edit` kullanılır).
    pub fn load(&self) -> Vec<RecentEntry> {
        self.load_for_edit().unwrap_or_else(|e| {
            log::warn!("cannot read {}: {e}", self.file.display());
            Vec::new()
        })
    }

    /// Değiştirmeden önceki okuma. Dosya yoksa ya da bozuksa (JSON değil,
    /// UTF-8 değil) boş liste: üstüne yazmak doğru. Okuma başka bir nedenle
    /// başarısızsa (kilit, izin) bekleyip tekrar dener; yine olmazsa hata
    /// döner ve çağıran dosyaya yazmaz — yoksa tek girdilik listeyle bütün
    /// geçmişi silerdik.
    fn load_for_edit(&self) -> io::Result<Vec<RecentEntry>> {
        let mut attempt = 0;
        let bytes = loop {
            match (self.read)(&self.file) {
                Ok(bytes) => break bytes,
                Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
                Err(e) if attempt < READ_RETRY_DELAYS.len() => {
                    log::warn!("reading {} failed ({e}); retry {}", self.file.display(), attempt + 1);
                    (self.sleep)(READ_RETRY_DELAYS[attempt]);
                    attempt += 1;
                }
                Err(e) => return Err(e),
            }
        };
        let parsed = std::str::from_utf8(&bytes)
            .map_err(|e| e.to_string())
            .and_then(|text| serde_json::from_str::<RecentFile>(text).map_err(|e| e.to_string()));
        match parsed {
            Ok(f) => Ok(f.projects),
            Err(e) => {
                log::warn!("ignoring unreadable {}: {e}", self.file.display());
                Ok(Vec::new())
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
        let mut list = self.load_for_edit()?;
        list.retain(|e| !same_path(&e.path, path));
        list.insert(0, RecentEntry { path: path.to_owned(), name: name.to_owned(), opened_at: now_ms });
        list.truncate(MAX_RECENTS);
        self.save(&list)?;
        Ok(list)
    }

    pub fn remove(&self, path: &str) -> io::Result<Vec<RecentEntry>> {
        let _edit = self.edit.lock().unwrap_or_else(|e| e.into_inner());
        let mut list = self.load_for_edit()?;
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

    /// A store whose reads fail with a sharing violation `fails` times, then hit the disk.
    fn flaky_store(file: PathBuf, fails: usize) -> (RecentStore, std::sync::Arc<std::sync::Mutex<Vec<Duration>>>) {
        let left = std::sync::atomic::AtomicUsize::new(fails);
        let slept = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let log = slept.clone();
        let store = RecentStore::with_io(
            file,
            Box::new(move |p| {
                if left.load(std::sync::atomic::Ordering::SeqCst) > 0 {
                    left.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
                    return Err(io::Error::new(io::ErrorKind::PermissionDenied, "locked by antivirus"));
                }
                std::fs::read(p)
            }),
            Box::new(move |d| log.lock().unwrap().push(d)),
        );
        (store, slept)
    }

    #[test]
    fn locked_file_is_retried_then_left_alone() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("recent.json");
        let disk = RecentStore::new(file.clone());
        disk.add("/a/project.smap", "A", 1).unwrap();
        disk.add("/b/project.smap", "B", 2).unwrap();
        let before = std::fs::read(&file).unwrap();

        // Locked for a moment: retried, nothing lost.
        let (store, slept) = flaky_store(file.clone(), 2);
        assert_eq!(store.add("/c/project.smap", "C", 3).unwrap().len(), 3);
        assert_eq!(*slept.lock().unwrap(), READ_RETRY_DELAYS[..2].to_vec());

        // Locked for good: error, file untouched.
        std::fs::write(&file, &before).unwrap();
        let (store, slept) = flaky_store(file.clone(), usize::MAX);
        assert_eq!(store.add("/d/project.smap", "D", 4).unwrap_err().kind(), io::ErrorKind::PermissionDenied);
        assert_eq!(store.remove("/a/project.smap").unwrap_err().kind(), io::ErrorKind::PermissionDenied);
        assert_eq!(slept.lock().unwrap().len(), 2 * READ_RETRY_DELAYS.len());
        assert_eq!(std::fs::read(&file).unwrap(), before);
        assert!(store.load().is_empty(), "display falls back to an empty list");
    }

    #[test]
    fn corrupt_file_is_replaced() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("recent.json");
        std::fs::write(&file, b"\xff\xfe not json").unwrap();
        let store = RecentStore::new(file);
        assert_eq!(store.add("/a/project.smap", "A", 1).unwrap().len(), 1);
        assert_eq!(store.load().len(), 1);
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
