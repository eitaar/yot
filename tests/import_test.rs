use yot_server::db::schema;
use yot_server::models::*;
use yot_server::services::{calendar, event, import};

fn setup() -> rusqlite::Connection {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    schema::initialize(&conn).unwrap();
    conn
}

const ICS: &str = "BEGIN:VCALENDAR\r\n\
VERSION:2.0\r\n\
PRODID:-//test//EN\r\n\
BEGIN:VEVENT\r\n\
UID:timed-1\r\n\
SUMMARY:Timed meeting\r\n\
DTSTART:20260602T140000Z\r\n\
DTEND:20260602T150000Z\r\n\
LOCATION:Room 4\r\n\
DESCRIPTION:Hello\r\n\
END:VEVENT\r\n\
BEGIN:VEVENT\r\n\
UID:allday-1\r\n\
SUMMARY:All day off\r\n\
DTSTART;VALUE=DATE:20260605\r\n\
DTEND;VALUE=DATE:20260606\r\n\
END:VEVENT\r\n\
BEGIN:VEVENT\r\n\
UID:weekly-1\r\n\
SUMMARY:Standup\r\n\
DTSTART:20260601T090000Z\r\n\
DTEND:20260601T091500Z\r\n\
RRULE:FREQ=WEEKLY\r\n\
END:VEVENT\r\n\
END:VCALENDAR";

fn make_calendar(conn: &rusqlite::Connection) -> String {
    calendar::create(conn, CreateCalendarInput {
        name: "Imported".to_string(), color: None, description: None,
    }).unwrap().id
}

#[test]
fn imports_one_off_events_skips_recurring() {
    let conn = setup();
    let cal_id = make_calendar(&conn);
    let result = import::import_ics(&conn, &cal_id, ICS.as_bytes()).unwrap();

    assert_eq!(result.created, 2);
    assert_eq!(result.skipped_recurring, 1);
    assert_eq!(result.skipped_duplicate, 0);
    assert!(result.errors.is_empty());

    let list = event::list(&conn, &EventQuery {
        calendar_id: None, from: None, to: None, tag: None, q: None, limit: Some(50), offset: None,
    }).unwrap();

    let timed = list.iter().find(|e| e.title == "Timed meeting").unwrap();
    assert_eq!(timed.location.as_deref(), Some("Room 4"));
    assert_eq!(timed.all_day, false);
    assert_eq!(timed.source_uid.as_deref(), Some("timed-1"));

    let allday = list.iter().find(|e| e.title == "All day off").unwrap();
    assert_eq!(allday.all_day, true);
}

#[test]
fn reimport_deduplicates_by_uid() {
    let conn = setup();
    let cal_id = make_calendar(&conn);
    import::import_ics(&conn, &cal_id, ICS.as_bytes()).unwrap();
    let result = import::import_ics(&conn, &cal_id, ICS.as_bytes()).unwrap();

    assert_eq!(result.created, 0);
    assert_eq!(result.skipped_duplicate, 2);
    assert_eq!(result.skipped_recurring, 1);
}

#[test]
fn import_invalid_calendar_not_found() {
    let conn = setup();
    let err = import::import_ics(&conn, "missing", ICS.as_bytes()).unwrap_err();
    assert_eq!(err.code, "not_found");
}

#[test]
fn event_without_dtstart_is_error() {
    let conn = setup();
    let cal_id = make_calendar(&conn);
    let ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:no-start\r\nSUMMARY:Broken\r\nEND:VEVENT\r\nEND:VCALENDAR";
    let result = import::import_ics(&conn, &cal_id, ics.as_bytes()).unwrap();
    assert_eq!(result.created, 0);
    assert_eq!(result.errors.len(), 1);
    assert!(result.errors[0].contains("DTSTART"));
}
