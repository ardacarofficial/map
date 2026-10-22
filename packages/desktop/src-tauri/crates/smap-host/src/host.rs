//! Komutların Tauri'siz gövdesi. Tauri tarafı (`src-tauri/src/lib.rs`)
//! yalnızca bunları çağıran ince sarmalayıcılardır; böylece komutların
//! tamamı ekransız `cargo test` ile denenir.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::Serialize;

use crate::atomic;
use crate::recent::{RecentEntry, RecentStore, RecentView};
use crate::scope::{Scope, ScopeError};
use crate::watch::{FileChange, KnownHashes, ProjectWatcher};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum ErrorKind {
    NotFound,
    OutOfScope,
    InvalidPath,
    Changed,
    Io,
}

/// Webview'e `{ kind, path, message }` olarak gider.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct HostError {
    pub kind: ErrorKind,
    pub path: String,
    pub message: String,
}

impl HostError {
    fn new(kind: ErrorKind, path: &str, message: impl Into<String>) -> Self {
        Self { kind, path: path.to_owned(), message: message.into() }
    }
    fn io(path: &str, e: &io::Error) -> Self {
        let kind = if e.kind() == io::ErrorKind::NotFound { ErrorKind::NotFound } else { ErrorKind::Io };
        Self::new(kind, path, e.to_string())
    }
    fn scope(path: &str, e: ScopeError) -> Self {
        let kind = match e {
            ScopeError::OutOfScope => ErrorKind::OutOfScope,
            ScopeError::NotAbsolute | ScopeError::ParentTraversal => ErrorKind::InvalidPath,
            ScopeError::Io(_) => ErrorKind::Io,
        };
        Self::new(kind, path, e.to_string())
    }
}

impl std::fmt::Display for HostError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?} {}: {}", self.kind, self.path, self.message)
    }
}

impl std::error::Error for HostError {}

pub type HostResult<T> = Result<T, HostError>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedProject {
    /// `project.smap` dosyasının mutlak yolu.
    pub file: String,
    /// Proje klasörü (`ProjectFileSystem` kökü).
    pub root: String,
    /// Klasör adı.
    pub name: String,
}

pub type ChangeSink = Arc<dyn Fn(FileChange) + Send + Sync>;

pub struct Host {
    scope: Mutex<Scope>,
    known: Arc<Mutex<KnownHashes>>,
    watcher: Mutex<Option<ProjectWatcher>>,
    recents: RecentStore,
    pending_open: Mutex<Option<String>>,
    on_change: ChangeSink,
}

impl Host {
    pub fn new(recent_file: PathBuf, on_change: ChangeSink) -> Self {
        Self {
            scope: Mutex::new(Scope::new()),
            known: Arc::new(Mutex::new(KnownHashes::new())),
            watcher: Mutex::new(None),
            recents: RecentStore::new(recent_file),
            pending_open: Mutex::new(None),
            on_change,
        }
    }

    fn resolve(&self, path: &str) -> HostResult<PathBuf> {
        self.scope.lock().unwrap().resolve(path).map_err(|e| HostError::scope(path, e))
    }

    // ---- dosya komutları -------------------------------------------------

    pub fn read_file(&self, path: &str) -> HostResult<Vec<u8>> {
        let real = self.resolve(path)?;
        // Kilit altında oku: izleyicinin aynı anda kaydettiği daha yeni
        // içeriğin üstüne eski okumanın özeti yazılmasın.
        let mut known = self.known.lock().unwrap();
        match fs::read(&real) {
            Ok(bytes) => {
                known.record(&real, &bytes);
                Ok(bytes)
            }
            Err(e) => {
                if e.kind() == io::ErrorKind::NotFound {
                    known.record_absent(&real);
                }
                Err(HostError::io(path, &e))
            }
        }
    }

    pub fn read_text(&self, path: &str) -> HostResult<String> {
        let bytes = self.read_file(path)?;
        String::from_utf8(bytes).map_err(|e| HostError::new(ErrorKind::Io, path, format!("not UTF-8: {e}")))
    }

