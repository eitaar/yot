use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use yot_server::config::Config;
use yot_server::core::event_bus::EventBus;
use yot_server::db::Db;
use yot_server::auth::pairing::PairingService;
use yot_server::auth::rate_limit::RateLimiter;
use yot_server::mcp::server::McpServer;
use yot_server::rest::{self, AppState};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    let config = Config::from_env();
    std::fs::create_dir_all(&config.data_dir).expect("Failed to create data directory");
    let db = Db::open(&config.db_path).expect("Failed to open database");
    let bus = EventBus::new();
    let pairing = Arc::new(PairingService::new());
    let rate_limiter = Arc::new(RateLimiter::new());

    let mcp_conn = rusqlite::Connection::open(&config.db_path)
        .expect("Failed to open MCP database connection");
    yot_server::db::schema::initialize(&mcp_conn).unwrap();
    let mcp = Arc::new(McpServer {
        conn: Mutex::new(mcp_conn),
        scope: "write".to_string(),
        bus: bus.clone(),
    });

    let state = AppState { db, bus, pairing, rate_limiter, mcp };
    let app = rest::build_router(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    tracing::info!("Listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .await
        .unwrap();
}
