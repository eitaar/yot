use std::sync::Mutex;
use rusqlite::Connection;
use yot_server::config::Config;
use yot_server::core::event_bus::EventBus;
use yot_server::auth::apikey;
use yot_server::db::schema;
use yot_server::mcp::server::McpServer;

fn main() {
    let config = Config::from_env();

    let conn = Connection::open(&config.db_path).unwrap_or_else(|e| {
        eprintln!("Failed to open database: {e}");
        std::process::exit(1);
    });
    schema::initialize(&conn).unwrap_or_else(|e| {
        eprintln!("Failed to initialize schema: {e}");
        std::process::exit(1);
    });

    let scope = if !config.mcp_auth {
        "write".to_string()
    } else {
        let raw = match &config.yot_api_key {
            Some(k) => k.clone(),
            None => {
                eprintln!(
                    "YOT_API_KEY is not set (looked in .env and the environment). \
                     Set it to a valid key, or run with MCP_AUTH=off to disable auth."
                );
                std::process::exit(1);
            }
        };
        let key = apikey::authenticate(&conn, &raw).unwrap_or_else(|_| {
            eprintln!("YOT_API_KEY is invalid or revoked.");
            std::process::exit(1);
        });
        key.scope
    };

    let bus = EventBus::new();

    if config.yot_sse_relay {
        if let Some(ref _api_key) = config.yot_api_key {
            let base_url = config.http_base_url();
            let url = format!("{}/api/internal/events", base_url.trim_end_matches('/'));
            eprintln!("[relay] would forward changes to {url} (relay requires async runtime)");
        } else {
            eprintln!("[relay] disabled (no key)");
        }
    } else {
        eprintln!("[relay] disabled (YOT_SSE_RELAY=off)");
    }

    let server = McpServer {
        conn: Mutex::new(conn),
        scope,
        bus,
    };

    server.run();
}
