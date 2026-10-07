//! Güvenli kayıt: geçici dosyaya yaz → diske işle (fsync) → hedefin üstüne
//! yeniden adlandır → antivirüs/indeksleyici kilitlerse bekleyip tekrar dene.
//!
//! Tauri'nin dosya eklentisinde atomik yazma ve fsync yok (CLAUDE.md →
//! Bilinen tuzaklar › Tauri). Yarım kalmış bir kayıt hedef dosyayı asla
//! bozmaz: ya eski içerik kalır ya yenisi gelir.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

/// Yeniden adlandırma denemeleri arasındaki beklemeler. Toplam 5 deneme,
/// en kötü durumda ~750 ms. Windows Defender bir dosyayı tararken genelde
/// 100 ms'den kısa kilitler.
pub const RETRY_DELAYS: [Duration; 4] = [
    Duration::from_millis(50),
    Duration::from_millis(100),
    Duration::from_millis(200),
    Duration::from_millis(400),
];

/// Geçici dosyaların uzantısı; izleyici bu uzantıyı zaten dikkate almaz.
pub const TEMP_SUFFIX: &str = ".smap-tmp";

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Geçici ve kalıcı hataları ayırır. Yalnız geçici olanlar tekrar denenir.
pub fn is_transient(error: &io::Error) -> bool {
    #[cfg(windows)]
    {
        // ERROR_ACCESS_DENIED (5), ERROR_SHARING_VIOLATION (32), ERROR_LOCK_VIOLATION (33)
        if matches!(error.raw_os_error(), Some(5 | 32 | 33)) {
            return true;
        }
    }
    matches!(
        error.kind(),
        io::ErrorKind::PermissionDenied | io::ErrorKind::ResourceBusy | io::ErrorKind::Interrupted
    )
}

