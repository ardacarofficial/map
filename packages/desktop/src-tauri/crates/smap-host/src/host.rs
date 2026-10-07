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
        let allowed = self.resolve(path).is_ok() || self.recents.contains(path);
        if !allowed {
            return Err(HostError::new(ErrorKind::OutOfScope, path, "not chosen by the user"));
        }
        let file = crate::scope::normalize(Path::new(path)).map_err(|e| HostError::scope(path, e))?;
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

    pub fn close_project(&self) {
        *self.watcher.lock().unwrap() = None;
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

    pub fn recent_add(&self, path: &str, name: &str, now_ms: u64) -> HostResult<Vec<RecentEntry>> {
        self.resolve(path)?;
        self.recents.add(path, name, now_ms).map_err(|e| HostError::io(path, &e))
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