    pub fn write_file_atomic(&self, path: &str, bytes: &[u8]) -> HostResult<()> {
        let real = self.resolve(path)?;
        // Özeti yeniden adlandırmadan önce kaydet ve kilidi yazma bitene
        // kadar tut: izleyici (diski de kilit altında okur) ya kaydın
        // öncesini ya sonrasını görür, arasını değil. Aynı yola eşzamanlı iki
        // kayıt da böylece sıraya girer; bilinen özet diskteki son içerikle
        // aynı kalır. Başarısız olursa eski durumu geri koy.
        let mut known = self.known.lock().unwrap();
        let previous = known.get(&real);
        known.record(&real, bytes);
        let result = atomic::write_file_atomic(&real, bytes);
        if let Err(e) = &result {
            known.restore(&real, previous);
            log::error!("save failed {}: {e}", real.display());
        }
        result.map_err(|e| HostError::io(path, &e))
    }

    /// Explicit source PNG write-back only. Scope, CAS, verified unique backup,
    /// rename retries and watcher hashing share the host critical section.
    pub fn replace_png_guarded(&self, path: &str, backup: &str, expected: &[u8], replacement: &[u8]) -> HostResult<()> {
        self.replace_png_guarded_with(path, backup, expected, replacement, atomic::replace_file)
    }

