pub mod schema;

use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;
use rusqlite::Connection;
use crate::core::error::AppError;

#[derive(Clone)]
pub struct Db {
    conn: Arc<Mutex<Connection>>,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self, AppError> {
        let conn = Connection::open(path).map_err(|e| {
            tracing::error!("Failed to open database: {e}");
            AppError::internal("Failed to open database")
        })?;
        schema::initialize(&conn)?;
        Ok(Self { conn: Arc::new(Mutex::new(conn)) })
    }

    pub fn open_in_memory() -> Result<Self, AppError> {
        let conn = Connection::open_in_memory().map_err(|e| {
            tracing::error!("Failed to open in-memory database: {e}");
            AppError::internal("Failed to open database")
        })?;
        schema::initialize(&conn)?;
        Ok(Self { conn: Arc::new(Mutex::new(conn)) })
    }

    pub async fn call<F, T>(&self, f: F) -> Result<T, AppError>
    where
        F: FnOnce(&Connection) -> Result<T, AppError> + Send + 'static,
        T: Send + 'static,
    {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            let conn = conn.blocking_lock();
            f(&conn)
        })
        .await
        .map_err(|e| {
            tracing::error!("Task join error: {e}");
            AppError::internal("Internal error")
        })?
    }
}
