// ports: src/auth/pairing.ts
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use sha2::{Sha256, Digest};

const PIN_TTL: Duration = Duration::from_secs(300);

struct PinEntry {
    scope: String,
    created_at: Instant,
}

pub struct PairingService {
    pins: Mutex<HashMap<String, PinEntry>>,
}

impl PairingService {
    pub fn new() -> Self {
        Self {
            pins: Mutex::new(HashMap::new()),
        }
    }

    pub fn generate_pin(&self, scope: &str) -> String {
        let pin_num: u32 = rand::random_range(0..1_000_000);
        let pin = format!("{:06}", pin_num);

        let pin_hash = hash_pin(&pin);
        let mut pins = self.pins.lock().unwrap();
        pins.insert(pin_hash, PinEntry {
            scope: scope.to_string(),
            created_at: Instant::now(),
        });
        pin
    }

    pub fn redeem(&self, pin: &str) -> Option<String> {
        let pin_hash = hash_pin(pin);
        let mut pins = self.pins.lock().unwrap();
        let entry = pins.remove(&pin_hash)?;
        if entry.created_at.elapsed() > PIN_TTL {
            return None;
        }
        Some(entry.scope)
    }
}

fn hash_pin(pin: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(pin.as_bytes());
    format!("{:x}", hasher.finalize())
}
