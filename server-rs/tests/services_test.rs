use yot_server::db::Db;
use yot_server::models::*;
use yot_server::services::{calendar, event, tag};

fn setup() -> rusqlite::Connection {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    yot_server::db::schema::initialize(&conn).unwrap();
    conn
}

fn make_calendar(conn: &rusqlite::Connection) -> String {
    calendar::create(conn, CreateCalendarInput {
        name: "Work".to_string(),
        color: Some("#3b82f6".to_string()),
        description: None,
    }).unwrap().id
}

// --- Calendar tests ---

#[test]
fn calendar_create_persists_with_timestamps() {
    let conn = setup();
    let cal = calendar::create(&conn, CreateCalendarInput {
        name: "Work".to_string(),
        color: Some("#3b82f6".to_string()),
        description: None,
    }).unwrap();

    assert!(!cal.id.is_empty());
    assert_eq!(cal.name, "Work");
    assert_eq!(cal.color.as_deref(), Some("#3b82f6"));
    assert_eq!(cal.created_at, cal.updated_at);
}

#[test]
fn calendar_get_returns_created() {
    let conn = setup();
    let cal = calendar::create(&conn, CreateCalendarInput {
        name: "Personal".to_string(), color: None, description: None,
    }).unwrap();
    let fetched = calendar::get(&conn, &cal.id).unwrap();
    assert_eq!(fetched.id, cal.id);
    assert_eq!(fetched.name, "Personal");
}

#[test]
fn calendar_get_not_found() {
    let conn = setup();
    let err = calendar::get(&conn, "nope").unwrap_err();
    assert_eq!(err.code, "not_found");
}

#[test]
fn calendar_list_returns_all() {
    let conn = setup();
    calendar::create(&conn, CreateCalendarInput { name: "A".into(), color: None, description: None }).unwrap();
    calendar::create(&conn, CreateCalendarInput { name: "B".into(), color: None, description: None }).unwrap();
    assert_eq!(calendar::list(&conn).unwrap().len(), 2);
}

#[test]
fn calendar_update_changes_name() {
    let conn = setup();
    let cal = calendar::create(&conn, CreateCalendarInput { name: "Old".into(), color: None, description: None }).unwrap();
    let updated = calendar::update(&conn, &cal.id, UpdateCalendarInput {
        name: Some("New".to_string()), color: None, description: None,
    }).unwrap();
    assert_eq!(updated.name, "New");
    assert_eq!(updated.id, cal.id);
}

#[test]
fn calendar_update_not_found() {
    let conn = setup();
    let err = calendar::update(&conn, "nope", UpdateCalendarInput { name: Some("x".into()), color: None, description: None }).unwrap_err();
    assert_eq!(err.code, "not_found");
}

#[test]
fn calendar_delete_removes() {
    let conn = setup();
    let cal = calendar::create(&conn, CreateCalendarInput { name: "Temp".into(), color: None, description: None }).unwrap();
    calendar::delete(&conn, &cal.id).unwrap();
    let err = calendar::get(&conn, &cal.id).unwrap_err();
    assert_eq!(err.code, "not_found");
}

#[test]
fn calendar_delete_not_found() {
    let conn = setup();
    let err = calendar::delete(&conn, "nope").unwrap_err();
    assert_eq!(err.code, "not_found");
}

// --- Tag tests ---

#[test]
fn tag_create_persists() {
    let conn = setup();
    let t = tag::create(&conn, CreateTagInput { name: "important".into(), color: Some("#ef4444".into()) }).unwrap();
    assert!(!t.id.is_empty());
    assert_eq!(t.name, "important");
    assert_eq!(t.color.as_deref(), Some("#ef4444"));
}

#[test]
fn tag_create_duplicate_conflict() {
    let conn = setup();
    tag::create(&conn, CreateTagInput { name: "dup".into(), color: None }).unwrap();
    let err = tag::create(&conn, CreateTagInput { name: "dup".into(), color: None }).unwrap_err();
    assert_eq!(err.code, "conflict");
}

#[test]
fn tag_list_returns_all() {
    let conn = setup();
    tag::create(&conn, CreateTagInput { name: "a".into(), color: None }).unwrap();
    tag::create(&conn, CreateTagInput { name: "b".into(), color: None }).unwrap();
    assert_eq!(tag::list(&conn).unwrap().len(), 2);
}

#[test]
fn tag_update_changes_fields() {
    let conn = setup();
    let t = tag::create(&conn, CreateTagInput { name: "old".into(), color: Some("#ef4444".into()) }).unwrap();
    let updated = tag::update(&conn, &t.id, UpdateTagInput { name: Some("new".into()), color: Some(Some("#10b981".into())) }).unwrap();
    assert_eq!(updated.name, "new");
    assert_eq!(updated.color.as_deref(), Some("#10b981"));
}

