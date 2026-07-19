// ports: src/services/tag.service.ts
use rusqlite::Connection;
use crate::core::error::AppError;
use crate::core::id::new_id;
use crate::models::{Tag, CreateTagInput, UpdateTagInput};

pub fn list(conn: &Connection) -> Result<Vec<Tag>, AppError> {
    let mut stmt = conn.prepare("SELECT id, name, color FROM tags ORDER BY name")?;
    let rows = stmt.query_map([], |row| {
        Ok(Tag {
            id: row.get(0)?,
            name: row.get(1)?,
            color: row.get(2)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get(conn: &Connection, id: &str) -> Result<Tag, AppError> {
    conn.query_row(
        "SELECT id, name, color FROM tags WHERE id = ?",
        [id],
        |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
            })
        },
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::not_found("Not found"),
        other => other.into(),
    })
}

pub fn create(conn: &Connection, input: CreateTagInput) -> Result<Tag, AppError> {
    if input.name.is_empty() {
        return Err(AppError::validation("Validation failed", None));
    }
    let id = new_id();
    match conn.execute(
        "INSERT INTO tags (id, name, color) VALUES (?, ?, ?)",
        rusqlite::params![id, input.name, input.color],
    ) {
        Ok(_) => get(conn, &id),
        Err(rusqlite::Error::SqliteFailure(err, _))
            if err.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE =>
        {
            Err(AppError::conflict(format!("Tag \"{}\" already exists", input.name)))
        }
        Err(e) => Err(e.into()),
    }
}

pub fn update(conn: &Connection, id: &str, input: UpdateTagInput) -> Result<Tag, AppError> {
    let existing = get(conn, id)?;

    let name = input.name.unwrap_or(existing.name);
    if name.is_empty() {
        return Err(AppError::validation("Validation failed", None));
    }
    let color = match input.color {
        Some(v) => v,
        None => existing.color,
    };

    match conn.execute(
        "UPDATE tags SET name = ?, color = ? WHERE id = ?",
        rusqlite::params![name, color, id],
    ) {
        Ok(_) => get(conn, id),
        Err(rusqlite::Error::SqliteFailure(err, _))
            if err.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE =>
        {
            Err(AppError::conflict(format!("Tag \"{}\" already exists", name)))
        }
        Err(e) => Err(e.into()),
    }
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), AppError> {
    let changes = conn.execute("DELETE FROM tags WHERE id = ?", [id])?;
    if changes == 0 {
        return Err(AppError::not_found("Not found"));
    }
    Ok(())
}
