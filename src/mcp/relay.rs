// ports: src/mcp/relay.ts
use crate::core::event_bus::EventBus;
use tokio::sync::broadcast;

pub struct RelayConfig {
    pub url: String,
    pub api_key: String,
}

pub fn start_relay(bus: &EventBus, config: RelayConfig) {
    let mut rx = bus.subscribe();
    let client = reqwest::Client::new();

    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    let body = serde_json::json!({
                        "type": event.event_type,
                        "data": event.data,
                    });
                    let res = client
                        .post(&config.url)
                        .header("authorization", format!("Bearer {}", config.api_key))
                        .header("content-type", "application/json")
                        .json(&body)
                        .send()
                        .await;
                    if let Err(e) = res {
                        eprintln!("[relay] failed to forward change: {e}");
                    }
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    eprintln!("[relay] lagged, skipped {n} events");
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}