#[test]
fn tag_update_only_color_keeps_name() {
    let conn = setup();
    let t = tag::create(&conn, CreateTagInput { name: "keep".into(), color: Some("#ef4444".into()) }).unwrap();
    let updated = tag::update(&conn, &t.id, UpdateTagInput { name: None, color: Some(Some("#3b82f6".into())) }).unwrap();
    assert_eq!(updated.name, "keep");
    assert_eq!(updated.color.as_deref(), Some("#3b82f6"));
}

#[test]
fn tag_update_not_found() {
    let conn = setup();
    let err = tag::update(&conn, "nope", UpdateTagInput { name: Some("x".into()), color: None }).unwrap_err();
    assert_eq!(err.code, "not_found");
}

#[test]
fn tag_update_duplicate_name_conflict() {
    let conn = setup();
    tag::create(&conn, CreateTagInput { name: "taken".into(), color: None }).unwrap();
    let other = tag::create(&conn, CreateTagInput { name: "other".into(), color: None }).unwrap();
    let err = tag::update(&conn, &other.id, UpdateTagInput { name: Some("taken".into()), color: None }).unwrap_err();
    assert_eq!(err.code, "conflict");
}

#[test]
fn tag_delete_removes() {
    let conn = setup();
    let t = tag::create(&conn, CreateTagInput { name: "temp".into(), color: None }).unwrap();
    tag::delete(&conn, &t.id).unwrap();
    assert_eq!(tag::list(&conn).unwrap().len(), 0);
}

#[test]
fn tag_delete_not_found() {
    let conn = setup();
    let err = tag::delete(&conn, "nope").unwrap_err();
    assert_eq!(err.code, "not_found");
}

// --- Event tests ---

fn make_event(conn: &rusqlite::Connection, cal_id: &str, title: &str, start: &str, end: &str) -> Event {
    event::create(conn, CreateEventInput {
        calendar_id: cal_id.to_string(),
        title: title.to_string(),
        start_at: start.to_string(),
        end_at: end.to_string(),
        all_day: false,
        description: None,
        location: None,
        url: None,
        image_path: None,
    }).unwrap()
}

#[test]
fn event_create_persists_with_defaults() {
    let conn = setup();
    let cal_id = make_calendar(&conn);
    let ev = make_event(&conn, &cal_id, "Sync", "2026-05-29T10:00:00.000Z", "2026-05-29T11:00:00.000Z");

    assert!(!ev.id.is_empty());
    assert_eq!(ev.title, "Sync");
    assert_eq!(ev.all_day, false);
    assert!(ev.tags.is_empty());
    assert!(ev.reminders.is_empty());
}

#[test]
fn event_create_rejects_end_before_start() {
    let conn = setup();
    let cal_id = make_calendar(&conn);
    let err = event::create(&conn, CreateEventInput {
        calendar_id: cal_id,
        title: "bad".into(),
        start_at: "2026-05-29T11:00:00.000Z".into(),
        end_at: "2026-05-29T10:00:00.000Z".into(),
        all_day: false,
        description: None, location: None, url: None, image_path: None,
    }).unwrap_err();
    assert_eq!(err.code, "validation_error");
}

#[test]
fn event_create_rejects_unknown_calendar() {
    let conn = setup();
    let err = event::create(&conn, CreateEventInput {
        calendar_id: "missing".into(),
        title: "x".into(),
        start_at: "2026-05-29T10:00:00.000Z".into(),
        end_at: "2026-05-29T11:00:00.000Z".into(),
        all_day: false,
        description: None, location: None, url: None, image_path: None,
    }).unwrap_err();
    assert_eq!(err.code, "validation_error");
}

#[test]
fn event_get_and_not_found() {
    let conn = setup();
    let cal_id = make_calendar(&conn);
    let ev = make_event(&conn, &cal_id, "X", "2026-05-29T10:00:00.000Z", "2026-05-29T11:00:00.000Z");
    assert_eq!(event::get(&conn, &ev.id).unwrap().id, ev.id);
    assert_eq!(event::get(&conn, "nope").unwrap_err().code, "not_found");
}

#[test]
fn event_update_changes_title() {
    let conn = setup();
    let cal_id = make_calendar(&conn);
    let ev = make_event(&conn, &cal_id, "Old", "2026-05-29T10:00:00.000Z", "2026-05-29T11:00:00.000Z");
    let updated = event::update(&conn, &ev.id, UpdateEventInput {
        calendar_id: None, title: Some("New".into()), start_at: None, end_at: None,
        all_day: None, description: None, location: None, url: None, image_path: None,
    }).unwrap();
    assert_eq!(updated.title, "New");
}

