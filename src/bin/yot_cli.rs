use std::fs;
use clap::{Parser, Subcommand};
use rusqlite::Connection;
use yot_server::auth::apikey;
use yot_server::config::Config;
use yot_server::db::schema;

#[derive(Parser)]
#[command(name = "yot", version = "1.0.0", about = "yot calendar CLI")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Create a new API key and save it to .env
    Init {
        /// Key label
        #[arg(long, default_value = "default")]
        name: String,
        /// Key scope (read or write)
        #[arg(long, default_value = "write")]
        scope: String,
        /// Path to .env file (default: <data_dir>/.env)
        #[arg(long)]
        env_file: Option<String>,
        /// Disable MCP auth
        #[arg(long)]
        mcp_auth_off: bool,
    },
    /// Generate a pairing PIN
    Auth {
        /// Scope for the paired session
        #[arg(long, default_value = "write")]
        scope: String,
    },
    /// List API keys
    Keys,
    /// Revoke an API key by ID
    Revoke {
        /// Key ID to revoke
        id: String,
    },
}

fn main() {
    let config = Config::from_env();
    let cli = Cli::parse();

    match cli.command {
        Commands::Init { name, scope, env_file, mcp_auth_off } => {
            if scope != "read" && scope != "write" {
                eprintln!("Scope must be 'read' or 'write'");
                std::process::exit(1);
            }

            fs::create_dir_all(&config.data_dir).unwrap_or_else(|e| {
                eprintln!("Failed to create data dir {:?}: {e}", config.data_dir);
                std::process::exit(1);
            });

            let conn = Connection::open(&config.db_path).unwrap_or_else(|e| {
                eprintln!("Failed to open database: {e}");
                std::process::exit(1);
            });
            schema::initialize(&conn).unwrap();

            let (_, raw) = apikey::create(&conn, &name, &scope).unwrap();

            let env_path = env_file.unwrap_or_else(|| {
                config.data_dir.join(".env").to_string_lossy().to_string()
            });

            let mut updates = vec![format!("YOT_API_KEY={raw}")];
            if mcp_auth_off {
                updates.push("MCP_AUTH=off".to_string());
            }
            update_env_file(&env_path, &updates);

            println!("Data dir: {}", config.data_dir.display());
            println!("API key created and saved to {env_path}");
            println!();
            println!("  {raw}");
            println!();
            println!("Store this key — it will not be shown again.");
        }
        Commands::Auth { scope } => {
            let base_url = config.http_base_url();
            let api_key = config.yot_api_key.unwrap_or_else(|| {
                eprintln!("YOT_API_KEY not set. Run `yot init` first.");
                std::process::exit(1);
            });
            let url = format!("{}/api/auth/pin", base_url.trim_end_matches('/'));

            let client = reqwest::blocking::Client::new();
            let resp = client
                .post(&url)
                .header("authorization", format!("Bearer {api_key}"))
                .header("content-type", "application/json")
                .body(format!(r#"{{"scope":"{}"}}"#, scope))
                .send();

            match resp {
                Ok(r) if r.status().is_success() => {
                    let body: serde_json::Value = r.json().unwrap();
                    println!("PIN: {}", body["pin"]);
                    println!("Scope: {}", body["scope"]);
                    println!("Expires in: {}s", body["expires_in"]);
                }
                Ok(r) => {
                    eprintln!("Server returned {}: {}", r.status(), r.text().unwrap_or_default());
                    std::process::exit(1);
                }
                Err(e) => {
                    eprintln!("Failed to connect to server: {e}");
                    std::process::exit(1);
                }
            }
        }
        Commands::Keys => {
            let conn = Connection::open(&config.db_path).unwrap_or_else(|e| {
                eprintln!("Failed to open database: {e}");
                std::process::exit(1);
            });
            schema::initialize(&conn).unwrap();

            let keys = apikey::list_keys(&conn).unwrap();
            if keys.is_empty() {
                println!("No API keys found.");
                return;
            }
            println!("{:<38} {:<12} {:<6} {:<8}", "ID", "NAME", "SCOPE", "REVOKED");
            for key in keys {
                println!("{:<38} {:<12} {:<6} {:<8}", key.id, key.name, key.scope, key.revoked);
            }
        }
        Commands::Revoke { id } => {
            let conn = Connection::open(&config.db_path).unwrap_or_else(|e| {
                eprintln!("Failed to open database: {e}");
                std::process::exit(1);
            });
            schema::initialize(&conn).unwrap();

            match apikey::revoke_by_id(&conn, &id) {
                Ok(()) => println!("Key {id} revoked."),
                Err(e) => {
                    eprintln!("{}", e.message);
                    std::process::exit(1);
                }
            }
        }
    }
}

fn update_env_file(path: &str, lines: &[String]) {
    let mut content = fs::read_to_string(path).unwrap_or_default();
    for line in lines {
        let key = line.split('=').next().unwrap();
        let pattern = format!("{}=", key);
        if content.contains(&pattern) {
            let re = regex_lite::Regex::new(&format!(r"(?m)^{}=.*$", key)).unwrap();
            content = re.replace(&content, line.as_str()).to_string();
        } else {
            if !content.is_empty() && !content.ends_with('\n') {
                content.push('\n');
            }
            content.push_str(line);
            content.push('\n');
        }
    }
    fs::write(path, content).unwrap_or_else(|e| {
        eprintln!("Failed to write {path}: {e}");
        std::process::exit(1);
    });
}
