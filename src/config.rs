use std::path::PathBuf;

pub struct Config {
    pub port: u16,
    pub data_dir: PathBuf,
    pub db_path: PathBuf,
    pub img_dir: PathBuf,
    pub plugin_dir: PathBuf,
    pub mcp_auth: bool,
    pub yot_api_key: Option<String>,
    pub yot_http_url: Option<String>,
    pub yot_sse_relay: bool,
    pub hermes_api_url: String,
    pub hermes_api_key: Option<String>,
    pub hermes_default_model: String,
    pub hermes_allowed_models: Vec<String>,
}

pub fn default_data_dir() -> PathBuf {
    if cfg!(windows) {
        if let Ok(appdata) = std::env::var("APPDATA") {
            return PathBuf::from(appdata).join("yot");
        }
    }
    dirs_fallback_home().join(".yot")
}

fn dirs_fallback_home() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

impl Config {
    pub fn from_env() -> Self {
        let data_dir = std::env::var("YOT_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| default_data_dir());

        let env_file = data_dir.join(".env");
        if env_file.exists() {
            dotenvy::from_path(&env_file).ok();
        } else {
            dotenvy::dotenv().ok();
        }

        let port = std::env::var("PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(4010);

        let db_path = std::env::var("DB_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| data_dir.join("data.db"));

        let img_dir = std::env::var("IMG_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| data_dir.join("img"));

        let plugin_dir = std::env::var("PLUGIN_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| data_dir.join("plugins"));

        let mcp_auth = !matches!(
            std::env::var("MCP_AUTH").as_deref(),
            Ok("off" | "OFF" | "false" | "FALSE" | "0" | "no" | "NO")
        );

        let yot_api_key = std::env::var("YOT_API_KEY").ok();

        let yot_http_url = std::env::var("YOT_HTTP_URL").ok();

        let yot_sse_relay = !matches!(
            std::env::var("YOT_SSE_RELAY").as_deref(),
            Ok("off" | "OFF" | "false" | "FALSE" | "0" | "no" | "NO")
        );

        let hermes_api_url = std::env::var("HERMES_API_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:8642/v1/chat/completions".to_string());

        let hermes_api_key = std::env::var("HERMES_API_KEY").ok();

        let hermes_default_model = std::env::var("HERMES_DEFAULT_MODEL")
            .unwrap_or_else(|_| "hermes-agent".to_string());

        let hermes_allowed_models: Vec<String> = std::env::var("HERMES_ALLOWED_MODELS")
            .map(|v| v.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect())
            .unwrap_or_default();

        Self {
            port,
            data_dir,
            db_path,
            img_dir,
            plugin_dir,
            mcp_auth,
            yot_api_key,
            yot_http_url,
            yot_sse_relay,
            hermes_api_url,
            hermes_api_key,
            hermes_default_model,
            hermes_allowed_models,
        }
    }

    pub fn http_base_url(&self) -> String {
        self.yot_http_url
            .clone()
            .unwrap_or_else(|| format!("http://127.0.0.1:{}", self.port))
    }
}