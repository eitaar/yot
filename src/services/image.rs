// ports: src/services/image.service.ts
use std::path::PathBuf;
use crate::core::error::AppError;
use crate::core::id::new_id;

const MAX_SIZE: usize = 5 * 1024 * 1024;
const VALID_MIMES: &[&str] = &["image/jpeg", "image/png", "image/webp", "image/gif"];
const NAME_PATTERN: &str = r"^[0-9a-f\-]{36}\.(jpg|png|webp|gif)$";

fn extension_for_mime(mime: &str) -> Option<&'static str> {
    match mime {
        "image/jpeg" => Some("jpg"),
        "image/png" => Some("png"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        _ => None,
    }
}

pub fn img_dir() -> PathBuf {
    std::env::var("IMG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| crate::config::default_data_dir().join("img"))
}

pub fn ensure_img_dir() -> Result<PathBuf, AppError> {
    let dir = img_dir();
    std::fs::create_dir_all(&dir).map_err(|e| {
        tracing::error!("Failed to create img dir: {e}");
        AppError::internal("Failed to create image directory")
    })?;
    Ok(dir)
}

pub fn save_bytes(data: &[u8], content_type: &str) -> Result<String, AppError> {
    if data.len() > MAX_SIZE {
        return Err(AppError::validation("File too large", None));
    }
    if !VALID_MIMES.contains(&content_type) {
        return Err(AppError::validation("Invalid image type", None));
    }
    let ext = extension_for_mime(content_type)
        .ok_or_else(|| AppError::validation("Invalid image type", None))?;

    let dir = ensure_img_dir()?;
    let filename = format!("{}.{}", new_id(), ext);
    let path = dir.join(&filename);
    std::fs::write(&path, data).map_err(|e| {
        tracing::error!("Failed to write image: {e}");
        AppError::internal("Failed to save image")
    })?;
    Ok(filename)
}

pub fn get_path(filename: &str) -> Result<PathBuf, AppError> {
    let re = regex_lite::Regex::new(NAME_PATTERN).unwrap();
    if !re.is_match(filename) {
        return Err(AppError::not_found("Not found"));
    }
    let path = img_dir().join(filename);
    if !path.exists() {
        return Err(AppError::not_found("Not found"));
    }
    Ok(path)
}

pub fn mime_for_extension(ext: &str) -> &'static str {
    match ext {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "application/octet-stream",
    }
}

pub fn is_private_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.octets()[0] == 169 && v4.octets()[1] == 254
        }
        std::net::IpAddr::V6(v6) => {
            v6.is_loopback()
                || (v6.segments()[0] & 0xfe00) == 0xfc00
                || (v6.segments()[0] & 0xffc0) == 0xfe80
                || matches!(v6.to_ipv4_mapped(), Some(v4) if is_private_ip(std::net::IpAddr::V4(v4)))
        }
    }
}

pub async fn download_from_url(url: &str) -> Result<String, AppError> {
    let parsed: url::Url = url.parse().map_err(|_| AppError::validation("Invalid URL", None))?;

    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(AppError::validation("Only http/https URLs are allowed", None));
    }

    let host = parsed.host_str().ok_or_else(|| AppError::validation("Invalid URL", None))?;

    use std::net::ToSocketAddrs;
    let addrs: Vec<std::net::SocketAddr> = format!("{}:{}", host, parsed.port_or_known_default().unwrap_or(80))
        .to_socket_addrs()
        .map_err(|_| AppError::validation("DNS resolution failed", None))?
        .collect();

    for addr in &addrs {
        if is_private_ip(addr.ip()) {
            return Err(AppError::validation("Private IP addresses are not allowed", None));
        }
    }

    let resolved_addr = addrs[0];
    let port = parsed.port_or_known_default().unwrap_or(80);
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(10))
        .resolve(host, std::net::SocketAddr::new(resolved_addr.ip(), port))
        .build()
        .map_err(|_| AppError::internal("HTTP client error"))?;

    let resp = client.get(url).send().await
        .map_err(|_| AppError::validation("Failed to fetch URL", None))?;

    if resp.status().is_redirection() {
        return Err(AppError::validation("Redirects are not allowed", None));
    }
    if !resp.status().is_success() {
        return Err(AppError::validation("Failed to fetch URL", None));
    }

    if let Some(cl) = resp.headers().get("content-length").and_then(|v| v.to_str().ok()) {
        if let Ok(len) = cl.parse::<usize>() {
            if len > MAX_SIZE {
                return Err(AppError::validation("File too large", None));
            }
        }
    }

    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_string();

    if !VALID_MIMES.contains(&content_type.as_str()) {
        return Err(AppError::validation("Invalid image type", None));
    }

    let bytes = resp.bytes().await
        .map_err(|_| AppError::validation("Failed to read response", None))?;

    save_bytes(&bytes, &content_type)
}
