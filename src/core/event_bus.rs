use serde_json::Value;
use tokio::sync::broadcast;

#[derive(Debug, Clone)]
pub struct BusEvent {
    pub event_type: String,
    pub data: Value,
}

#[derive(Clone)]
pub struct EventBus {
    tx: broadcast::Sender<BusEvent>,
}

impl EventBus {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(256);
        Self { tx }
    }

    pub fn emit(&self, event_type: impl Into<String>, data: Value) {
        let _ = self.tx.send(BusEvent {
            event_type: event_type.into(),
            data,
        });
    }

    pub fn subscribe(&self) -> broadcast::Receiver<BusEvent> {
        self.tx.subscribe()
    }
}
