// ports: src/services/event.service.ts
use rusqlite::{Connection, params};
use crate::core::error::AppError;
use crate::core::id::new_id;
use crate::core::time::{now_iso, parse_js_date};
use crate::models::*;
use crate::services::calendar;

pub fn list(conn: &Connection, query: &EventQuery) -> Result<Vec<Event>, AppError> {
    let mut sql = String::from(
        "SELECT e.id, e.calendar_id, e.title, e.description, e.context, e.location, \
         e.start_at, e.end_at, e.all_day, e.image_path, e.url, e.source_uid, \
         e.created_at, e.updated_at FROM events e",
    );
    let mut conditions: Vec<String> = Vec::new();
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if query.tag.is_some() {
        sql.push_str(" JOIN event_tags et ON et.event_id = e.id JOIN tags t ON t.id = et.tag_id");
    }

    if let Some(ref cal_id) = query.calendar_id {
        conditions.push("e.calendar_id = ?".to_string());
        param_values.push(Box::new(cal_id.clone()));
    }
    if let Some(ref from) = query.from {
        conditions.push("e.start_at >= ?".to_string());
        param_values.push(Box::new(from.clone()));
    }
    if let Some(ref to) = query.to {
        conditions.push("e.start_at <= ?".to_string());
        param_values.push(Box::new(to.clone()));
    }
    if let Some(ref tag) = query.tag {
        conditions.push("t.name = ?".to_string());
        param_values.push(Box::new(tag.clone()));
    }
    if let Some(ref q) = query.q {
        conditions.push("(e.title LIKE ? OR e.description LIKE ?)".to_string());
        let pattern = format!("%{q}%");
        param_values.push(Box::new(pattern.clone()));
        param_values.push(Box::new(pattern));
    }

    if !conditions.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&conditions.join(" AND "));
    }

    sql.push_str(" ORDER BY e.start_at");

    let limit = query.limit.unwrap_or(50).clamp(1, 500);
    let offset = query.offset.unwrap_or(0).max(0);
    sql.push_str(&format!(" LIMIT {} OFFSET {}", limit, offset));

    let mut stmt = conn.prepare(&sql)?;
    let params_ref: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
    let rows = stmt.query_map(params_ref.as_slice(), |row| {
        Ok(EventRow {
            id: row.get(0)?,
            calendar_id: row.get(1)?,
            title: row.get(2)?,
            description: row.get(3)?,
            context: row.get(4)?,
            location: row.get(5)?,
            start_at: row.get(6)?,
            end_at: row.get(7)?,
            all_day: row.get::<_, i64>(8)? != 0,
            image_path: row.get(9)?,
            url: row.get(10)?,
            source_uid: row.get(11)?,
            created_at: row.get(12)?,
            updated_at: row.get(13)?,
        })
    })?;

    let event_rows: Vec<EventRow> = rows.collect::<Result<Vec<_>, _>>()?;
    if event_rows.is_empty() {
        return Ok(Vec::new());
    }

    let ids: Vec<&str> = event_rows.iter().map(|r| r.id.as_str()).collect();
    let tags_map = batch_tags(conn, &ids)?;
    let reminders_map = batch_reminders(conn, &ids)?;

    Ok(event_rows
        .into_iter()
        .map(|r| {
            let tags = tags_map.get(&r.id).cloned().unwrap_or_default();
            let reminders = reminders_map.get(&r.id).cloned().unwrap_or_default();
            r.into_event(tags, reminders)
        })
        .collect())
}

pub fn get(conn: &Connection, id: &str) -> Result<Event, AppError> {
    let row = conn
        .query_row(
            "SELECT id, calendar_id, title, description, context, location, start_at, end_at, \
             all_day, image_path, url, source_uid, created_at, updated_at \
             FROM events WHERE id = ?",
            [id],
            |row| {
                Ok(EventRow {
                    id: row.get(0)?,
                    calendar_id: row.get(1)?,
                    title: row.get(2)?,
                    description: row.get(3)?,
                    context: row.get(4)?,
                    location: row.get(5)?,
                    start_at: row.get(6)?,
                    end_at: row.get(7)?,
                    all_day: row.get::<_, i64>(8)? != 0,
                    image_path: row.get(9)?,
                    url: row.get(10)?,
                    source_uid: row.get(11)?,
                    created_at: row.get(12)?,
                    updated_at: row.get(13)?,
                })
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::not_found("Not found"),
            other => other.into(),
        })?;

    let ids = [row.id.as_str()];
    let tags_map = batch_tags(conn, &ids)?;
    let reminders_map = batch_reminders(conn, &ids)?;
    let tags = tags_map.get(&row.id).cloned().unwrap_or_default();
    let reminders = reminders_map.get(&row.id).cloned().unwrap_or_default();
    Ok(row.into_event(tags, reminders))
}

