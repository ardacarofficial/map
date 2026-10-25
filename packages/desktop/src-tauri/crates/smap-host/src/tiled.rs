//! Read-only intake of a Tiled map and the files it references (v2.2
//! "Basit Tiled içe aktarma"). Only absolute paths to regular files with a
//! Tiled/PNG extension, up to 32 MB each. Nothing is ever written: the editor
//! parses the map, copies the PNGs into the project as new tilesets and never
//! touches the originals.

use std::io::Read;
use std::path::Path;

/// Largest single file of a Tiled import (map, tileset or PNG).
pub const TILED_MAX_BYTES: u64 = 32 * 1024 * 1024;

/// Extensions a Tiled import may read: maps, tilesets and sheet images.
pub const TILED_EXTENSIONS: &[&str] = &["tmx", "tmj", "json", "tsx", "tsj", "png"];

/// Reads one import file after validating path, type and size.
pub fn read_tiled_file(path: &Path) -> Result<Vec<u8>, String> {
    if !path.is_absolute() {
        return Err("path must be absolute".into());
    }
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if !TILED_EXTENSIONS.contains(&extension.as_str()) {
        return Err("unsupported type: use .tmx, .tmj, .json, .tsx, .tsj or .png".into());
    }
    let metadata = std::fs::metadata(path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "not found".to_string()
        } else {
            e.to_string()
        }
    })?;
    if !metadata.is_file() {
        return Err("not found".into());
    }
    if metadata.len() > TILED_MAX_BYTES {
        return Err("file too large (32 MB limit)".into());
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    std::fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take(TILED_MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > TILED_MAX_BYTES {
        return Err("file too large (32 MB limit)".into());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_only_absolute_tiled_files_within_the_limit() {
        let dir = tempfile::tempdir().unwrap();
        let map = dir.path().join("Village.TMX");
        std::fs::write(&map, b"<map/>").unwrap();
        assert_eq!(read_tiled_file(&map).unwrap(), b"<map/>");
        for ok in ["a.tmj", "a.json", "a.tsx", "a.tsj", "a.png"] {
            std::fs::write(dir.path().join(ok), b"x").unwrap();
            assert!(read_tiled_file(&dir.path().join(ok)).is_ok(), "{ok}");
        }
        assert!(read_tiled_file(Path::new("relative.tmx")).unwrap_err().contains("absolute"));
        std::fs::write(dir.path().join("secret.txt"), b"x").unwrap();
        assert!(read_tiled_file(&dir.path().join("secret.txt")).unwrap_err().contains("unsupported"));
        assert_eq!(read_tiled_file(&dir.path().join("missing.tsx")).unwrap_err(), "not found");
        std::fs::create_dir(dir.path().join("folder.png")).unwrap();
        assert_eq!(read_tiled_file(&dir.path().join("folder.png")).unwrap_err(), "not found");
        let big = dir.path().join("big.png");
        std::fs::File::create(&big).unwrap().set_len(TILED_MAX_BYTES + 1).unwrap();
        assert!(read_tiled_file(&big).unwrap_err().contains("too large"));
    }
}
