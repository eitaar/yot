// ports: src/auth (inline rate-limit logic)
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::Instant;

const MAX_ATTEMPTS: u32 = 5;
const WINDOW_SECS: u64 = 60;

struct Bucket {
    count: u32,
    window_start: Instant,
}

pub struct RateLimiter {
    buckets: Mutex<HashMap<IpAddr, Bucket>>,
}

impl RateLimiter {
    pub fn new() -> Self {
        Self {
            buckets: Mutex::new(HashMap::new()),
        }
    }

    pub fn check(&self, ip: IpAddr) -> bool {
        let mut buckets = self.buckets.lock().unwrap();
        let now = Instant::now();

        let bucket = buckets.entry(ip).or_insert(Bucket {
            count: 0,
            window_start: now,
        });

        if now.duration_since(bucket.window_start).as_secs() >= WINDOW_SECS {
            bucket.count = 0;
            bucket.window_start = now;
        }

        bucket.count < MAX_ATTEMPTS
    }

    pub fn record_failure(&self, ip: IpAddr) {
        let mut buckets = self.buckets.lock().unwrap();
        let now = Instant::now();
        let bucket = buckets.entry(ip).or_insert(Bucket {
            count: 0,
            window_start: now,
        });

        if now.duration_since(bucket.window_start).as_secs() >= WINDOW_SECS {
            bucket.count = 1;
            bucket.window_start = now;
        } else {
            bucket.count += 1;
        }
    }

    pub fn clear(&self, ip: IpAddr) {
        let mut buckets = self.buckets.lock().unwrap();
        buckets.remove(&ip);
    }
}