pub fn create(conn: &Connection, input: CreateEventInput) -> Result<Event, AppError> {
    if input.title.is_empty() {
        return Err(AppError::validation("Validation failed", None));
    }
    if !calendar::exists(conn, &input.calendar_id)? {
        return Err(AppError::validation("Calendar not found", None));
    }
    validate_date_range(&input.start_at, &input.end_at)?;

    let id = new_id();
    let now = now_iso();
    conn.execute(
        "INSERT INTO events (id, calendar_id, title, description, context, location, start_at, end_at, \
         all_day, image_path, url, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            id,
            input.calendar_id,
            input.title,
            input.description,
            input.context,
            input.location,
            input.start_at,
            input.end_at,
            input.all_day as i64,
            input.image_path,
            input.url,
            now,
            now,
        ],
    )?;
    get(conn, &id)
}

pub fn update(conn: &Connection, id: &str, input: UpdateEventInput) -> Result<Event, AppError> {
    let existing = get(conn, id)?;
    let now = now_iso();

    if let Some(ref cal_id) = input.calendar_id {
        if !calendar::exists(conn, cal_id)? {
            return Err(AppError::validation("Calendar not found", None));
        }
    }

    let calendar_id = input.calendar_id.unwrap_or(existing.calendar_id);
    let title = input.title.unwrap_or(existing.title);
    if title.is_empty() {
        return Err(AppError::validation("Validation failed", None));
    }
    let start_at = input.start_at.unwrap_or(existing.start_at);
    let end_at = input.end_at.unwrap_or(existing.end_at);
    validate_date_range(&start_at, &end_at)?;

    let all_day = input.all_day.unwrap_or(existing.all_day);
    let description = match input.description {
        Some(v) => v,
        None => existing.description,
    };
    let context = match input.context {
        Some(v) => v,
        None => existing.context,
    };
    let location = match input.location {
        Some(v) => v,
        None => existing.location,
    };
    let url = match input.url {
        Some(v) => v,
        None => existing.url,
    };
    let old_image = existing.image_path.clone();
    let image_path = match input.image_path {
        Some(v) => v,
        None => existing.image_path,
    };

    conn.execute(
        "UPDATE events SET calendar_id=?, title=?, description=?, context=?, location=?, \
         start_at=?, end_at=?, all_day=?, image_path=?, url=?, updated_at=? WHERE id=?",
        params![
            calendar_id, title, description, context, location, start_at, end_at,
            all_day as i64, image_path, url, now, id,
        ],
    )?;

    if old_image != image_path {
        if let Some(ref old) = old_image {
            let _ = try_delete_image(old);
        }
    }

    get(conn, id)
}

pub fn delete(conn: &Connection, id: &str) -> Result<Option<String>, AppError> {
    let image_path: Option<String> = conn
        .query_row("SELECT image_path FROM events WHERE id = ?", [id], |row| row.get(0))
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::not_found("Not found"),
            other => other.into(),
        })?;

    let changes = conn.execute("DELETE FROM events WHERE id = ?", [id])?;
    if changes == 0 {
        return Err(AppError::not_found("Not found"));
    }

    if let Some(ref img) = image_path {
        let _ = try_delete_image(img);
    }

    Ok(image_path)
}

pub fn add_tag(conn: &Connection, event_id: &str, tag_id: &str) -> Result<Event, AppError> {
    let _ = get(conn, event_id)?;
    let tag_exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tags WHERE id = ?", [tag_id], |r| r.get(0),
    )?;
    if tag_exists == 0 {
        return Err(AppError::not_found("Not found"));
    }

    conn.execute(
        "INSERT OR IGNORE INTO event_tags (event_id, tag_id) VALUES (?, ?)",
        params![event_id, tag_id],
    )?;

    let now = now_iso();
    conn.execute("UPDATE events SET updated_at = ? WHERE id = ?", params![now, event_id])?;
    get(conn, event_id)
}

pub fn remove_tag(conn: &Connection, event_id: &str, tag_id: &str) -> Result<Event, AppError> {
    let _ = get(conn, event_id)?;
    let tag_exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tags WHERE id = ?", [tag_id], |r| r.get(0),
    )?;
    if tag_exists == 0 {
        return Err(AppError::not_found("Not found"));
    }

    conn.execute(
        "DELETE FROM event_tags WHERE event_id = ? AND tag_id = ?",
        params![event_id, tag_id],
    )?;

    let now = now_iso();
    conn.execute("UPDATE events SET updated_at = ? WHERE id = ?", params![now, event_id])?;
    get(conn, event_id)
}

