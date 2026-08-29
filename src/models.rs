use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Calendar {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub description: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateCalendarInput {
    pub name: String,
    pub color: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCalendarInput {
    pub name: Option<String>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub color: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub description: Option<Option<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub id: String,
    pub calendar_id: String,
    pub title: String,
    pub description: Option<String>,
    pub context: Option<String>,
    pub location: Option<String>,
    pub start_at: String,
    pub end_at: String,
    pub all_day: bool,
    pub image_path: Option<String>,
    pub url: Option<String>,
    pub source_uid: Option<String>,
    pub visible: bool,
    pub created_at: String,
    pub updated_at: String,
    pub tags: Vec<String>,
    pub reminders: Vec<Reminder>,
}

#[derive(Debug, Deserialize)]
pub struct CreateEventInput {
    pub calendar_id: String,
    pub title: String,
    pub start_at: String,
    pub end_at: String,
    #[serde(default)]
    pub all_day: bool,
    pub description: Option<String>,
    pub context: Option<String>,
    pub location: Option<String>,
    pub url: Option<String>,
    pub image_path: Option<String>,
    #[serde(default)]
    pub visible: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateEventInput {
    #[serde(default, deserialize_with = "deserialize_reject_null")]
    pub calendar_id: Option<String>,
    #[serde(default, deserialize_with = "deserialize_reject_null")]
    pub title: Option<String>,
    #[serde(default, deserialize_with = "deserialize_reject_null")]
    pub start_at: Option<String>,
    #[serde(default, deserialize_with = "deserialize_reject_null")]
    pub end_at: Option<String>,
    pub all_day: Option<bool>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub description: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub context: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub location: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub url: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub image_path: Option<Option<String>>,
    pub visible: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventQuery {
    #[serde(rename = "calendarId")]
    pub calendar_id: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub tag: Option<String>,
    pub q: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    #[serde(default, rename = "includeHidden")]
    pub include_hidden: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reminder {
    pub id: String,
    pub event_id: String,
    pub minutes_before: i64,
    pub method: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateReminderInput {
    pub minutes_before: i64,
    #[serde(default = "default_notification_method")]
    pub method: String,
}

fn default_notification_method() -> String {
    "notification".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateTagInput {
    pub name: String,
    pub color: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTagInput {
    pub name: Option<String>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub color: Option<Option<String>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApiKey {
    pub id: String,
    pub name: String,
    pub key_hash: String,
    pub scope: String,
    pub revoked: bool,
    pub created_at: String,
    pub last_used_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportResult {
    pub created: usize,
    #[serde(rename = "skippedRecurring")]
    pub skipped_recurring: usize,
    #[serde(rename = "skippedDuplicate")]
    pub skipped_duplicate: usize,
    pub errors: Vec<String>,
}

pub fn deserialize_double_option<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    let opt: Option<T> = Option::deserialize(deserializer)?;
    Ok(Some(opt))
}

pub fn deserialize_reject_null<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::Error;
    let opt: Option<String> = Option::deserialize(deserializer)?;
    match opt {
        None => Err(D::Error::custom("field cannot be null")),
        Some(v) => Ok(Some(v)),
    }
}
