use yot_server::auth::{apikey, pairing, rate_limit};
use yot_server::db::schema;

fn setup() -> rusqlite::Connection {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    schema::initialize(&conn).unwrap();
    conn
}

#[test]
fn hash_key_deterministic() {
    assert_eq!(apikey::hash_key("abc"), apikey::hash_key("abc"));
    assert_ne!(apikey::hash_key("abc"), apikey::hash_key("abd"));
}

#[test]
fn create_returns_key_with_cal_prefix() {
    let conn = setup();
    let (record, raw) = apikey::create(&conn, "mobile", "write").unwrap();
    assert!(raw.starts_with("cal_"));
    assert_eq!(record.name, "mobile");
    assert_eq!(record.scope, "write");
    assert_eq!(record.revoked, false);
}

#[test]
fn authenticate_resolves_valid_key() {
    let conn = setup();
    let (record, raw) = apikey::create(&conn, "cli", "read").unwrap();
    let found = apikey::authenticate(&conn, &raw).unwrap();
    assert_eq!(found.id, record.id);
    assert_eq!(found.scope, "read");
}

#[test]
fn authenticate_rejects_unknown_key() {
    let conn = setup();
    let err = apikey::authenticate(&conn, "cal_wrong").unwrap_err();
    assert_eq!(err.code, "unauthorized");
}

#[test]
fn revoked_key_cannot_authenticate() {
    let conn = setup();
    let (record, raw) = apikey::create(&conn, "temp", "write").unwrap();
    apikey::revoke_by_id(&conn, &record.id).unwrap();
    let err = apikey::authenticate(&conn, &raw).unwrap_err();
    assert_eq!(err.code, "unauthorized");
}

#[test]
fn authenticate_updates_last_used() {
    let conn = setup();
    let (record, raw) = apikey::create(&conn, "x", "write").unwrap();
    assert_eq!(record.last_used_at, None);
    let found = apikey::authenticate(&conn, &raw).unwrap();
    assert!(found.last_used_at.is_some());
}

#[test]
fn pairing_generate_and_redeem() {
    let svc = pairing::PairingService::new();
    let pin = svc.generate_pin("write");
    assert_eq!(pin.len(), 6);
    let scope = svc.redeem(&pin).unwrap();
    assert_eq!(scope, "write");
}

#[test]
fn pairing_one_time_use() {
    let svc = pairing::PairingService::new();
    let pin = svc.generate_pin("read");
    svc.redeem(&pin).unwrap();
    assert!(svc.redeem(&pin).is_none());
}

#[test]
fn pairing_invalid_pin() {
    let svc = pairing::PairingService::new();
    assert!(svc.redeem("000000").is_none());
}

#[test]
fn rate_limiter_allows_under_limit() {
    let limiter = rate_limit::RateLimiter::new();
    let ip: std::net::IpAddr = "127.0.0.1".parse().unwrap();
    for _ in 0..5 {
        assert!(limiter.check(ip));
        limiter.record_failure(ip);
    }
    assert!(!limiter.check(ip));
}

#[test]
fn rate_limiter_clear_resets() {
    let limiter = rate_limit::RateLimiter::new();
    let ip: std::net::IpAddr = "127.0.0.1".parse().unwrap();
    for _ in 0..5 {
        limiter.record_failure(ip);
    }
    assert!(!limiter.check(ip));
    limiter.clear(ip);
    assert!(limiter.check(ip));
}