pub fn add_reminder(conn: &Connection, event_id: &str, input: CreateReminderInput) -> Result<Reminder, AppError> {
    let _ = get(conn, event_id)?;
    if input.minutes_before < 0 {
        return Err(AppError::validation("minutes_before must be >= 0", None));
    }
    let id = new_id();
    conn.execute(
        "INSERT INTO reminders (id, event_id, minutes_before, method) VALUES (?, ?, ?, ?)",
        params![id, event_id, input.minutes_before, input.method],
    )?;
    Ok(Reminder { id, event_id: event_id.to_string(), minutes_before: input.minutes_before, method: input.method })
}

pub fn remove_reminder(conn: &Connection, event_id: &str, reminder_id: &str) -> Result<(), AppError> {
    let changes = conn.execute(
        "DELETE FROM reminders WHERE id = ? AND event_id = ?",
        params![reminder_id, event_id],
    )?;
    if changes == 0 {
        return Err(AppError::not_found("Not found"));
    }
    Ok(())
}

fn validate_date_range(start: &str, end: &str) -> Result<(), AppError> {
    let s = parse_js_date(start).ok_or_else(|| AppError::validation("Invalid start_at", None))?;
    let e = parse_js_date(end).ok_or_else(|| AppError::validation("Invalid end_at", None))?;
    if s > e {
        return Err(AppError::validation("start_at must be <= end_at", None));
    }
    Ok(())
}

fn try_delete_image(filename: &str) {
    let img_dir = std::env::var("IMG_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| crate::config::default_data_dir().join("img"));
    let path = img_dir.join(filename);
    let _ = std::fs::remove_file(path);
}

struct EventRow {
    id: String,
    calendar_id: String,
    title: String,
    description: Option<String>,
    context: Option<String>,
    location: Option<String>,
    start_at: String,
    end_at: String,
    all_day: bool,
    image_path: Option<String>,
    url: Option<String>,
    source_uid: Option<String>,
    created_at: String,
    updated_at: String,
}

impl EventRow {
    fn into_event(self, tags: Vec<String>, reminders: Vec<Reminder>) -> Event {
        Event {
            id: self.id,
            calendar_id: self.calendar_id,
            title: self.title,
            description: self.description,
            context: self.context,
            location: self.location,
            start_at: self.start_at,
            end_at: self.end_at,
            all_day: self.all_day,
            image_path: self.image_path,
            url: self.url,
            source_uid: self.source_uid,
            created_at: self.created_at,
            updated_at: self.updated_at,
            tags,
            reminders,
        }
    }
}

fn batch_tags(conn: &Connection, ids: &[&str]) -> Result<std::collections::HashMap<String, Vec<String>>, AppError> {
    if ids.is_empty() {
        return Ok(std::collections::HashMap::new());
    }
    let placeholders: String = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT et.event_id, t.name FROM event_tags et \
         JOIN tags t ON t.id = et.tag_id \
         WHERE et.event_id IN ({}) ORDER BY t.name",
        placeholders
    );
    let mut stmt = conn.prepare(&sql)?;
    let params: Vec<&dyn rusqlite::types::ToSql> = ids.iter().map(|id| id as &dyn rusqlite::types::ToSql).collect();
    let rows = stmt.query_map(params.as_slice(), |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    let mut map: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    for row in rows {
        let (event_id, tag_name) = row?;
        map.entry(event_id).or_default().push(tag_name);
    }
    Ok(map)
}

fn batch_reminders(conn: &Connection, ids: &[&str]) -> Result<std::collections::HashMap<String, Vec<Reminder>>, AppError> {
    if ids.is_empty() {
        return Ok(std::collections::HashMap::new());
    }
    let placeholders: String = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT id, event_id, minutes_before, method FROM reminders \
         WHERE event_id IN ({}) ORDER BY minutes_before DESC",
        placeholders
    );
    let mut stmt = conn.prepare(&sql)?;
    let params: Vec<&dyn rusqlite::types::ToSql> = ids.iter().map(|id| id as &dyn rusqlite::types::ToSql).collect();
    let rows = stmt.query_map(params.as_slice(), |row| {
        Ok(Reminder {
            id: row.get(0)?,
            event_id: row.get(1)?,
            minutes_before: row.get(2)?,
            method: row.get(3)?,
        })
    })?;

    let mut map: std::collections::HashMap<String, Vec<Reminder>> = std::collections::HashMap::new();
    for row in rows {
        let r = row?;
        map.entry(r.event_id.clone()).or_default().push(r);
    }
    Ok(map)
}
