// tests/ask_model_test.rs

#[test]
fn test_model_resolution_uses_request_model_when_provided() {
    let request_model = Some("openai/gpt-4o".to_string());
    let default_model = "hermes-agent".to_string();
    let resolved = request_model
        .filter(|m| !m.is_empty())
        .unwrap_or(default_model);
    assert_eq!(resolved, "openai/gpt-4o");
}

#[test]
fn test_model_resolution_falls_back_to_default() {
    let request_model: Option<String> = None;
    let default_model = "hermes-agent".to_string();
    let resolved = request_model
        .filter(|m| !m.is_empty())
        .unwrap_or(default_model);
    assert_eq!(resolved, "hermes-agent");
}

#[test]
fn test_model_resolution_empty_string_falls_back() {
    let request_model = Some("".to_string());
    let default_model = "hermes-agent".to_string();
    let resolved = request_model
        .filter(|m| !m.is_empty())
        .unwrap_or(default_model);
    assert_eq!(resolved, "hermes-agent");
}
