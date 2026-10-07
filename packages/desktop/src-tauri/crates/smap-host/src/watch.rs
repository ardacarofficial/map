//! Proje klasörü izleyici. İşletim sisteminin olayları yalnız ipucudur
//! (aynı kayıt için birden çok olay gelir — CLAUDE.md › Bilinen tuzaklar):
//! beklet (debounce), içeriğin özetini programın kendi yazdığı/okuduğu son
//! özetle karşılaştır, kendi yazdığını yok say, yalnız gerçek dış
//! değişikliği bildir.

use std::collections::hash_map::DefaultHasher;
use std::collections::{BTreeSet, HashMap};
use std::hash::Hasher;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify_debouncer_mini::notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use serde::Serialize;

pub const DEBOUNCE: Duration = Duration::from_millis(250);

/// İçerik özeti. Yalnız bu süreç içinde karşılaştırılır; kalıcı değildir.
pub fn content_hash(bytes: &[u8]) -> u64 {
    let mut h = DefaultHasher::new();
    h.write(bytes);
    h.write_usize(bytes.len());
    h.finish()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeKind {
    Created,
    Modified,
    Removed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FileChange {
    pub path: String,
    pub kind: ChangeKind,
}

/// Yol → programın bildiği son durum (`None` = programın bildiği kadarıyla yok).
#[derive(Debug, Default)]
pub struct KnownHashes {
    map: HashMap<PathBuf, Option<u64>>,
}

impl KnownHashes {
    pub fn new() -> Self {
        Self::default()
    }

    /// Program bu içeriği yazdı ya da okudu.
    pub fn record(&mut self, path: &Path, bytes: &[u8]) {
        self.map.insert(path.to_path_buf(), Some(content_hash(bytes)));
    }

    /// Program bu dosyayı sildi ya da yok olduğunu gördü.
    pub fn record_absent(&mut self, path: &Path) {
        self.map.insert(path.to_path_buf(), None);
    }

    /// Bilinen durum: `None` = hiç görülmedi, `Some(None)` = yok biliniyor.
    pub fn get(&self, path: &Path) -> Option<Option<u64>> {
        self.map.get(path).copied()
    }

    /// `get` ile alınmış durumu geri koyar (başarısız kayıttan sonra).
    pub fn restore(&mut self, path: &Path, state: Option<Option<u64>>) {
        match state {
            Some(s) => {
                self.map.insert(path.to_path_buf(), s);
            }
            None => {
                self.map.remove(path);
            }
        }
    }

    pub fn clear(&mut self) {
        self.map.clear();
    }

    /// Diskteki güncel durumu bilinenle karşılaştırır. Fark varsa bilineni
    /// günceller ve değişikliğin türünü döner; aynıysa (kendi yazdığımız ya
    /// da tekrarlanan olay) `None`.
    pub fn classify(&mut self, path: &Path, current: Option<&[u8]>) -> Option<ChangeKind> {
        let now = current.map(content_hash);
        let before = self.map.get(path).copied();
        let kind = match (before, now) {
            (Some(b), n) if b == n => return None,
            (None, None) => return None, // never seen, still not there
            (_, None) => ChangeKind::Removed,
            (Some(None), Some(_)) => ChangeKind::Created,
            (_, Some(_)) => ChangeKind::Modified,
        };
        self.map.insert(path.to_path_buf(), now);
        Some(kind)
    }
}

/// İzlenen dosyalar: `project.smap`, `levels/*.json`, `tilesets/*.png`
/// (`root`'a göre). Geçici kayıt dosyaları, yedekler ve gerisi elenir.
pub fn is_watched(root: &Path, path: &Path) -> bool {
    let Ok(rel) = path.strip_prefix(root) else { return false };
    let parts: Vec<String> = rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
    let ext_is = |name: &str, ext: &str| {
        !name.starts_with('.')
            && Path::new(name).extension().is_some_and(|e| e.eq_ignore_ascii_case(ext))
    };
    match parts.as_slice() {
        [file] => file.eq_ignore_ascii_case("project.smap"),
        [dir, file] if dir == "levels" => ext_is(file, "json"),
        [dir, file] if dir == "tilesets" => ext_is(file, "png"),
        _ => false,
    }
}

/// Bir debounce grubundaki ham yolları süzer, tekilleştirir ve sınıflar.
pub fn process_batch(
    root: &Path,
    paths: impl IntoIterator<Item = PathBuf>,
    known: &Mutex<KnownHashes>,
    read: impl Fn(&Path) -> Option<Vec<u8>>,
) -> Vec<FileChange> {
    let unique: BTreeSet<PathBuf> = paths.into_iter().filter(|p| is_watched(root, p)).collect();
    let mut out = Vec::new();
    for path in unique {
        // Okuma ve karşılaştırma kilit altında: programın kendi kaydı
        // (özeti kaydet → yeniden adlandır, aynı kilit altında) ikisinin
        // arasına giremez. Girseydi eski diski yeni özetle karşılaştırıp
        // bilineni eski içeriğe çevirir, ardından gelen kendi kaydımızı
        // "dış değişiklik" sanırdık.
        let kind = {
            let mut known = known.lock().unwrap();
            let bytes = read(&path);
            known.classify(&path, bytes.as_deref())
        };
        if let Some(kind) = kind {
            out.push(FileChange { path: path.to_string_lossy().into_owned(), kind });
        }
    }
    out
}

/// Çalışan izleyici; düşürülünce durur.
pub struct ProjectWatcher {
    _debouncer: Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>,
    root: PathBuf,
}

impl ProjectWatcher {
    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn start(
        root: PathBuf,
        known: Arc<Mutex<KnownHashes>>,
        on_change: impl Fn(FileChange) + Send + 'static,
    ) -> notify_debouncer_mini::notify::Result<Self> {
        let batch_root = root.clone();
        let mut debouncer = new_debouncer(DEBOUNCE, move |result: DebounceEventResult| match result {
            Ok(events) => {
                let changes = process_batch(
                    &batch_root,
                    events.into_iter().map(|e| e.path),
                    &known,
                    |p| std::fs::read(p).ok(),
                );
                for change in changes {
                    log::info!("external change: {:?} {}", change.kind, change.path);
                    on_change(change);
                }
            }
            Err(error) => log::warn!("watcher error: {error}"),
        })?;
        debouncer.watcher().watch(&root, RecursiveMode::Recursive)?;
        log::info!("watching {}", root.display());
        Ok(Self { _debouncer: debouncer, root })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn own_writes_and_duplicate_events_are_ignored() {
        let mut known = KnownHashes::new();
        let p = Path::new("/p/levels/main.json");
        known.record(p, b"saved by us");
        assert_eq!(known.classify(p, Some(b"saved by us")), None);
        assert_eq!(known.classify(p, Some(b"saved by us")), None);
        assert_eq!(known.classify(p, Some(b"edited outside")), Some(ChangeKind::Modified));
        // Second event for the same external save: already known now.
        assert_eq!(known.classify(p, Some(b"edited outside")), None);
    }

    #[test]
    fn created_removed_and_unknown_files() {
        let mut known = KnownHashes::new();
        let p = Path::new("/p/tilesets/grass.png");
        // Never seen: a new file shows up as modified (we cannot tell).
        assert_eq!(known.classify(p, Some(b"png")), Some(ChangeKind::Modified));
        assert_eq!(known.classify(p, None), Some(ChangeKind::Removed));
        assert_eq!(known.classify(p, None), None);
        assert_eq!(known.classify(p, Some(b"png2")), Some(ChangeKind::Created));
        // Never seen and not there (created + deleted within one debounce).
        assert_eq!(known.classify(Path::new("/p/x.png"), None), None);
    }

    #[test]
    fn own_delete_is_ignored() {
        let mut known = KnownHashes::new();
        let p = Path::new("/p/levels/old.json");
        known.record(p, b"x");
        known.record_absent(p);
        assert_eq!(known.classify(p, None), None);
    }

    #[test]
    fn watched_paths() {
        let root = Path::new("/home/a/dünyam");
        let w = |rel: &str| is_watched(root, &root.join(rel));
        assert!(w("project.smap"));
        assert!(w("levels/main.json"));
        assert!(w("tilesets/grass.PNG"));
        assert!(!w("levels/.main.json.123.0.smap-tmp"));
        assert!(!w(".project.smap.1.0.smap-tmp"));
        assert!(!w("backups/2026-10-07.smap"));
        assert!(!w("levels/sub/main.json"));
        assert!(!w("tilesets/grass.aseprite"));
        assert!(!w("stamps/house.json"));
        assert!(!is_watched(root, Path::new("/elsewhere/project.smap")));
    }

    #[test]
    fn batch_dedupes_filters_and_skips_own_writes() {
        let root = Path::new("/p");
        let known = Mutex::new(KnownHashes::new());
        known.lock().unwrap().record(&root.join("project.smap"), b"ours");
        let disk = |p: &Path| -> Option<Vec<u8>> {
            match p.file_name()?.to_str()? {
                "project.smap" => Some(b"ours".to_vec()),
                "a.png" => Some(b"new pixels".to_vec()),
                _ => None,
            }
        };
        let events = vec![
            root.join("project.smap"),
            root.join("tilesets/a.png"),
            root.join("tilesets/a.png"),
            root.join("tilesets/.a.png.1.2.smap-tmp"),
            root.join("backups/x.smap"),
        ];
        let changes = process_batch(root, events, &known, disk);
        assert_eq!(
            changes,
            vec![FileChange { path: root.join("tilesets/a.png").to_string_lossy().into_owned(), kind: ChangeKind::Modified }]
        );
    }

    #[test]
    fn batch_reads_disk_while_holding_the_known_lock() {
        // Host::write_file_atomic records the hash and renames under the same
        // lock; if the batch read the disk outside it, a save could land between
        // the read and the classify and later be reported as an external change.
        let root = Path::new("/p");
        let known = Mutex::new(KnownHashes::new());
        let p = root.join("levels/a.json");
        let reads = std::cell::Cell::new(0);
        let changes = process_batch(root, vec![p.clone()], &known, |_| {
            reads.set(reads.get() + 1);
            assert!(known.try_lock().is_err(), "disk must be read under the known lock");
            Some(b"theirs".to_vec())
        });
        assert_eq!(reads.get(), 1);
        assert_eq!(changes.len(), 1);
    }

    /// Real OS events end to end (inotify on Linux, ReadDirectoryChangesW on Windows).
    #[test]
    fn watcher_reports_external_change_but_not_own_atomic_write() {
        let tmp = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(tmp.path()).unwrap();
        std::fs::create_dir_all(root.join("levels")).unwrap();
        let known = Arc::new(Mutex::new(KnownHashes::new()));
        let (tx, rx) = std::sync::mpsc::channel();
        let _w = ProjectWatcher::start(root.clone(), known.clone(), move |c| tx.send(c).unwrap()).unwrap();

        // Own write: hash recorded before the rename lands.
        let own = root.join("levels/main.json");
        known.lock().unwrap().record(&own, b"{}\n");
        crate::atomic::write_file_atomic(&own, b"{}\n").unwrap();
        assert!(rx.recv_timeout(Duration::from_millis(1200)).is_err(), "own write must be ignored");

        // External write.
        std::fs::write(&own, b"{\"x\":1}\n").unwrap();
        let change = rx.recv_timeout(Duration::from_secs(5)).expect("external change");
        assert_eq!(change.kind, ChangeKind::Modified);
        assert_eq!(PathBuf::from(change.path), own);
    }
}
