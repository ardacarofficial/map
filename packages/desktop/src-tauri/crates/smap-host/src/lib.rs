//! Harita Tasarlayıcı masaüstü kabuğunun Tauri'den bağımsız çekirdeği.
//!
//! Tauri glue (`src-tauri/src/lib.rs`) bu crate'i çağıran ince bir katmandır;
//! burada GTK/WebView2 yok, her şey `cargo test` ile ekransız denenir.

pub mod atomic;
pub mod host;
pub mod logfile;
pub mod recent;
pub mod scope;
pub mod watch;

pub use host::{find_open_arg, percent_decode, ErrorKind, Host, HostError, HostResult, OpenedProject};
pub use watch::{ChangeKind, FileChange};