#[test]
fn event_update_rejects_end_before_start() {
    let conn = setup();
    let cal_id = make_calendar(&conn);
    let ev = make_event(&conn, &cal_id, "X", "2026-05-29T10:00:00.000Z", "2026-05-29T11:00:00.000Z");
    let err = event::update(&conn, &ev.id, UpdateEventInput {
        calendar_id: None, title: None, start_at: None,
        end_at: Some("2026-05-29T09:00:00.000Z".into()),
        all_day: None, description: None, location: None, url: None, image_path: None,
    }).unwrap_err();
    assert_eq!(err.code, "validation_error");
}

#[test]
fn event_delete_removes() {
    let conn = setup();
    let cal_id = make_calendar(&conn);
    let ev = make_event(&conn, &cal_id, "Temp", "2026-05-29T10:00:00.000Z", "2026-05-29T11:00:00.000Z");
    event::delete(&conn, &ev.id).unwrap();
    assert_eq!(event::get(&conn, &ev.id).unwrap_err().code, "not_found");
    assert_eq!(event::delete(&conn, "nope").unwrap_err().code, "not_found");
}

#[test]
fn event_reminders_add_and_remove() {
    let conn = setup();
    let cal_id = make_calendar(&conn);
    let ev = make_event(&conn, &cal_id, "X", "2026-05-29T10:00:00.000Z", "2026-05-29T11:00:00.000Z");

    let reminder = event::add_reminder(&conn, &ev.id, CreateReminderInput {
        minutes_before: 10, method: "notification".into(),
    }).unwrap();
    assert_eq!(event::get(&conn, &ev.id).unwrap().reminders.len(), 1);

    event::remove_reminder(&conn, &ev.id, &reminder.id).unwrap();
    assert_eq!(event::get(&conn, &ev.id).unwrap().reminders.len(), 0);
}

#[test]
fn event_add_reminder_not_found() {
    let conn = setup();
    let err = event::add_reminder(&conn, "nope", CreateReminderInput {
        minutes_before: 5, method: "notification".into(),
    }).unwrap_err();
    assert_eq!(err.code, "not_found");
}

#[test]
fn event_tags_link_unlink_surface_as_names() {
    let conn = setup();
    let cal_id = make_calendar(&conn);
    let ev = make_event(&conn, &cal_id, "X", "2026-05-29T10:00:00.000Z", "2026-05-29T11:00:00.000Z");
    let t = tag::create(&conn, CreateTagInput { name: "important".into(), color: None }).unwrap();

    event::add_tag(&conn, &ev.id, &t.id).unwrap();
    assert_eq!(event::get(&conn, &ev.id).unwrap().tags, vec!["important"]);

    event::remove_tag(&conn, &ev.id, &t.id).unwrap();
    assert!(event::get(&conn, &ev.id).unwrap().tags.is_empty());
}

#[test]
fn event_add_tag_not_found() {
    let conn = setup();
    let cal_id = make_calendar(&conn);
    let ev = make_event(&conn, &cal_id, "X", "2026-05-29T10:00:00.000Z", "2026-05-29T11:00:00.000Z");
    assert_eq!(event::add_tag(&conn, "nope", "whatever").unwrap_err().code, "not_found");
    assert_eq!(event::add_tag(&conn, &ev.id, "nope").unwrap_err().code, "not_found");
}

#[test]
fn event_list_filters_and_pagination() {
    let conn = setup();
    let cal_id = make_calendar(&conn);
    let other_id = calendar::create(&conn, CreateCalendarInput { name: "Personal".into(), color: None, description: None }).unwrap().id;
    let vip = tag::create(&conn, CreateTagInput { name: "vip".into(), color: None }).unwrap();

    let a = make_event(&conn, &cal_id, "Alpha meeting", "2026-05-01T10:00:00.000Z", "2026-05-01T11:00:00.000Z");
    make_event(&conn, &cal_id, "Beta workshop", "2026-06-01T10:00:00.000Z", "2026-06-01T11:00:00.000Z");
    make_event(&conn, &other_id, "Gamma", "2026-05-15T10:00:00.000Z", "2026-05-15T11:00:00.000Z");
    event::add_tag(&conn, &a.id, &vip.id).unwrap();

    let by_cal = event::list(&conn, &EventQuery { calendar_id: Some(cal_id.clone()), from: None, to: None, tag: None, q: None, limit: None, offset: None }).unwrap();
    assert_eq!(by_cal.len(), 2);

    let from = event::list(&conn, &EventQuery { calendar_id: None, from: Some("2026-05-20T00:00:00.000Z".into()), to: None, tag: None, q: None, limit: None, offset: None }).unwrap();
    assert_eq!(from.len(), 1);

    let to = event::list(&conn, &EventQuery { calendar_id: None, from: None, to: Some("2026-05-10T00:00:00.000Z".into()), tag: None, q: None, limit: None, offset: None }).unwrap();
    assert_eq!(to.len(), 1);

    let by_tag = event::list(&conn, &EventQuery { calendar_id: None, from: None, to: None, tag: Some("vip".into()), q: None, limit: None, offset: None }).unwrap();
    assert_eq!(by_tag.len(), 1);

    let search = event::list(&conn, &EventQuery { calendar_id: None, from: None, to: None, tag: None, q: Some("workshop".into()), limit: None, offset: None }).unwrap();
    assert_eq!(search.len(), 1);

    let limited = event::list(&conn, &EventQuery { calendar_id: None, from: None, to: None, tag: None, q: None, limit: Some(1), offset: None }).unwrap();
    assert_eq!(limited.len(), 1);
}

