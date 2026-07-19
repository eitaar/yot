// ports: src/auth/api-keys.ts
use rusqlite::Connection;
use sha2::{Sha256, Digest};
use base64::Engine;
use crate::core::error::AppError;
use crate::core::id::new_id;
use crate::core::time::now_iso;
use crate::models::ApiKey;

const KEY_PREFIX: &str = "cal_";

pub fn generate_key() -> String {
    let mut bytes = [0u8; 32];
    rand::fill(&mut bytes);
    let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);
    format!("{}{}", KEY_PREFIX, encoded)
}

pub fn hash_key(raw: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn create(conn: &Connection, name: &str, scope: &str) -> Result<(ApiKey, String), AppError> {
    let raw = generate_key();
    let key_hash = hash_key(&raw);
    let id = new_id();
    let now = now_iso();

    conn.execute(
        "INSERT INTO api_keys (id, name, key_hash, scope, revoked, created_at) VALUES (?, ?, ?, ?, 0, ?)",
        rusqlite::params![id, name, key_hash, scope, now],
    )?;

    let key = ApiKey {
        id,
        name: name.to_string(),
        key_hash,
        scope: scope.to_string(),
        revoked: false,
        created_at: now,
        last_used_at: None,
    };

    Ok((key, raw))
}

pub fn authenticate(conn: &Connection, raw: &str) -> Result<ApiKey, AppError> {
    let key_hash = hash_key(raw);
    let key = conn.query_row(
        "SELECT id, name, key_hash, scope, revoked, created_at, last_used_at \
         FROM api_keys WHERE key_hash = ? AND revoked = 0",
        [&key_hash],
        |row| {
            Ok(ApiKey {
                id: row.get(0)?,
                name: row.get(1)?,
                key_hash: row.get(2)?,
                scope: row.get(3)?,
                revoked: row.get::<_, i64>(4)? != 0,
                created_at: row.get(5)?,
                last_used_at: row.get(6)?,
            })
        },
    ).map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::unauthorized("Unauthorized"),
        other => other.into(),
    })?;

    let now = now_iso();
    let _ = conn.execute(
        "UPDATE api_keys SET last_used_at = ? WHERE id = ?",
        rusqlite::params![now, key.id],
    );

    Ok(ApiKey { last_used_at: Some(now), ..key })
}

pub fn revoke(conn: &Connection, raw: &str) -> Result<(), AppError> {
    let key_hash = hash_key(raw);
    conn.execute(
        "UPDATE api_keys SET revoked = 1 WHERE key_hash = ?",
        [&key_hash],
    )?;
    Ok(())
}

pub fn list_keys(conn: &Connection) -> Result<Vec<ApiKey>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, key_hash, scope, revoked, created_at, last_used_at FROM api_keys ORDER BY created_at",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(ApiKey {
            id: row.get(0)?,
            name: row.get(1)?,
            key_hash: row.get(2)?,
            scope: row.get(3)?,
            revoked: row.get::<_, i64>(4)? != 0,
            created_at: row.get(5)?,
            last_used_at: row.get(6)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn revoke_by_id(conn: &Connection, id: &str) -> Result<(), AppError> {
    let changes = conn.execute("UPDATE api_keys SET revoked = 1 WHERE id = ?", [id])?;
    if changes == 0 {
        return Err(AppError::not_found("Key not found"));
    }
    Ok(())
}
