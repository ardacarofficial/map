//! Dönen log dosyası: `harita.log` 1 MB'ı geçince `harita.1.log` olur, en
//! fazla 5 dosya tutulur (`harita.log` + `.1`…`.4`). Ağır bir log
//! kütüphanesi yok; açılışta yalnız bir dosya açılır.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub const MAX_BYTES: u64 = 1024 * 1024;
pub const KEEP_FILES: usize = 5;
const BASE: &str = "harita";

pub struct RotatingLog {
    dir: PathBuf,
    max_bytes: u64,
    keep: usize,
    state: Mutex<Option<(File, u64)>>,
}

impl RotatingLog {
    pub fn new(dir: PathBuf, max_bytes: u64, keep: usize) -> Self {
        Self { dir, max_bytes, keep: keep.max(1), state: Mutex::new(None) }
    }

    pub fn file_path(&self, index: usize) -> PathBuf {
        if index == 0 {
            self.dir.join(format!("{BASE}.log"))
        } else {
            self.dir.join(format!("{BASE}.{index}.log"))
        }
    }

    pub fn write_line(&self, line: &str) -> io::Result<()> {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if state.is_none() {
            fs::create_dir_all(&self.dir)?;
            *state = Some(open_append(&self.file_path(0))?);
        }
        let incoming = line.len() as u64 + 1;
        if let Some((_, size)) = state.as_ref() {
            if *size > 0 && size + incoming > self.max_bytes {
                *state = None; // close before renaming (Windows)
                self.rotate()?;
                *state = Some(open_append(&self.file_path(0))?);
            }
        }
        let (file, size) = state.as_mut().expect("log file open");
        file.write_all(line.as_bytes())?;
        file.write_all(b"\n")?;
        *size += incoming;
        Ok(())
    }

    fn rotate(&self) -> io::Result<()> {
        let _ = fs::remove_file(self.file_path(self.keep - 1));
        for i in (0..self.keep - 1).rev() {
            let from = self.file_path(i);
            if from.exists() {
                fs::rename(&from, self.file_path(i + 1))?;
            }
        }
        Ok(())
    }
}

fn open_append(path: &Path) -> io::Result<(File, u64)> {
    let file = OpenOptions::new().create(true).append(true).open(path)?;
    let size = file.metadata()?.len();
    Ok((file, size))
}

/// `log` cephesine bağlanan kaydedici.
pub struct FileLogger {
    pub log: RotatingLog,
    pub level: log::LevelFilter,
}

impl log::Log for FileLogger {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() <= self.level
    }

    fn log(&self, record: &log::Record) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let line = format!("{} {:<5} {}: {}", utc_timestamp(SystemTime::now()), record.level(), record.target(), record.args());
        if cfg!(debug_assertions) {
            eprintln!("{line}");
        }
        let _ = self.log.write_line(&line);
    }

    fn flush(&self) {}
}

/// Kaydediciyi kurar; ikinci çağrı sessizce yok sayılır.
pub fn init(dir: PathBuf, level: log::LevelFilter) {
    let logger = FileLogger { log: RotatingLog::new(dir, MAX_BYTES, KEEP_FILES), level };
    if log::set_boxed_logger(Box::new(logger)).is_ok() {
        log::set_max_level(level);
    }
}

/// `2026-10-07T20:37:05.123Z` — tarih kütüphanesi olmadan.
pub fn utc_timestamp(t: SystemTime) -> String {
    let d = t.duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = d.as_secs();
    let (days, rem) = ((secs / 86_400) as i64, secs % 86_400);
    let (y, m, day) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60,
        d.subsec_millis()
    )
}

/// Howard Hinnant'ın `civil_from_days` algoritması.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn timestamps() {
        assert_eq!(utc_timestamp(UNIX_EPOCH), "1970-01-01T00:00:00.000Z");
        let t = UNIX_EPOCH + Duration::from_millis(1_791_405_425_123);
        assert_eq!(utc_timestamp(t), "2026-10-07T20:37:05.123Z");
        let leap = UNIX_EPOCH + Duration::from_secs(951_782_400); // 2000-02-29
        assert_eq!(&utc_timestamp(leap)[..10], "2000-02-29");
    }

    #[test]
    fn rotates_and_keeps_n_files() {
        let tmp = tempfile::tempdir().unwrap();
        let log = RotatingLog::new(tmp.path().join("logs"), 100, 3);
        let line = "x".repeat(39); // 40 bytes with newline → 2 lines per file
        for i in 0..20 {
            log.write_line(&format!("{line}{}", i % 10)).unwrap();
        }
        let files: Vec<_> = fs::read_dir(tmp.path().join("logs")).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(files.len(), 3);
        for i in 0..3 {
            assert!(fs::metadata(log.file_path(i)).unwrap().len() <= 100);
        }
        let newest = fs::read_to_string(log.file_path(0)).unwrap();
        assert!(newest.ends_with(&format!("{line}9\n")));
    }

    #[test]
    fn single_oversized_line_is_still_written() {
        let tmp = tempfile::tempdir().unwrap();
        let log = RotatingLog::new(tmp.path().to_path_buf(), 10, 2);
        log.write_line("this line is longer than ten bytes").unwrap();
        log.write_line("again a long line").unwrap();
        assert!(fs::read_to_string(log.file_path(0)).unwrap().starts_with("again"));
        assert!(fs::read_to_string(log.file_path(1)).unwrap().starts_with("this"));
    }
}
