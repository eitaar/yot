use std::sync::Mutex;
use rusqlite::Connection;
use yot_server::config::Config;
use yot_server::core::event_bus::EventBus;
use yot_server::auth::apikey;
use yot_server::db::schema;
use yot_server::mcp::relay::{start_relay, RelayConfig};
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

    // Forward bus events to the server's /api/internal/events so browsers on
    // the SSE stream see changes made through this stdio process. The relay
    // task needs a Tokio reactor; the runtime must outlive the blocking
    // server.run() below, so it lives here in main.
    let runtime = tokio::runtime::Runtime::new().expect("Failed to start Tokio runtime");
    let _guard = runtime.enter();
    let relay = if config.yot_sse_relay {
        config.yot_api_key.as_ref().map(|api_key| {
            let url = format!(
                "{}/api/internal/events",
                config.http_base_url().trim_end_matches('/')
            );
            start_relay(&bus, RelayConfig { url, api_key: api_key.clone() })
        })
    } else {
        None
    };

    let server = McpServer {
        conn: Mutex::new(conn),
        scope,
        bus,
    };

    server.run();

    // Dropping the server closes the last bus sender, which ends the relay
    // loop; wait for it so an in-flight forward isn't cut off mid-POST when
    // stdin closes.
    drop(server);
    if let Some(handle) = relay {
        let _ = runtime.block_on(async {
            tokio::time::timeout(std::time::Duration::from_secs(5), handle).await
        });
    }
}
