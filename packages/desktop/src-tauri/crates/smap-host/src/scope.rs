//! Yol kapsamı: webview yalnızca açık projenin klasörüne ve kullanıcının
//! diyalogdan / çift tıklamayla / son projeler listesinden açıkça seçtiği
//! yollara dokunabilir. Webview'e keyfi dosya sistemi erişimi verilmez.
//!
//! Kural: yol mutlak olmalı, `..` içermemeli; var olan en derin atası
//! kanonikleştirilir (sembolik bağlar ve büyük/küçük harf çözülür), sonuç
//! izinli bir kökün altında ya da izinli bir dosyanın kendisi olmalı.

use std::io;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScopeError {
    NotAbsolute,
    ParentTraversal,
    OutOfScope,
    Io(String),
}

impl std::fmt::Display for ScopeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ScopeError::NotAbsolute => write!(f, "path must be absolute"),
            ScopeError::ParentTraversal => write!(f, "path must not contain '..'"),
            ScopeError::OutOfScope => write!(f, "path is outside the opened project"),
            ScopeError::Io(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for ScopeError {}

#[derive(Debug, Default)]
pub struct Scope {
    project_root: Option<PathBuf>,
    dirs: Vec<PathBuf>,
    files: Vec<PathBuf>,
}

impl Scope {
    pub fn new() -> Self {
        Self::default()
    }

    /// Açık projenin klasörü. Bir öncekinin yerini alır.
    pub fn set_project_root(&mut self, dir: &Path) -> Result<PathBuf, ScopeError> {
        let dir = normalize(dir)?;
        self.project_root = Some(dir.clone());
        Ok(dir)
    }

    pub fn project_root(&self) -> Option<&Path> {
        self.project_root.as_deref()
    }

    /// Kullanıcının seçtiği bir klasör (altındaki her şey dahil).
    pub fn allow_dir(&mut self, dir: &Path) -> Result<PathBuf, ScopeError> {
        let dir = normalize(dir)?;
        if !self.dirs.contains(&dir) {
            self.dirs.push(dir.clone());
        }
        Ok(dir)
    }

    /// Kullanıcının seçtiği tek bir dosya (henüz var olmayabilir).
    pub fn allow_file(&mut self, file: &Path) -> Result<PathBuf, ScopeError> {
        let file = normalize(file)?;
        if !self.files.contains(&file) {
            self.files.push(file.clone());
        }
        Ok(file)
    }

    /// Webview'den gelen yolu doğrular; erişilecek gerçek yolu döner.
    pub fn resolve(&self, raw: &str) -> Result<PathBuf, ScopeError> {
        let path = normalize(Path::new(raw))?;
        let inside = self
            .project_root
            .iter()
            .chain(self.dirs.iter())
            .any(|root| path.starts_with(root))
            || self.files.contains(&path);
        if inside {
            Ok(path)
        } else {
            Err(ScopeError::OutOfScope)
        }
    }
}

/// Mutlak, `..` içermeyen yolu, var olan en derin atasını kanonikleştirerek
/// karşılaştırılabilir biçime getirir.
pub fn normalize(path: &Path) -> Result<PathBuf, ScopeError> {
    if !path.is_absolute() {
        return Err(ScopeError::NotAbsolute);
    }
    let mut clean = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => return Err(ScopeError::ParentTraversal),
            Component::CurDir => {}
            other => clean.push(other.as_os_str()),
        }
    }
    // Var olmayan kuyruğu ayır, var olan atayı kanonikleştir.
    let mut existing = clean.as_path();
    let mut tail: Vec<&std::ffi::OsStr> = Vec::new();
    loop {
        match dunce::canonicalize(existing) {
            Ok(mut base) => {
                for part in tail.iter().rev() {
                    base.push(part);
                }
                return Ok(base);
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                let (Some(parent), Some(name)) = (existing.parent(), existing.file_name()) else {
                    return Err(ScopeError::Io(e.to_string()));
                };
                tail.push(name);
                existing = parent;
            }
            Err(e) => return Err(ScopeError::Io(e.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn s(p: &Path) -> String {
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn allows_paths_inside_project_root_only() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("dünyam");
        fs::create_dir_all(root.join("levels")).unwrap();
        fs::create_dir_all(tmp.path().join("other")).unwrap();
        let mut scope = Scope::new();
        assert_eq!(scope.resolve(&s(&root.join("project.smap"))), Err(ScopeError::OutOfScope));
        scope.set_project_root(&root).unwrap();

        assert!(scope.resolve(&s(&root.join("project.smap"))).is_ok());
        assert!(scope.resolve(&s(&root.join("levels/main.json"))).is_ok());
        // Not-yet-existing nested paths are fine (mkdir + write).
        assert!(scope.resolve(&s(&root.join("tilesets/new/x.png"))).is_ok());
        assert!(scope.resolve(&s(&root.join("./levels/./a.json"))).is_ok());
        assert_eq!(scope.resolve(&s(&tmp.path().join("other/a.json"))), Err(ScopeError::OutOfScope));
        // A sibling whose name merely starts with the root's name is outside.
        assert_eq!(scope.resolve(&s(&tmp.path().join("dünyam2/a.json"))), Err(ScopeError::OutOfScope));
    }

    #[test]
    fn rejects_parent_traversal_and_relative_paths() {
        let tmp = tempfile::tempdir().unwrap();
        let mut scope = Scope::new();
        scope.set_project_root(tmp.path()).unwrap();
        let escape = format!("{}/levels/../../etc/passwd", s(tmp.path()));
        assert_eq!(scope.resolve(&escape), Err(ScopeError::ParentTraversal));
        // Even `..` that would stay inside is rejected: simpler to reason about.
        let inside = format!("{}/levels/../project.smap", s(tmp.path()));
        assert_eq!(scope.resolve(&inside), Err(ScopeError::ParentTraversal));
        assert_eq!(scope.resolve("levels/main.json"), Err(ScopeError::NotAbsolute));
        assert_eq!(scope.resolve(""), Err(ScopeError::NotAbsolute));
    }

    #[test]
    fn switching_project_drops_the_old_root() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let mut scope = Scope::new();
        scope.set_project_root(a.path()).unwrap();
        scope.set_project_root(b.path()).unwrap();
        assert_eq!(scope.resolve(&s(&a.path().join("x"))), Err(ScopeError::OutOfScope));
        assert!(scope.resolve(&s(&b.path().join("x"))).is_ok());
    }

    #[test]
    fn user_chosen_files_and_dirs_are_allowed() {
        let tmp = tempfile::tempdir().unwrap();
        let export_dir = tmp.path().join("Unity/Assets/Maps");
        fs::create_dir_all(&export_dir).unwrap();
        let png = tmp.path().join("Desktop/grass.png");
        let mut scope = Scope::new();
        scope.allow_dir(&export_dir).unwrap();
        scope.allow_file(&png).unwrap();
        assert!(scope.resolve(&s(&export_dir.join("level.json"))).is_ok());
        assert!(scope.resolve(&s(&png)).is_ok());
        assert_eq!(scope.resolve(&s(&tmp.path().join("Desktop/other.png"))), Err(ScopeError::OutOfScope));
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escaping_the_root_is_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("proj");
        let secret = tmp.path().join("secret");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&secret).unwrap();
        fs::write(secret.join("key"), b"x").unwrap();
        std::os::unix::fs::symlink(&secret, root.join("link")).unwrap();
        let mut scope = Scope::new();
        scope.set_project_root(&root).unwrap();
        assert_eq!(scope.resolve(&s(&root.join("link/key"))), Err(ScopeError::OutOfScope));
    }
}