#[test]
fn event_list_hydrates_tags_and_reminders_correctly() {
    let conn = setup();
    let cal_id = make_calendar(&conn);
    let tag_a = tag::create(&conn, CreateTagInput { name: "aa".into(), color: None }).unwrap();
    let tag_b = tag::create(&conn, CreateTagInput { name: "bb".into(), color: None }).unwrap();

    let first = make_event(&conn, &cal_id, "First", "2026-05-01T10:00:00.000Z", "2026-05-01T11:00:00.000Z");
    let second = make_event(&conn, &cal_id, "Second", "2026-05-02T10:00:00.000Z", "2026-05-02T11:00:00.000Z");
    make_event(&conn, &cal_id, "Third", "2026-05-03T10:00:00.000Z", "2026-05-03T11:00:00.000Z");

    event::add_tag(&conn, &first.id, &tag_b.id).unwrap();
    event::add_tag(&conn, &first.id, &tag_a.id).unwrap();
    event::add_tag(&conn, &second.id, &tag_a.id).unwrap();
    event::add_reminder(&conn, &first.id, CreateReminderInput { minutes_before: 10, method: "notification".into() }).unwrap();
    event::add_reminder(&conn, &first.id, CreateReminderInput { minutes_before: 60, method: "notification".into() }).unwrap();

    let list = event::list(&conn, &EventQuery { calendar_id: None, from: None, to: None, tag: None, q: None, limit: None, offset: None }).unwrap();
    let titles: Vec<&str> = list.iter().map(|e| e.title.as_str()).collect();
    assert_eq!(titles, vec!["First", "Second", "Third"]);
    assert_eq!(list[0].tags, vec!["aa", "bb"]);
    assert_eq!(list[1].tags, vec!["aa"]);
    assert!(list[2].tags.is_empty());
    let mins: Vec<i64> = list[0].reminders.iter().map(|r| r.minutes_before).collect();
    assert_eq!(mins, vec![60, 10]);
    assert!(list[1].reminders.is_empty());
    assert!(list[2].reminders.is_empty());
}

#[test]
fn event_url_and_image_path_roundtrip() {
    let conn = setup();
    let cal_id = make_calendar(&conn);
    let ev = event::create(&conn, CreateEventInput {
        calendar_id: cal_id.clone(),
        title: "Rich".into(),
        start_at: "2026-05-29T10:00:00.000Z".into(),
        end_at: "2026-05-29T11:00:00.000Z".into(),
        all_day: false,
        description: None, location: None,
        url: Some("https://example.com".into()),
        image_path: Some("11111111-1111-4111-8111-111111111111.png".into()),
    }).unwrap();
    assert_eq!(ev.url.as_deref(), Some("https://example.com"));
    assert_eq!(ev.image_path.as_deref(), Some("11111111-1111-4111-8111-111111111111.png"));
    assert_eq!(ev.source_uid, None);

    let plain = make_event(&conn, &cal_id, "Plain", "2026-05-29T10:00:00.000Z", "2026-05-29T11:00:00.000Z");
    assert_eq!(plain.url, None);
    assert_eq!(plain.image_path, None);
}

#[test]
fn event_update_clears_url_with_null() {
    let conn = setup();
    let cal_id = make_calendar(&conn);
    let ev = event::create(&conn, CreateEventInput {
        calendar_id: cal_id,
        title: "X".into(),
        start_at: "2026-05-29T10:00:00.000Z".into(),
        end_at: "2026-05-29T11:00:00.000Z".into(),
        all_day: false,
        description: None, location: None,
        url: Some("https://old.test".into()),
        image_path: None,
    }).unwrap();
    let updated = event::update(&conn, &ev.id, UpdateEventInput {
        calendar_id: None, title: None, start_at: None, end_at: None, all_day: None,
        description: None, location: None,
        url: Some(None),
        image_path: Some(Some("a.png".into())),
    }).unwrap();
    assert_eq!(updated.url, None);
    assert_eq!(updated.image_path.as_deref(), Some("a.png"));
}
