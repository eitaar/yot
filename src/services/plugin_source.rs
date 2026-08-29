use rusqlite::params;
use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::core::error::AppError;

/// `source` block of a plugin spec: binds the plugin to a calendar whose
/// events become the plugin's `data.items` (server-side merge).
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceSpec {
    #[serde(rename = "calendarId")]
    pub calendar_id: String,
    #[serde(default, rename = "type")]
    pub item_type: Option<String>,
    #[serde(default, rename = "franchiseField")]
    pub franchise_field: Option<String>,
    #[serde(default, rename = "franchiseDefault")]
    pub franchise_default: Option<String>,
    #[serde(default)]
    pub map: std::collections::HashMap<String, String>,
}

impl SourceSpec {
    /// Parse and validate the `source` value of a spec. `Err` means the
    /// binding is unusable and the caller should fall back to static items.
    pub fn from_value(v: &Value) -> Result<SourceSpec, String> {
        serde_json::from_value::<SourceSpec>(v.clone()).map_err(|e| e.to_string())
    }
}

const RESERVED: &[&str] = &["id", "title", "start", "end", "desc", "franchise", "type"];
const MERGE_LIMIT: i64 = 200;

/// Load events for a bound calendar and map them into plugin items.
///
/// Hidden events ARE included — plugins are allowed to see them (spec §4).
/// The item contract (client `ItemSchema`): id, title, franchise, type,
/// start (string), end (string), desc — always present on every item.
pub fn merge_items(conn: &rusqlite::Connection, src: &SourceSpec) -> Result<Vec<Value>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, title, description, context, start_at, end_at FROM events \
         WHERE calendar_id = ? ORDER BY start_at LIMIT ?",
    )?;
    let rows: Vec<(String, String, Option<String>, Option<String>, String, String)> = stmt
        .query_map(
            params![src.calendar_id, MERGE_LIMIT],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )?
        .collect::<Result<Vec<_>, _>>()?;

    let mut items = Vec::new();
    for (id, title, description, context, start_at, end_at) in rows {
        let ctx: Value = match context.as_deref() {
            Some(s) => serde_json::from_str(s).unwrap_or_else(|e| {
                tracing::warn!("plugin source: broken context JSON on event {id}: {e}");
                json!({})
            }),
            None => json!({}),
        };
        let ctx_obj = match ctx {
            Value::Object(m) => m,
            _ => {
                tracing::warn!("plugin source: non-object context on event {id}, ignored");
                Map::new()
            }
        };

        let franchise = src
            .franchise_field
            .as_ref()
            .and_then(|f| ctx_obj.get(f))
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .or_else(|| src.franchise_default.clone())
            .unwrap_or_else(|| "default".to_string());

        let mut item = Map::new();
        item.insert("id".into(), json!(format!("ev:{id}")));
        item.insert("title".into(), json!(title));
        item.insert("start".into(), json!(start_at));
        item.insert("end".into(), json!(end_at));
        item.insert("desc".into(), json!(description.unwrap_or_default()));
        item.insert(
            "type".into(),
            json!(src.item_type.clone().unwrap_or_else(|| "item".into())),
        );
        item.insert("franchise".into(), json!(franchise));

        // Spread non-reserved context keys, applying renames.
        // `map` is written itemKey: contextKey (e.g. "flight": "flight_no"
        // means item.flight comes from context.flight_no), so reverse it.
        let renames: std::collections::HashMap<&String, &String> =
            src.map.iter().map(|(item_key, ctx_key)| (ctx_key, item_key)).collect();
        for (k, v) in ctx_obj {
            if RESERVED.contains(&k.as_str()) || Some(&k) == src.franchise_field.as_ref() {
                continue;
            }
            let out_key = renames.get(&k).cloned().cloned().unwrap_or_else(|| k.clone());
            // Post-rename guard: a rename must not overwrite server-derived
            // contract fields either (e.g. map renames some context key to "title").
            if RESERVED.contains(&out_key.as_str()) {
                tracing::warn!("plugin source: context key {k} maps to reserved item field {out_key}, ignored");
                continue;
            }
            item.insert(out_key, v);
        }
        items.push(Value::Object(item));
    }
    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn_with_events() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::schema::initialize(&conn).unwrap();
        conn.execute(
            "INSERT INTO calendars (id, name, created_at, updated_at) VALUES ('flights', 'Flights', '2026-01-01', '2026-01-01')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO events (id, calendar_id, title, description, context, start_at, end_at, all_day, visible, created_at, updated_at) VALUES
            ('e1', 'flights', 'HND → LHR', 'Terminal 3 · Gate 65', '{\"airline\": \"JAL\", \"flight_no\": \"JL041\", \"gate\": \"65\", \"status\": \"Scheduled\"}', '2026-08-28T10:00:00.000Z', '2026-08-28T10:00:00.000Z', 0, 1, '2026-01-01', '2026-01-01'),
            ('e2', 'flights', 'NRT → SEA', 'Delayed 40 min', '{\"airline\": \"Delta\", \"flight_no\": \"DL276\", \"status\": \"Delayed\"}', '2026-09-06T05:00:00.000Z', '2026-09-06T05:00:00.000Z', 0, 1, '2026-01-01', '2026-01-01'),
            ('e3', 'flights', 'Broken ctx', NULL, 'not json{', '2026-09-07T05:00:00.000Z', '2026-09-07T06:00:00.000Z', 0, 1, '2026-01-01', '2026-01-01')",
            [],
        ).unwrap();
        conn
    }

    fn flights_source() -> SourceSpec {
        SourceSpec {
            calendar_id: "flights".into(),
            item_type: Some("flight".into()),
            franchise_field: Some("airline".into()),
            franchise_default: None,
            map: [
                ("flight".to_string(), "flight_no".to_string()),
                ("status".to_string(), "status".to_string()),
            ]
            .into_iter()
            .collect(),
        }
    }

    #[test]
    fn merge_maps_events_to_items() {
        let conn = conn_with_events();
        let items = merge_items(&conn, &flights_source()).unwrap();
        assert_eq!(items.len(), 3);

        let first = &items[0];
        assert_eq!(first["id"], "ev:e1");
        assert_eq!(first["title"], "HND → LHR");
        assert_eq!(first["start"], "2026-08-28T10:00:00.000Z");
        assert_eq!(first["end"], "2026-08-28T10:00:00.000Z");
        assert_eq!(first["desc"], "Terminal 3 · Gate 65");
        assert_eq!(first["type"], "flight");
        assert_eq!(first["franchise"], "JAL");
        assert_eq!(first["flight"], "JL041"); // map: flight ← flight_no
        assert_eq!(first["gate"], "65");
        assert_eq!(first["status"], "Scheduled");

        let second = &items[1];
        assert_eq!(second["franchise"], "Delta");
        assert!(second.get("gate").is_none()); // absent in context → absent in item
    }

    #[test]
    fn broken_context_never_drops_event() {
        let conn = conn_with_events();
        let items = merge_items(&conn, &flights_source()).unwrap();
        assert_eq!(items.len(), 3);
        let broken = items.iter().find(|i| i["id"] == "ev:e3").unwrap();
        assert_eq!(broken["title"], "Broken ctx");
        assert_eq!(broken["desc"], "");
        assert_eq!(broken["type"], "flight");
        assert_eq!(broken["franchise"], "default");
    }

    #[test]
    fn franchise_falls_back_to_default() {
        let conn = conn_with_events();
        let mut src = flights_source();
        src.franchise_default = Some("ANA".into());
        let items = merge_items(&conn, &src).unwrap();
        let broken = items.iter().find(|i| i["id"] == "ev:e3").unwrap();
        assert_eq!(broken["franchise"], "ANA");
    }

    #[test]
    fn unknown_calendar_yields_empty() {
        let conn = conn_with_events();
        let src = SourceSpec {
            calendar_id: "nope".into(),
            item_type: None,
            franchise_field: None,
            franchise_default: None,
            map: Default::default(),
        };
        let items = merge_items(&conn, &src).unwrap();
        assert!(items.is_empty());
    }

    #[test]
    fn source_spec_rejects_bad_shape() {
        let v = json!({ "calendarId": 42 });
        assert!(SourceSpec::from_value(&v).is_err());
        let v = json!({});
        assert!(SourceSpec::from_value(&v).is_err());
        // Typos must not be silently accepted — invalid source falls back to
        // static items, so an ignored key here would flip the whole binding.
        let v = json!({ "calendarId": "flights", "franchiseFiled": "airline" });
        assert!(SourceSpec::from_value(&v).is_err());
    }

    #[test]
    fn reserved_fields_survive_context_and_renames() {
        let conn = conn_with_events();
        // 1) context "type" must not replace source.type
        conn.execute(
            "UPDATE events SET context = '{\"type\": \"hotel\", \"airline\": \"ANA\"}' WHERE id = 'e1'",
            [],
        ).unwrap();
        let src = SourceSpec {
            calendar_id: "flights".into(),
            item_type: Some("flight".into()),
            franchise_field: Some("airline".into()),
            franchise_default: None,
            map: [("flight".to_string(), "flight_no".to_string())].into_iter().collect(),
        };
        let items = merge_items(&conn, &src).unwrap();
        let e1 = items.iter().find(|i| i["id"] == "ev:e1").unwrap();
        assert_eq!(e1["type"], "flight");
        assert_eq!(e1["franchise"], "ANA");

        // 2) rename onto a reserved key must not overwrite the contract field
        conn.execute(
            "UPDATE events SET context = '{\"t\": \"shadow\", \"flight_no\": \"XX999\"}' WHERE id = 'e2'",
            [],
        ).unwrap();
        let src = SourceSpec {
            calendar_id: "flights".into(),
            item_type: Some("flight".into()),
            franchise_field: None,
            franchise_default: None,
            map: [("title".to_string(), "t".to_string())].into_iter().collect(),
        };
        let items = merge_items(&conn, &src).unwrap();
        let e2 = items.iter().find(|i| i["id"] == "ev:e2").unwrap();
        assert_eq!(e2["title"], "NRT → SEA"); // server-derived value intact
        assert_eq!(e2["flight_no"], "XX999"); // unrenamed context key still spread
    }
}
