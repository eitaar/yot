// ports: src/services/import.service.ts
use rusqlite::Connection;
use crate::core::error::AppError;
use crate::core::id::new_id;
use crate::core::time::now_iso;
use crate::models::ImportResult;
use crate::services::calendar;

const MAX_ICS_SIZE: usize = 10 * 1024 * 1024;

pub fn import_ics(conn: &Connection, calendar_id: &str, data: &[u8]) -> Result<ImportResult, AppError> {
    if data.len() > MAX_ICS_SIZE {
        return Err(AppError::validation("File too large (max 10MB)", None));
    }
    if !calendar::exists(conn, calendar_id)? {
        return Err(AppError::not_found("Calendar not found"));
    }

    let text = String::from_utf8_lossy(data);
    let events = parse_ics(&text);

    let mut result = ImportResult {
        created: 0,
        skipped_recurring: 0,
        skipped_duplicate: 0,
        errors: Vec::new(),
    };

    let now = now_iso();

    for vevent in events {
        if vevent.has_rrule {
            result.skipped_recurring += 1;
            continue;
        }

        let uid = vevent.uid.as_deref().unwrap_or("no-uid");

        let dtstart = match vevent.dtstart {
            Some(ref s) => s.clone(),
            None => {
                result.errors.push(format!("{} VEVENT has no DTSTART; skipped", uid));
                continue;
            }
        };

        if let Some(ref source_uid) = vevent.uid {
            let exists: i64 = conn.query_row(
                "SELECT COUNT(*) FROM events WHERE source_uid = ? AND calendar_id = ?",
                rusqlite::params![source_uid, calendar_id],
                |r| r.get(0),
            )?;
            if exists > 0 {
                result.skipped_duplicate += 1;
                continue;
            }
        }

        let dtend = vevent.dtend.unwrap_or_else(|| dtstart.clone());
        let all_day = vevent.all_day;
        let title = vevent.summary.unwrap_or_else(|| "Untitled".to_string());

        let id = new_id();
        conn.execute(
            "INSERT INTO events (id, calendar_id, title, description, location, \
             start_at, end_at, all_day, source_uid, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            rusqlite::params![
                id, calendar_id, title, vevent.description, vevent.location,
                dtstart, dtend, all_day as i64, vevent.uid, now, now,
            ],
        )?;
        result.created += 1;
    }

    Ok(result)
}

struct VEvent {
    uid: Option<String>,
    summary: Option<String>,
    description: Option<String>,
    location: Option<String>,
    dtstart: Option<String>,
    dtend: Option<String>,
    all_day: bool,
    has_rrule: bool,
}

fn parse_ics(text: &str) -> Vec<VEvent> {
    let unfolded = unfold_lines(text);
    let mut events = Vec::new();
    let mut in_event = false;
    let mut current = new_vevent();

    for line in unfolded.lines() {
        let line = line.trim_end();
        if line.eq_ignore_ascii_case("BEGIN:VEVENT") {
            in_event = true;
            current = new_vevent();
        } else if line.eq_ignore_ascii_case("END:VEVENT") {
            in_event = false;
            events.push(current);
            current = new_vevent();
        } else if in_event {
            if let Some((name, params, value)) = parse_content_line(line) {
                match name.to_uppercase().as_str() {
                    "UID" => current.uid = Some(unescape(value)),
                    "SUMMARY" => current.summary = Some(unescape(value)),
                    "DESCRIPTION" => current.description = Some(unescape(value)),
                    "LOCATION" => current.location = Some(unescape(value)),
                    "DTSTART" => {
                        let is_date = params.iter().any(|p| p.to_uppercase().contains("VALUE=DATE"))
                            && !params.iter().any(|p| p.to_uppercase().contains("VALUE=DATE-TIME"));
                        current.all_day = is_date;
                        current.dtstart = Some(ical_datetime_to_iso(value, is_date));
                    }
                    "DTEND" => {
                        let is_date = params.iter().any(|p| p.to_uppercase().contains("VALUE=DATE"))
                            && !params.iter().any(|p| p.to_uppercase().contains("VALUE=DATE-TIME"));
                        current.dtend = Some(ical_datetime_to_iso(value, is_date));
                    }
                    "RRULE" => current.has_rrule = true,
                    _ => {}
                }
            }
        }
    }

    events
}

fn new_vevent() -> VEvent {
    VEvent {
        uid: None,
        summary: None,
        description: None,
        location: None,
        dtstart: None,
        dtend: None,
        all_day: false,
        has_rrule: false,
    }
}

fn unfold_lines(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    for line in text.lines() {
        if line.starts_with(' ') || line.starts_with('\t') {
            result.push_str(line.trim_start_matches([' ', '\t']));
        } else {
            if !result.is_empty() {
                result.push('\n');
            }
            result.push_str(line);
        }
    }
    result
}

fn parse_content_line(line: &str) -> Option<(&str, Vec<&str>, &str)> {
    let colon_pos = find_unquoted_colon(line)?;
    let name_params = &line[..colon_pos];
    let value = &line[colon_pos + 1..];

    let mut parts = name_params.splitn(2, ';');
    let name = parts.next()?;
    let params: Vec<&str> = parts.next().map(|p| p.split(';').collect()).unwrap_or_default();

    Some((name, params, value))
}

fn find_unquoted_colon(line: &str) -> Option<usize> {
    let mut in_quotes = false;
    for (i, ch) in line.char_indices() {
        match ch {
            '"' => in_quotes = !in_quotes,
            ':' if !in_quotes => return Some(i),
            _ => {}
        }
    }
    None
}

fn unescape(s: &str) -> String {
    s.replace("\\n", "\n")
        .replace("\\N", "\n")
        .replace("\\,", ",")
        .replace("\\;", ";")
        .replace("\\\\", "\\")
}

fn ical_datetime_to_iso(value: &str, is_date: bool) -> String {
    let v = value.trim();
    if is_date && v.len() == 8 {
        return format!("{}-{}-{}T00:00:00.000Z", &v[0..4], &v[4..6], &v[6..8]);
    }
    if v.len() >= 15 {
        let date = &v[0..8];
        let time = &v[9..15];
        let iso = format!(
            "{}-{}-{}T{}:{}:{}.000Z",
            &date[0..4], &date[4..6], &date[6..8],
            &time[0..2], &time[2..4], &time[4..6],
        );
        return iso;
    }
    v.to_string()
}
