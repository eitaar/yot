// ports: src/services/calendar.service.ts
use rusqlite::Connection;
use crate::core::error::AppError;
use crate::core::id::new_id;
use crate::core::time::now_iso;
use crate::models::{Calendar, CreateCalendarInput, UpdateCalendarInput};

pub fn list(conn: &Connection) -> Result<Vec<Calendar>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, color, description, created_at, updated_at FROM calendars ORDER BY name",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Calendar {
            id: row.get(0)?,
            name: row.get(1)?,
            color: row.get(2)?,
            description: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get(conn: &Connection, id: &str) -> Result<Calendar, AppError> {
    conn.query_row(
        "SELECT id, name, color, description, created_at, updated_at FROM calendars WHERE id = ?",
        [id],
        |row| {
            Ok(Calendar {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                description: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        },
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::not_found("Not found"),
        other => other.into(),
    })
}

pub fn create(conn: &Connection, input: CreateCalendarInput) -> Result<Calendar, AppError> {
    if input.name.is_empty() {
        return Err(AppError::validation("Validation failed", None));
    }
    let id = new_id();
    let now = now_iso();
    conn.execute(
        "INSERT INTO calendars (id, name, color, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        rusqlite::params![id, input.name, input.color, input.description, now, now],
    )?;
    get(conn, &id)
}

pub fn update(conn: &Connection, id: &str, input: UpdateCalendarInput) -> Result<Calendar, AppError> {
    let existing = get(conn, id)?;
    let now = now_iso();

    let name = input.name.unwrap_or(existing.name);
    if name.is_empty() {
        return Err(AppError::validation("Validation failed", None));
    }
    let color = match input.color {
        Some(v) => v,
        None => existing.color,
    };
    let description = match input.description {
        Some(v) => v,
        None => existing.description,
    };

    conn.execute(
        "UPDATE calendars SET name = ?, color = ?, description = ?, updated_at = ? WHERE id = ?",
        rusqlite::params![name, color, description, now, id],
    )?;
    get(conn, id)
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), AppError> {
    let changes = conn.execute("DELETE FROM calendars WHERE id = ?", [id])?;
    if changes == 0 {
        return Err(AppError::not_found("Not found"));
    }
    Ok(())
}

pub fn exists(conn: &Connection, id: &str) -> Result<bool, AppError> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM calendars WHERE id = ?",
        [id],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}