    fn replace_png_guarded_with(&self, path: &str, backup: &str, expected: &[u8], replacement: &[u8], mut rename: impl FnMut(&Path, &Path) -> io::Result<()>) -> HostResult<()> {
        use std::io::Write;
        let scope = self.scope.lock().unwrap();
        let real = scope.resolve(path).map_err(|e| HostError::scope(path, e))?;
        let backup_real = scope.resolve(backup).map_err(|e| HostError::scope(backup, e))?;
        let root = scope.project_root().ok_or_else(|| HostError::new(ErrorKind::OutOfScope, path, "no open project"))?;
        if !real.starts_with(root.join("tilesets"))
            || !real.extension().is_some_and(|e| e.eq_ignore_ascii_case("png"))
            || backup_real.parent() != Some(root.join("backups/png").as_path())
            || !backup_real.extension().is_some_and(|e| e == "png") {
            return Err(HostError::new(ErrorKind::OutOfScope, path, "PNG write-back must stay in project tilesets and backups/png"));
        }
        let mut known = self.known.lock().unwrap();
        let check = || -> io::Result<()> {
            if fs::read(&real)? != expected { return Err(io::Error::new(io::ErrorKind::InvalidData, "PNG changed")); }
            Ok(())
        };
        let map_error = |e: io::Error| {
            if e.kind() == io::ErrorKind::InvalidData { HostError::new(ErrorKind::Changed, path, "PNG changed") }
            else { HostError::io(path, &e) }
        };
        check().map_err(map_error)?;
        fs::create_dir_all(backup_real.parent().unwrap()).map_err(|e| HostError::io(backup, &e))?;
        // Never truncate or replace an existing backup, including on a repeated request.
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&backup_real).map_err(|e| HostError::io(backup, &e))?;
        file.write_all(expected).and_then(|_| file.sync_all()).map_err(|e| HostError::io(backup, &e))?;
        if fs::read(&backup_real).map_err(|e| HostError::io(backup, &e))? != expected {
            return Err(HostError::new(ErrorKind::Io, backup, "backup verification failed"));
        }
        // On Unix fsync the new directory entries as well as the file before
        // making the source replacement durable. Any failure leaves it intact.
        #[cfg(unix)]
        for dir in [backup_real.parent().unwrap(), root.join("backups").as_path(), root] {
            fs::File::open(dir).and_then(|f| f.sync_all()).map_err(|e| HostError::io(backup, &e))?;
        }
        let previous = known.get(&real);
        known.record(&real, replacement);
        let result = atomic::write_file_atomic_with(&real, replacement, |from, to| {
            // Recheck immediately before every rename, including after antivirus retries.
            check()?;
            rename(from, to)
        }, std::thread::sleep);
        if result.is_err() { known.restore(&real, previous); }
        result.map_err(map_error)
    }

    pub fn list_dir(&self, path: &str) -> HostResult<Vec<String>> {
        let real = self.resolve(path)?;
        let entries = match fs::read_dir(&real) {
            Ok(entries) => entries,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(HostError::io(path, &e)),
        };
        let mut names = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|e| HostError::io(path, &e))?;
            let is_file = entry.file_type().map(|t| t.is_file()).unwrap_or(false);
            let name = entry.file_name().to_string_lossy().into_owned();
            if is_file && !name.ends_with(atomic::TEMP_SUFFIX) {
                names.push(name);
            }
        }
        names.sort();
        Ok(names)
    }

    pub fn create_dir_all(&self, path: &str) -> HostResult<()> {
        let real = self.resolve(path)?;
        fs::create_dir_all(&real).map_err(|e| HostError::io(path, &e))
    }

    pub fn remove_file(&self, path: &str) -> HostResult<()> {
        let real = self.resolve(path)?;
        self.known.lock().unwrap().record_absent(&real);
        match fs::remove_file(&real) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(HostError::io(path, &e)),
        }
    }

    pub fn exists(&self, path: &str) -> HostResult<bool> {
        Ok(self.resolve(path)?.exists())
    }

    /// Klasörde gizli olmayan (nokta ile başlamayan) bir dosya ya da klasör
    /// var mı. Yeni projeyi seçilen klasöre mi alt klasöre mi yazacağımızı
    /// belirler. Klasör yoksa `false`.
    pub fn dir_has_entries(&self, path: &str) -> HostResult<bool> {
        let real = self.resolve(path)?;
        let entries = match fs::read_dir(&real) {
            Ok(entries) => entries,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(false),
            Err(e) => return Err(HostError::io(path, &e)),
        };
        for entry in entries {
            let entry = entry.map_err(|e| HostError::io(path, &e))?;
            if !entry.file_name().to_string_lossy().starts_with('.') {
                return Ok(true);
            }
        }
        Ok(false)
    }

    // ---- kullanıcının seçtiği yollar -------------------------------------

    /// Diyalogdan ya da işletim sisteminden (çift tıklama) gelen dosya.
    pub fn allow_user_file(&self, path: &Path) -> HostResult<String> {
        let p = self.scope.lock().unwrap().allow_file(path).map_err(|e| HostError::scope(&path.to_string_lossy(), e))?;
        Ok(p.to_string_lossy().into_owned())
    }

    /// Diyalogdan seçilen klasör (yeni proje, dışa aktarma hedefi).
    pub fn allow_user_dir(&self, path: &Path) -> HostResult<String> {
        let p = self.scope.lock().unwrap().allow_dir(path).map_err(|e| HostError::scope(&path.to_string_lossy(), e))?;
        Ok(p.to_string_lossy().into_owned())
    }

    /// Açılışta argv'den ya da ikinci örnekten gelen `.smap`: izin verir ve
    /// arayüz sorana kadar saklar (olay dinleyici henüz kurulmamış olabilir).
    pub fn offer_open(&self, path: &Path) -> Option<String> {
        match self.allow_user_file(path) {
            Ok(p) => {
                *self.pending_open.lock().unwrap() = Some(p.clone());
                Some(p)
            }
            Err(e) => {
                log::warn!("ignoring open request: {e}");
                None
            }
        }
    }

    /// Bekleyen açılış isteğini bir kez verir.
    pub fn take_pending_open(&self) -> Option<String> {
        self.pending_open.lock().unwrap().take()
    }

    // ---- proje -----------------------------------------------------------

    /// `project.smap`'i açar: klasörü kök yapar, izleyiciyi başlatır, son
    /// projelere ekler. Yol ya kullanıcının seçtiği/izin verilmiş bir yol
    /// ya da son projeler listesinde olmalı.
    pub fn open_project(&self, path: &str, name: &str, now_ms: u64) -> HostResult<OpenedProject> {
        // Recents store canonical paths. Windows dialogs/argv may use an 8.3
        // alias (e.g. RUNNER~1), so compare the same identity before admission.
        let file = crate::scope::normalize(Path::new(path)).map_err(|e| HostError::scope(path, e))?;
        let allowed = self.resolve(path).is_ok() || self.recents.contains(&file.to_string_lossy());
        if !allowed {
            return Err(HostError::new(ErrorKind::OutOfScope, path, "not chosen by the user"));
        }
        if !file.is_file() {
            return Err(HostError::new(ErrorKind::NotFound, path, "project file not found"));
        }
        if !file.extension().is_some_and(|e| e.eq_ignore_ascii_case("smap")) {
            return Err(HostError::new(ErrorKind::InvalidPath, path, "not a .smap file"));
        }
        let root = file.parent().map(Path::to_path_buf).ok_or_else(|| HostError::new(ErrorKind::InvalidPath, path, "no folder"))?;
        let root = self.scope.lock().unwrap().set_project_root(&root).map_err(|e| HostError::scope(path, e))?;
        self.known.lock().unwrap().clear();
        self.restart_watcher(root.clone());

        let file_str = file.to_string_lossy().into_owned();
        let folder = root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let display = if name.is_empty() { folder.clone() } else { name.to_owned() };
        if let Err(e) = self.recents.add(&file_str, &display, now_ms) {
            log::warn!("could not update recents: {e}");
        }
        log::info!("opened project {file_str}");
        Ok(OpenedProject { file: file_str, root: root.to_string_lossy().into_owned(), name: folder })
    }

    /// Yeni proje: kullanıcının seçtiği klasör kök olur (henüz project.smap yok).
    pub fn set_project_root(&self, dir: &str) -> HostResult<String> {
        let real = self.resolve(dir)?;
        let root = self.scope.lock().unwrap().set_project_root(&real).map_err(|e| HostError::scope(dir, e))?;
        self.known.lock().unwrap().clear();
        self.restart_watcher(root.clone());
        Ok(root.to_string_lossy().into_owned())
    }

    /// İzleyiciyi durdurur ve eski proje klasörünü kapsamdan çıkarır.
    pub fn close_project(&self) {
        *self.watcher.lock().unwrap() = None;
        if let Some(root) = self.scope.lock().unwrap().close_project_root() {
            log::info!("closed project {}", root.display());
        }
        self.known.lock().unwrap().clear();
    }

    fn restart_watcher(&self, root: PathBuf) {
        let mut slot = self.watcher.lock().unwrap();
        *slot = None;
        let sink = self.on_change.clone();
        match ProjectWatcher::start(root, self.known.clone(), move |c| sink(c)) {
            Ok(w) => *slot = Some(w),
            Err(e) => log::warn!("file watcher unavailable: {e}"),
        }
    }

    // ---- son projeler ----------------------------------------------------

    pub fn recent_list(&self) -> Vec<RecentView> {
        self.recents.list()
    }

    pub fn recent_add(&self, path: &str, name: &str, thumbnail: Option<&str>, now_ms: u64) -> HostResult<Vec<RecentEntry>> {
        self.resolve(path)?;
        self.recents.add_with_thumbnail(path, name, thumbnail, now_ms).map_err(|e| HostError::io(path, &e))
    }

    pub fn recent_remove(&self, path: &str) -> HostResult<Vec<RecentEntry>> {
        self.recents.remove(path).map_err(|e| HostError::io(path, &e))
    }
}