/// Hedefin üstüne yazan yeniden adlandırma. Windows'ta `MoveFileExW`
/// (`REPLACE_EXISTING | WRITE_THROUGH`): işlem diske işlenmeden dönmez.
pub fn replace_file(from: &Path, to: &Path) -> io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };
        let wide = |p: &Path| -> Vec<u16> { p.as_os_str().encode_wide().chain(Some(0)).collect() };
        let (f, t) = (wide(from), wide(to));
        // SAFETY: both buffers are NUL-terminated UTF-16 and outlive the call.
        let ok = unsafe { MoveFileExW(f.as_ptr(), t.as_ptr(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        fs::rename(from, to)
    }
}

/// `bytes`'ı `target`'a güvenli biçimde yazar (gerçek dosya sistemi).
pub fn write_file_atomic(target: &Path, bytes: &[u8]) -> io::Result<()> {
    write_file_atomic_with(target, bytes, replace_file, std::thread::sleep)
}

/// Test edilebilir çekirdek: yeniden adlandırma ve bekleme dışarıdan verilir.
pub fn write_file_atomic_with(
    target: &Path,
    bytes: &[u8],
    mut rename: impl FnMut(&Path, &Path) -> io::Result<()>,
    mut sleep: impl FnMut(Duration),
) -> io::Result<()> {
    let dir = target
        .parent()
        .filter(|d| !d.as_os_str().is_empty())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target has no parent folder"))?;
    let file_name = target
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target has no file name"))?;

    let temp = temp_path(dir, &file_name.to_string_lossy());
    let result = (|| {
        write_and_sync(&temp, bytes)?;
        keep_permissions(target, &temp);
        rename_with_retry(&temp, target, &mut rename, &mut sleep)?;
        sync_dir(dir);
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn temp_path(dir: &Path, file_name: &str) -> PathBuf {
    let n = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    dir.join(format!(".{file_name}.{}.{n}{TEMP_SUFFIX}", std::process::id()))
}

fn write_and_sync(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file: File = OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

/// Yeniden adlandırma hedefin izinlerini geçici dosyanınkiyle değiştirir:
/// kullanıcının `chmod 600` ya da grup yazma izni verdiği bir dosya her
/// kayıtta varsayılana (umask) dönmesin diye hedefin izinleri kopyalanır.
fn keep_permissions(target: &Path, temp: &Path) {
    #[cfg(unix)]
    if let Ok(meta) = fs::metadata(target) {
        let _ = fs::set_permissions(temp, meta.permissions());
    }
    #[cfg(not(unix))]
    let _ = (target, temp);
}

/// Hedef bir sembolik bağsa bağın gösterdiği gerçek dosya; değilse (ya da
/// bağ çözülemiyorsa) yolun kendisi. Yeniden adlandırma bağı düz bir dosyayla
/// değiştirirdi (ör. dotfile yöneticisinin bağladığı ayar dosyası kopar).
/// Kapsam denetimli yollarda kullanılmaz: orada yol zaten kanoniktir ve
/// sonradan konan bir bağı izlemek kapsam dışına yazmak olurdu.
pub fn follow_symlink(target: &Path) -> PathBuf {
    match fs::symlink_metadata(target) {
        Ok(meta) if meta.file_type().is_symlink() => fs::canonicalize(target).unwrap_or_else(|_| target.to_path_buf()),
        _ => target.to_path_buf(),
    }
}

fn rename_with_retry(
    from: &Path,
    to: &Path,
    rename: &mut impl FnMut(&Path, &Path) -> io::Result<()>,
    sleep: &mut impl FnMut(Duration),
) -> io::Result<()> {
    let mut attempt = 0;
    loop {
        match rename(from, to) {
            Ok(()) => return Ok(()),
            Err(error) if is_transient(&error) && attempt < RETRY_DELAYS.len() => {
                log::warn!("rename {} failed ({error}); retry {}", to.display(), attempt + 1);
                sleep(RETRY_DELAYS[attempt]);
                attempt += 1;
            }
            Err(error) => return Err(error),
        }
    }
}

/// Unix'te yeniden adlandırmanın kendisini diske işler (klasör girdisi).
/// Windows'ta `MOVEFILE_WRITE_THROUGH` bunu zaten yapar.
fn sync_dir(dir: &Path) {
    #[cfg(unix)]
    {
        if let Ok(d) = File::open(dir) {
            let _ = d.sync_all();
        }
    }
    #[cfg(not(unix))]
    let _ = dir;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn leftovers(dir: &Path) -> Vec<String> {
        fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(TEMP_SUFFIX))
            .collect()
    }

    #[test]
    fn creates_and_replaces() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("project.smap");
        write_file_atomic(&target, b"one").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"one");
        write_file_atomic(&target, b"two, longer").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"two, longer");
        write_file_atomic(&target, b"").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"");
        assert!(leftovers(tmp.path()).is_empty());
    }

    #[test]
    fn retries_transient_errors_with_backoff() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("level.json");
        fs::write(&target, b"old").unwrap();
        let mut calls = 0;
        let mut slept = Vec::new();
        write_file_atomic_with(
            &target,
            b"new",
            |from, to| {
                calls += 1;
                if calls <= 3 {
                    Err(io::Error::new(io::ErrorKind::PermissionDenied, "locked by antivirus"))
                } else {
                    fs::rename(from, to)
                }
            },
            |d| slept.push(d),
        )
        .unwrap();
        assert_eq!(calls, 4);
        assert_eq!(slept, RETRY_DELAYS[..3].to_vec());
        assert_eq!(fs::read(&target).unwrap(), b"new");
        assert!(leftovers(tmp.path()).is_empty());
    }

    #[test]
    fn gives_up_after_five_attempts_and_keeps_old_content() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("level.json");
        fs::write(&target, b"old").unwrap();
        let mut calls = 0;
        let mut slept = Vec::new();
        let err = write_file_atomic_with(
            &target,
            b"new",
            |_, _| {
                calls += 1;
                Err(io::Error::new(io::ErrorKind::ResourceBusy, "busy"))
            },
            |d| slept.push(d),
        )
        .unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::ResourceBusy);
        assert_eq!(calls, 5);
        assert_eq!(slept, RETRY_DELAYS.to_vec());
        assert_eq!(fs::read(&target).unwrap(), b"old");
        assert!(leftovers(tmp.path()).is_empty(), "temp file must be cleaned up");
    }

    #[test]
    fn permanent_errors_are_not_retried() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("a.json");
        let mut calls = 0;
        let err = write_file_atomic_with(
            &target,
            b"x",
            |_, _| {
                calls += 1;
                Err(io::Error::new(io::ErrorKind::NotFound, "gone"))
            },
            |_| panic!("must not sleep"),
        )
        .unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::NotFound);
        assert_eq!(calls, 1);
        assert!(!target.exists());
    }

    #[cfg(unix)]
    #[test]
    fn keeps_the_targets_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("private.json");
        fs::write(&target, b"old").unwrap();
        fs::set_permissions(&target, fs::Permissions::from_mode(0o600)).unwrap();
        write_file_atomic(&target, b"new").unwrap();
        assert_eq!(fs::metadata(&target).unwrap().permissions().mode() & 0o777, 0o600);
        fs::set_permissions(&target, fs::Permissions::from_mode(0o664)).unwrap();
        write_file_atomic(&target, b"newer").unwrap();
        assert_eq!(fs::metadata(&target).unwrap().permissions().mode() & 0o777, 0o664);
    }

    #[cfg(unix)]
    #[test]
    fn follow_symlink_resolves_links_only() {
        let tmp = tempfile::tempdir().unwrap();
        let real = tmp.path().join("dotfiles/recent.json");
        fs::create_dir_all(real.parent().unwrap()).unwrap();
        fs::write(&real, b"old").unwrap();
        let link = tmp.path().join("recent.json");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        assert_eq!(follow_symlink(&link), fs::canonicalize(&real).unwrap());
        assert_eq!(follow_symlink(&real), real);
        let missing = tmp.path().join("nope.json");
        assert_eq!(follow_symlink(&missing), missing);
    }

    #[test]
    fn missing_parent_folder_is_an_error() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("nope").join("a.json");
        assert!(write_file_atomic(&target, b"x").is_err());
    }
}
