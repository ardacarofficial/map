//! Pencere kapatma kararı (X, Alt+F4, görev çubuğu).
//!
//! Ön yüz "kaydedilmemiş iş var mı" bilgisini sürekli bildirir. Yoksa pencere
//! hemen kapanır: sayfa donmuş olsa bile. Varsa kapatma durdurulur ve ön yüze
//! sorulur (Kaydet / Kaydetme / Vazgeç); ön yüz karar verince pencereyi
//! kendisi kapatır. Ön yüz soruyu aldığını (`ack`) belli bir süre içinde
//! bildirmezse donmuş sayılır ve bir sonraki kapatma isteği pencereyi kapatır.

use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Ön yüzün soruyu alıp almadığını beklediğimiz süre.
pub const ACK_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseDecision {
    /// Kaydedilmemiş iş yok (ya da ön yüz cevap vermiyor): kapat.
    Close,
    /// Kapatmayı durdur, ön yüze sor.
    Ask,
}

#[derive(Debug, Default)]
struct State {
    unsaved: bool,
    /// Sorulmuş ama ön yüzün henüz almadığı isteğin zamanı.
    unacked_since: Option<Instant>,
}

#[derive(Debug, Default)]
pub struct CloseGuard {
    state: Mutex<State>,
}

impl CloseGuard {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn set_unsaved(&self, unsaved: bool) {
        self.lock().unsaved = unsaved;
    }

    pub fn unsaved(&self) -> bool {
        self.lock().unsaved
    }

    /// Ön yüz kapatma sorusunu aldı.
    pub fn ack(&self) {
        self.lock().unacked_since = None;
    }

    /// Bir kapatma isteği geldi (`now` testte verilir).
    pub fn on_close_requested(&self, now: Instant) -> CloseDecision {
        let mut s = self.lock();
        if !s.unsaved {
            return CloseDecision::Close;
        }
        match s.unacked_since {
            Some(since) if now.saturating_duration_since(since) >= ACK_TIMEOUT => {
                s.unacked_since = None;
                CloseDecision::Close
            }
            Some(_) => CloseDecision::Ask,
            None => {
                s.unacked_since = Some(now);
                CloseDecision::Ask
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn closes_at_once_without_unsaved_work() {
        let g = CloseGuard::new();
        assert_eq!(g.on_close_requested(Instant::now()), CloseDecision::Close);
    }

    #[test]
    fn asks_while_unsaved_and_keeps_asking_once_acknowledged() {
        let g = CloseGuard::new();
        g.set_unsaved(true);
        let t0 = Instant::now();
        assert_eq!(g.on_close_requested(t0), CloseDecision::Ask);
        g.ack();
        // The user is looking at the dialog for a long time and clicks X again.
        assert_eq!(g.on_close_requested(t0 + Duration::from_secs(60)), CloseDecision::Ask);
        g.ack();
        g.set_unsaved(false);
        assert_eq!(g.on_close_requested(t0 + Duration::from_secs(61)), CloseDecision::Close);
    }

    #[test]
    fn a_hung_page_cannot_keep_the_window_open() {
        let g = CloseGuard::new();
        g.set_unsaved(true);
        let t0 = Instant::now();
        assert_eq!(g.on_close_requested(t0), CloseDecision::Ask);
        // No ack: a quick second click still waits, a later one closes.
        assert_eq!(g.on_close_requested(t0 + Duration::from_millis(500)), CloseDecision::Ask);
        assert_eq!(g.on_close_requested(t0 + ACK_TIMEOUT), CloseDecision::Close);
    }
}