/// argv içinden açılacak `.smap` dosyasını bulur (ilk öğe programın kendisi).
/// Göreli yollar `cwd`'ye göre çözülür (ikinci örnek kendi cwd'sini yollar).
pub fn find_open_arg<S: AsRef<str>>(args: &[S], cwd: &Path) -> Option<PathBuf> {
    args.iter().skip(1).map(AsRef::as_ref).find_map(|a| {
        let p = Path::new(a);
        let is_smap = p.extension().is_some_and(|e| e.eq_ignore_ascii_case("smap"));
        if !is_smap || a.starts_with('-') {
            return None;
        }
        Some(if p.is_absolute() { p.to_path_buf() } else { cwd.join(p) })
    })
}

/// `encodeURIComponent` tersine çevirir (ikili yazma komutunda yol başlıkta gelir).
pub fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = s.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    fn host(dir: &Path) -> (Host, mpsc::Receiver<FileChange>) {
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        let h = Host::new(dir.join("config/recent.json"), Arc::new(move |c| tx.lock().unwrap().send(c).unwrap()));
        (h, rx)
    }

    fn s(p: &Path) -> String {
        p.to_string_lossy().into_owned()
    }

    fn project(dir: &Path) -> PathBuf {
        let root = dir.join("Dünyam");
        fs::create_dir_all(root.join("levels")).unwrap();
        fs::write(root.join("project.smap"), b"{}\n").unwrap();
        root
    }

    #[test]
    fn guarded_png_backup_restore_cas_and_known_echo() {
        let tmp = tempfile::tempdir().unwrap();
        let (h, _) = host(tmp.path());
        let root = project(tmp.path());
        h.allow_user_dir(&root).unwrap();
        h.set_project_root(&s(&root)).unwrap();
        fs::create_dir_all(root.join("tilesets")).unwrap();
        let target = root.join("tilesets/a.png");
        let backup = root.join("backups/png/first.png");
        fs::write(&target, b"original exact bytes").unwrap();
        h.replace_png_guarded(&s(&target), &s(&backup), b"original exact bytes", b"new").unwrap();
        assert_eq!(fs::read(&backup).unwrap(), b"original exact bytes");
        assert_eq!(fs::read(&target).unwrap(), b"new");
        // The watcher and Host use resolved paths, not the temp directory's
        // possibly short Windows alias.
        let real = h.resolve(&s(&target)).unwrap();
        assert!(h.known.lock().unwrap().classify(&real, Some(&fs::read(&target).unwrap())).is_none());
        let restore_backup = root.join("backups/png/second.png");
        h.replace_png_guarded(&s(&target), &s(&restore_backup), b"new", &fs::read(&backup).unwrap()).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"original exact bytes");
        assert_eq!(fs::read(&restore_backup).unwrap(), b"new");
        fs::write(&target, b"external").unwrap();
        let race_backup = root.join("backups/png/race.png");
        assert_eq!(h.replace_png_guarded(&s(&target), &s(&race_backup), b"original exact bytes", b"bad").unwrap_err().kind, ErrorKind::Changed);
        assert!(!race_backup.exists());
        assert_eq!(fs::read(&target).unwrap(), b"external");
        assert!(h.replace_png_guarded(&s(&target), &s(&backup), b"external", b"bad").is_err());
        assert_eq!(fs::read(&target).unwrap(), b"external");
        assert_eq!(fs::read(&backup).unwrap(), b"original exact bytes");
    }

    #[test]
    fn guarded_png_race_during_antivirus_retry_and_permission_failure_keep_source() {
        let tmp = tempfile::tempdir().unwrap();
        let (h, _) = host(tmp.path());
        let root = project(tmp.path());
        h.allow_user_dir(&root).unwrap();
        h.set_project_root(&s(&root)).unwrap();
        fs::create_dir_all(root.join("tilesets")).unwrap();
        let target = root.join("tilesets/a.png");
        let backup = root.join("backups/png/race.png");
        fs::write(&target, b"original").unwrap();
        let mut attempts = 0;
        let result = h.replace_png_guarded_with(&s(&target), &s(&backup), b"original", b"ours", |_, to| {
            attempts += 1;
            fs::write(to, b"external").unwrap();
            Err(io::Error::new(io::ErrorKind::PermissionDenied, "antivirus"))
        });
        assert_eq!(result.unwrap_err().kind, ErrorKind::Changed);
        assert_eq!(attempts, 1);
        assert_eq!(fs::read(&target).unwrap(), b"external");
        assert_eq!(fs::read(&backup).unwrap(), b"original");
        assert!(h.list_dir(&s(&root.join("tilesets"))).unwrap().iter().all(|n| !n.ends_with(atomic::TEMP_SUFFIX)));
        let failed = root.join("backups/png/permission.png");
        assert!(h.replace_png_guarded_with(&s(&target), &s(&failed), b"external", b"ours", |_, _| {
            Err(io::Error::new(io::ErrorKind::Other, "denied"))
        }).is_err());
        assert_eq!(fs::read(&target).unwrap(), b"external");
        assert_eq!(fs::read(&failed).unwrap(), b"external");
        assert!(h.known.lock().unwrap().classify(&target, Some(b"external")).is_some());
    }

    #[test]
    fn guarded_png_refuses_backup_failure_and_outside_project() {
        let tmp = tempfile::tempdir().unwrap();
        let (h, _) = host(tmp.path());
        let root = project(tmp.path());
        h.allow_user_dir(&root).unwrap();
        h.set_project_root(&s(&root)).unwrap();
        fs::create_dir_all(root.join("tilesets")).unwrap();
        let target = root.join("tilesets/a.png");
        fs::write(&target, b"old").unwrap();
        fs::write(root.join("backups"), b"not a directory").unwrap();
        assert!(h.replace_png_guarded(&s(&target), &s(&root.join("backups/png/a.png")), b"old", b"new").is_err());
        assert_eq!(fs::read(&target).unwrap(), b"old");
        fs::remove_file(root.join("backups")).unwrap();
        let outside = tmp.path().join("outside.png");
        fs::write(&outside, b"old").unwrap();
        h.allow_user_file(&outside).unwrap();
        assert_eq!(h.replace_png_guarded(&s(&outside), &s(&root.join("backups/png/a.png")), b"old", b"new").unwrap_err().kind, ErrorKind::OutOfScope);
    }

    #[test]
    fn nothing_is_accessible_before_a_project_is_chosen() {
        let tmp = tempfile::tempdir().unwrap();
        let (h, _) = host(tmp.path());
        let root = project(tmp.path());
        let err = h.read_text(&s(&root.join("project.smap"))).unwrap_err();
        assert_eq!(err.kind, ErrorKind::OutOfScope);
        let err = h.open_project(&s(&root.join("project.smap")), "", 0).unwrap_err();
        assert_eq!(err.kind, ErrorKind::OutOfScope);
    }

    #[test]
    fn open_read_write_list_remove() {
        let tmp = tempfile::tempdir().unwrap();
        let (h, _) = host(tmp.path());
        let root = project(tmp.path());
        let file = root.join("project.smap");
        h.allow_user_file(&file).unwrap();
        let opened = h.open_project(&s(&file), "Benim Dünyam", 5).unwrap();
        assert_eq!(opened.name, "Dünyam");
        let r = PathBuf::from(&opened.root);

        assert_eq!(h.read_text(&s(&r.join("project.smap"))).unwrap(), "{}\n");
        h.create_dir_all(&s(&r.join("tilesets"))).unwrap();
        h.write_file_atomic(&s(&r.join("levels/main.json")), b"[1]\n").unwrap();
        h.write_file_atomic(&s(&r.join("levels/b.json")), b"[2]\n").unwrap();
        assert_eq!(h.list_dir(&s(&r.join("levels"))).unwrap(), vec!["b.json", "main.json"]);
        assert_eq!(h.list_dir(&s(&r)).unwrap(), vec!["project.smap"]);
        assert_eq!(h.list_dir(&s(&r.join("stamps"))).unwrap(), Vec::<String>::new());
        assert!(h.exists(&s(&r.join("levels/b.json"))).unwrap());
        h.remove_file(&s(&r.join("levels/b.json"))).unwrap();
        h.remove_file(&s(&r.join("levels/b.json"))).unwrap(); // missing is fine
        assert!(!h.exists(&s(&r.join("levels/b.json"))).unwrap());
        assert_eq!(h.read_file(&s(&r.join("levels/b.json"))).unwrap_err().kind, ErrorKind::NotFound);
        assert_eq!(h.read_file(&s(&tmp.path().join("config/recent.json"))).unwrap_err().kind, ErrorKind::OutOfScope);

        let recents = h.recent_list();
        assert_eq!(recents.len(), 1);
        assert_eq!(recents[0].entry.name, "Benim Dünyam");
        assert!(recents[0].exists);
    }

    #[test]
    fn recents_grant_access_after_restart() {
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path());
        let file = s(&root.join("project.smap"));
        {
            let (h, _) = host(tmp.path());
            h.allow_user_file(Path::new(&file)).unwrap();
            h.open_project(&file, "", 1).unwrap();
        }
        // "Restart": new Host, empty scope, same recent.json.
        let (h, _) = host(tmp.path());
        let opened = h.open_project(&file, "", 2).unwrap();
        assert!(h.read_text(&s(&PathBuf::from(opened.root).join("project.smap"))).is_ok());
        // Removed from recents → no longer openable without a dialog.
        let (h2, _) = host(tmp.path());
        h2.recent_remove(&opened.file).unwrap();
        assert_eq!(h2.open_project(&file, "", 3).unwrap_err().kind, ErrorKind::OutOfScope);
    }

    #[test]
    fn failed_save_does_not_poison_known_hashes() {
        let tmp = tempfile::tempdir().unwrap();
        let (h, _) = host(tmp.path());
        let root = project(tmp.path());
        h.allow_user_dir(&root).unwrap();
        h.set_project_root(&s(&root)).unwrap();
        let missing_dir = root.join("nope/level.json");
        assert!(h.write_file_atomic(&s(&missing_dir), b"x").is_err());
        let real = crate::scope::normalize(&missing_dir).unwrap();
        assert_eq!(h.known.lock().unwrap().get(&real), None);
    }

    #[test]
    fn dir_has_entries_ignores_hidden_and_needs_scope() {
        let dir = tempfile::tempdir().unwrap();
        let (h, _rx) = host(dir.path());
        let picked = dir.path().join("picked");
        fs::create_dir_all(&picked).unwrap();
        assert_eq!(h.dir_has_entries(&s(&picked)).unwrap_err().kind, ErrorKind::OutOfScope);
        let allowed = h.allow_user_dir(&picked).unwrap();
        assert!(!h.dir_has_entries(&allowed).unwrap());
        fs::write(picked.join(".DS_Store"), b"x").unwrap();
        assert!(!h.dir_has_entries(&allowed).unwrap());
        fs::create_dir_all(picked.join("art")).unwrap();
        assert!(h.dir_has_entries(&allowed).unwrap());
    }

    #[test]
    fn closing_a_project_revokes_its_folder() {
        let dir = tempfile::tempdir().unwrap();
        let (h, _rx) = host(dir.path());
        // Opened by double click: the file grant + root.
        let file = project(dir.path()).join("project.smap");
        fs::write(file.parent().unwrap().join("levels").join("main.json"), b"{}").unwrap();
        let opened = h.open_project(&h.allow_user_file(&file).unwrap(), "", 1).unwrap();
        let level = Path::new(&opened.root).join("levels").join("main.json");
        assert!(h.read_text(&s(&level)).is_ok());
        h.close_project();
        assert_eq!(h.read_text(&s(&level)).unwrap_err().kind, ErrorKind::OutOfScope);
        assert_eq!(h.exists(&opened.file).unwrap_err().kind, ErrorKind::OutOfScope);
        // Recents still allow reopening it.
        assert!(h.open_project(&opened.file, "", 2).is_ok());
        h.close_project();

        // New project saved into a picked parent folder: the parent grant goes too.
        let parent = dir.path().join("maps");
        fs::create_dir_all(parent.join("new")).unwrap();
        let parent_s = h.allow_user_dir(&parent).unwrap();
        let root = h.set_project_root(&s(&Path::new(&parent_s).join("new"))).unwrap();
        h.write_file_atomic(&s(&Path::new(&root).join("project.smap")), b"{}").unwrap();
        h.close_project();
        assert_eq!(h.list_dir(&parent_s).unwrap_err().kind, ErrorKind::OutOfScope);
        assert_eq!(h.list_dir(&root).unwrap_err().kind, ErrorKind::OutOfScope);
    }

    #[test]
    fn pending_open_is_taken_once() {
        let tmp = tempfile::tempdir().unwrap();
        let (h, _) = host(tmp.path());
        let root = project(tmp.path());
        let offered = h.offer_open(&root.join("project.smap")).unwrap();
        assert_eq!(h.take_pending_open(), Some(offered.clone()));
        assert_eq!(h.take_pending_open(), None);
        assert!(h.open_project(&offered, "", 0).is_ok());
        assert!(h.offer_open(Path::new("relative.smap")).is_none());
    }

    #[test]
    fn open_arg_parsing() {
        let cwd = Path::new("/home/a");
        assert_eq!(find_open_arg(&["app.exe"], cwd), None);
        assert_eq!(find_open_arg(&["app.exe", "/x/project.smap"], cwd), Some(PathBuf::from("/x/project.smap")));
        assert_eq!(find_open_arg(&["app.exe", "--flag", "w/Project.SMAP"], cwd), Some(PathBuf::from("/home/a/w/Project.SMAP")));
        assert_eq!(find_open_arg(&["app.exe", "notes.txt"], cwd), None);
    }

    #[test]
    fn percent_decoding() {
        assert_eq!(percent_decode("C%3A%5CD%C3%BCnyam%5Cproject.smap").as_deref(), Some("C:\\Dünyam\\project.smap"));
        assert_eq!(percent_decode("/plain/path").as_deref(), Some("/plain/path"));
        assert_eq!(percent_decode("%zz"), None);
        assert_eq!(percent_decode("%C3"), None);
        assert_eq!(percent_decode("%4"), None);
    }

    #[test]
    fn external_change_reaches_the_sink_but_own_save_does_not() {
        let tmp = tempfile::tempdir().unwrap();
        let (h, rx) = host(tmp.path());
        let root = project(tmp.path());
        h.allow_user_file(&root.join("project.smap")).unwrap();
        let opened = h.open_project(&s(&root.join("project.smap")), "", 0).unwrap();
        let level = PathBuf::from(&opened.root).join("levels/main.json");
        h.write_file_atomic(&s(&level), b"ours").unwrap();
        assert!(rx.recv_timeout(std::time::Duration::from_millis(1000)).is_err());
        fs::write(&level, b"theirs").unwrap();
        let c = rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap();
        assert_eq!(PathBuf::from(c.path), level);
    }
}
