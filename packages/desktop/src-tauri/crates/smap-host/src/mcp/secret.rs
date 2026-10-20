use serde_json::{json, Value};
use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::PathBuf,
};

pub(super) fn random_hex() -> io::Result<String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| io::Error::other("OS random source unavailable"))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
/// Secret text never implements Debug and never enters general settings.
pub struct SecretFile {
    path: PathBuf,
}
impl SecretFile {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }
    pub fn load_or_create(&self) -> io::Result<String> {
        match fs::symlink_metadata(&self.path) {
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                let token = random_hex()?;
                self.store(&token)?;
                Ok(token)
            }
            Err(e) => Err(e),
            Ok(meta) => {
                if !meta.is_file() || meta.len() > 4096 {
                    return Err(io::Error::other("invalid AI secret file"));
                }
                let data: Value = serde_json::from_slice(&fs::read(&self.path)?)
                    .map_err(|_| io::Error::other("invalid AI secret file"))?;
                let token = data["token"]
                    .as_str()
                    .filter(|s| {
                        s.len() == 64
                            && s.bytes()
                                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
                    })
                    .ok_or_else(|| io::Error::other("invalid AI secret file"))?;
                if data["version"] != 1 {
                    return Err(io::Error::other("unsupported AI secret version"));
                }
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    fs::set_permissions(&self.path, fs::Permissions::from_mode(0o600))?;
                }
                Ok(token.to_string())
            }
        }
    }
    pub fn regenerate(&self) -> io::Result<String> {
        let token = random_hex()?;
        self.store(&token)?;
        Ok(token)
    }
    fn store(&self, token: &str) -> io::Result<()> {
        let parent = self
            .path
            .parent()
            .ok_or_else(|| io::Error::other("secret has no parent"))?;
        fs::create_dir_all(parent)?;
        let temp = parent.join(format!(".ai-secret-{}.smap-tmp", random_hex()?));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let result = (|| {
            let mut file = options.open(&temp)?;
            file.write_all((json!({"version":1,"token":token}).to_string() + "\n").as_bytes())?;
            file.sync_all()?;
            crate::atomic::replace_file(&temp, &self.path)
        })();
        if result.is_err() {
            let _ = fs::remove_file(temp);
        }
        result
    }
}
