use super::*;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;

const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
struct Harness {
    transport: Arc<Transport>,
    server: RunningServer,
    events: mpsc::UnboundedReceiver<(&'static str, Value)>,
    client: reqwest::Client,
}
impl Harness {
    async fn new() -> Self {
        Self::with_options(Options {
            call_timeout: Duration::from_millis(250),
            session_idle: Duration::from_secs(5),
            ..Options::default()
        })
        .await
    }
    async fn with_options(options: Options) -> Self {
        let (tx, events) = mpsc::unbounded_channel();
        let transport = Transport::new(
            TOKEN.into(),
            Arc::new(move |event, value| tx.send((event, value)).map_err(|_| "closed".to_string())),
            options,
        );
        let server = transport.bind(0).await.unwrap();
        Self {
            transport,
            server,
            events,
            client: reqwest::Client::new(),
        }
    }
    fn post(&self, body: Value) -> reqwest::RequestBuilder {
        self.client
            .post(format!("http://{}/mcp", self.server.addr))
            .bearer_auth(TOKEN)
            .json(&body)
    }
    fn message(&self, session: &str, body: Value) -> reqwest::RequestBuilder {
        self.post(body)
            .header("Mcp-Session-Id", session)
            .header("MCP-Protocol-Version", "2025-11-25")
    }
    async fn init(&self, version: &str) -> reqwest::Response {
        self.post(json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":version,"clientInfo":{"name":"test\nclient","version":"1"},"capabilities":{}}})).send().await.unwrap()
    }
    async fn session(&self) -> String {
        let res = self.init("2025-11-25").await;
        assert_eq!(res.status(), 200);
        let session = res.headers()["Mcp-Session-Id"]
            .to_str()
            .unwrap()
            .to_string();
        assert_eq!(
            self.message(
                &session,
                json!({"jsonrpc":"2.0","method":"notifications/initialized"})
            )
            .send()
            .await
            .unwrap()
            .status(),
            202
        );
        session
    }
    async fn event(&mut self, name: &str) -> Value {
        loop {
            let (event, value) = tokio::time::timeout(Duration::from_secs(2), self.events.recv())
                .await
                .unwrap()
                .unwrap();
            if event == name {
                return value;
            }
        }
    }
}

#[tokio::test]
async fn authentication_origin_host_and_limits() {
    let h = Harness::new().await;
    let url = format!("http://{}/mcp", h.server.addr);
    for auth in [
        None,
        Some("Bearer bad"),
        Some("Basic abc"),
        Some(&format!("Bearer {}", "0".repeat(64))),
    ] {
        let mut request = h.client.post(&url).body("{}");
        if let Some(value) = auth {
            request = request.header("Authorization", value);
        }
        assert_eq!(request.send().await.unwrap().status(), 401);
    }
    for origin in [
        "null",
        "https://evil.test",
        "http://127.0.0.1:1",
        "http://localhost:48765",
    ] {
        assert_eq!(
            h.post(json!({}))
                .header("Origin", origin)
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
    }
    assert_eq!(
        h.post(json!({}))
            .header("Host", "evil.test")
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        h.post(json!({}))
            .header("Origin", format!("http://{}", h.server.addr))
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    assert_eq!(
        h.client
            .post(&url)
            .bearer_auth(TOKEN)
            .header("Content-Type", "application/json")
            .body("x".repeat(1024 * 1024 + 1))
            .send()
            .await
            .unwrap()
            .status(),
        413
    );
    let res: Value = h
        .client
        .post(&url)
        .bearer_auth(TOKEN)
        .header("Content-Type", "application/json")
        .body("{")
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(res["error"]["code"], -32700);
    assert_eq!(
        h.client
            .get(&url)
            .bearer_auth(TOKEN)
            .send()
            .await
            .unwrap()
            .status(),
        405
    );
}

#[tokio::test]
async fn lifecycle_versions_catalogue_and_sessions() {
    let h = Harness::new().await;
    for version in ["2025-11-25", "2025-06-18"] {
        let res = h.init(version).await;
        let body: Value = res.json().await.unwrap();
        assert_eq!(body["result"]["protocolVersion"], version);
        assert_eq!(body["result"]["serverInfo"]["name"], "harita");
    }
    assert_eq!(
        h.init("2099-01-01").await.json::<Value>().await.unwrap()["error"]["code"],
        -32602
    );
    assert_eq!(
        h.post(json!({"jsonrpc":"2.0","id":2,"method":"ping"}))
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    assert_eq!(
        h.message("unknown", json!({"jsonrpc":"2.0","id":2,"method":"ping"}))
            .send()
            .await
            .unwrap()
            .status(),
        404
    );
    let session = h.session().await;
    let body: Value = h
        .message(
            &session,
            json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
        )
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(body["result"]["tools"].as_array().unwrap().len(), 26);
    assert_eq!(
        h.client
            .delete(format!("http://{}/mcp", h.server.addr))
            .bearer_auth(TOKEN)
            .header("Mcp-Session-Id", &session)
            .header("MCP-Protocol-Version", "2025-11-25")
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    assert_eq!(
        h.message(&session, json!({"jsonrpc":"2.0","id":3,"method":"ping"}))
            .send()
            .await
            .unwrap()
            .status(),
        404
    );
}

#[tokio::test]
async fn bridge_round_trip_timeout_and_stale_replies() {
    let mut h = Harness::new().await;
    let session = h.session().await;
    let call = json!({"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"get_session","arguments":{}}});
    let body: Value = h
        .message(&session, call.clone())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        body["result"]["structuredContent"]["code"],
        "EDITOR_UNAVAILABLE"
    );
    h.transport.ready("epoch-1".into()).unwrap();
    let request = h.message(&session, call.clone());
    let task =
        tokio::spawn(async move { request.send().await.unwrap().json::<Value>().await.unwrap() });
    let req = h.event(EVENT_REQUEST).await;
    assert_eq!(req["clientInfo"]["name"], "testclient");
    let result = json!({"content":[{"type":"text","text":"{}"},{"type":"image","mimeType":"image/png","data":"abc=="}],"structuredContent":{"ok":true}});
    let mut reply = json!({"type":"result","requestId":req["requestId"],"clientSessionId":session,"bridgeEpoch":"old","result":result});
    assert!(h.transport.reply(reply.clone()).is_err());
    reply["bridgeEpoch"] = json!("epoch-1");
    h.transport.reply(reply.clone()).unwrap();
    assert_eq!(task.await.unwrap()["result"], result);
    assert!(h.transport.reply(reply).is_err());
    let body: Value = h
        .message(&session, call)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(body["result"]["isError"], true);
    assert_eq!(body["result"]["structuredContent"]["code"], "TIMEOUT");
    let mut control = h.event(EVENT_CONTROL).await;
    while control["type"] != "cancel" {
        control = h.event(EVENT_CONTROL).await;
    }
    assert_eq!(control["reason"], "timeout");
}

#[tokio::test]
async fn idle_expiry_and_rotation_revoke_sessions() {
    let mut h = Harness::new().await;
    h.transport.ready("epoch".into()).unwrap();
    let session = h.session().await;
    h.transport.rotate_token("f".repeat(64));
    let mut control = h.event(EVENT_CONTROL).await;
    while control["type"] != "sessionEnded" {
        control = h.event(EVENT_CONTROL).await;
    }
    assert_eq!(control["reason"], "tokenRegenerated");
    assert_eq!(control["clientSessionId"], session);
    assert_eq!(h.init("2025-11-25").await.status(), 401);
    let mut h = Harness::with_options(Options {
        session_idle: Duration::from_millis(100),
        ..Options::default()
    })
    .await;
    h.transport.ready("epoch".into()).unwrap();
    let session = h.session().await;
    tokio::time::sleep(Duration::from_millis(350)).await;
    let mut control = h.event(EVENT_CONTROL).await;
    while control["type"] != "sessionEnded" {
        control = h.event(EVENT_CONTROL).await;
    }
    assert_eq!(control["reason"], "expired");
    assert_eq!(control["clientSessionId"], session);
    assert_eq!(
        h.message(&session, json!({"jsonrpc":"2.0","id":3,"method":"ping"}))
            .send()
            .await
            .unwrap()
            .status(),
        404
    );
}

#[tokio::test]
async fn initialize_ordering_session_cap_and_version_headers() {
    let h = Harness::new().await;
    let res = h.init("2025-11-25").await;
    let session = res.headers()["Mcp-Session-Id"]
        .to_str()
        .unwrap()
        .to_string();
    let body: Value = h
        .message(
            &session,
            json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
        )
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(body.get("error").is_some());
    assert_eq!(
        h.post(json!({"jsonrpc":"2.0","id":2,"method":"ping"}))
            .header("Mcp-Session-Id", &session)
            .header("MCP-Protocol-Version", "2025-06-18")
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    for _ in 0..3 {
        h.session().await;
    }
    assert!(h
        .init("2025-11-25")
        .await
        .json::<Value>()
        .await
        .unwrap()
        .get("error")
        .is_some());
}

#[tokio::test]
async fn cancelled_calls_and_renderer_restart_reject_late_replies() {
    let mut h = Harness::new().await;
    let session = h.session().await;
    h.transport.ready("epoch-1".into()).unwrap();
    let request = h.message(&session,json!({"jsonrpc":"2.0","id":"call","method":"tools/call","params":{"name":"get_session","arguments":{}}}));
    let task =
        tokio::spawn(async move { request.send().await.unwrap().json::<Value>().await.unwrap() });
    let req = h.event(EVENT_REQUEST).await;
    assert_eq!(h.message(&session,json!({"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":"call"}})).send().await.unwrap().status(),202);
    assert_eq!(
        task.await.unwrap()["result"]["structuredContent"]["code"],
        "CANCELLED"
    );
    assert!(h.transport.reply(json!({"type":"failure","requestId":req["requestId"],"bridgeEpoch":"epoch-1","clientSessionId":session,"error":{"code":"TIMEOUT","message":"late"}})).is_err());
    let request = h.message(&session,json!({"jsonrpc":"2.0","id":"restart","method":"tools/call","params":{"name":"get_session","arguments":{}}}));
    let task =
        tokio::spawn(async move { request.send().await.unwrap().json::<Value>().await.unwrap() });
    h.event(EVENT_REQUEST).await;
    h.transport.ready("epoch-2".into()).unwrap();
    assert_eq!(
        task.await.unwrap()["result"]["structuredContent"]["code"],
        "CANCELLED"
    );
    assert_eq!(
        h.message(&session, json!({"jsonrpc":"2.0","id":9,"method":"ping"}))
            .send()
            .await
            .unwrap()
            .status(),
        404
    );
    assert!(h
        .transport
        .publish_status(json!({"bridgeEpoch":"epoch-1","state":{}}))
        .is_err());
}

#[tokio::test]
async fn malformed_envelopes_duplicate_headers_and_methods() {
    let h = Harness::new().await;
    let session = h.session().await;
    for body in [
        json!([]),
        json!([{"jsonrpc":"2.0","id":1,"method":"ping"}]),
        json!({"jsonrpc":"2.0","id":null,"method":"ping"}),
        json!({"jsonrpc":"2.0","id":true,"method":"ping"}),
    ] {
        assert_eq!(
            h.message(&session, body)
                .send()
                .await
                .unwrap()
                .json::<Value>()
                .await
                .unwrap()["error"]["code"],
            -32600
        );
    }
    assert_eq!(
        h.message(&session, json!({"jsonrpc":"2.0","id":7,"method":"missing"}))
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()["error"]["code"],
        -32601
    );
    assert_eq!(
        h.post(json!({}))
            .header("Authorization", format!("Bearer {TOKEN}"))
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    assert_eq!(
        h.post(json!({}))
            .header("Origin", format!("http://{}", h.server.addr))
            .header("Origin", format!("http://{}", h.server.addr))
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    let url = format!("http://{}/mcp", h.server.addr);
    for method in [reqwest::Method::GET, reqwest::Method::DELETE] {
        assert_eq!(
            h.client
                .request(method.clone(), &url)
                .send()
                .await
                .unwrap()
                .status(),
            401
        );
        assert_eq!(
            h.client
                .request(method, &url)
                .bearer_auth(TOKEN)
                .header("Origin", "null")
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
    }
}

#[test]
fn secret_persists_is_private_and_corruption_fails_closed() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("secret.json");
    let file = SecretFile::new(path.clone());
    let token = file.load_or_create().unwrap();
    assert_eq!(token.len(), 64);
    assert!(token
        .bytes()
        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)));
    assert_eq!(
        SecretFile::new(path.clone()).load_or_create().unwrap(),
        token
    );
    assert_ne!(file.regenerate().unwrap(), token);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
    std::fs::write(&path, "{\"version\":1,\"token\":\"broken\"}").unwrap();
    assert!(file.load_or_create().is_err());
    assert!(std::fs::read_to_string(&path).unwrap().contains("broken"));
}

#[tokio::test]
async fn settings_cas_port_conflict_and_general_settings_preserve_ai() {
    let dir = tempfile::tempdir().unwrap();
    let settings = crate::settings::SettingsFile::new(dir.path().join("settings.json"));
    settings
        .write("{\"locale\":\"tr\",\"unrelated\":{\"value\":42}}")
        .unwrap();
    let service = Service::new(
        settings.clone(),
        SecretFile::new(dir.path().join("secret.json")),
        Arc::new(|_, _| Ok(())),
    )
    .unwrap();
    assert_eq!(
        service.get_status().await["snapshot"]["settings"],
        json!({"enabled":false,"port":48765})
    );
    let guard = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let port = guard.local_addr().unwrap().port();
    assert_eq!(
        service
            .set_config(
                AgentSettings {
                    enabled: true,
                    port
                },
                0
            )
            .await["code"],
        "PORT_IN_USE"
    );
    assert_eq!(service.get_status().await["snapshot"]["revision"], 0);
    drop(guard);
    assert_eq!(
        service
            .set_config(
                AgentSettings {
                    enabled: true,
                    port
                },
                0
            )
            .await["ok"],
        true
    );
    assert_eq!(
        service
            .set_config(
                AgentSettings {
                    enabled: false,
                    port
                },
                0
            )
            .await["code"],
        "CONFLICT"
    );
    settings.write("{\"locale\":\"en\",\"unrelated\":{\"value\":42},\"ai\":{\"enabled\":false,\"port\":48765}}").unwrap();
    assert_eq!(
        settings.read_ai().unwrap(),
        AgentSettings {
            enabled: true,
            port
        }
    );
    let text = settings.read().unwrap().unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&text).unwrap()["locale"],
        "en"
    );
    assert_eq!(
        serde_json::from_str::<Value>(&text).unwrap()["unrelated"]["value"],
        42
    );
    assert!(!text.contains("token"));
    assert!(service.regenerate_token(0).await.is_err());
    assert_eq!(service.regenerate_token(1).await.unwrap().revision, 2);
    assert_eq!(
        service
            .set_config(
                AgentSettings {
                    enabled: false,
                    port
                },
                2
            )
            .await["ok"],
        true
    );
    assert!(
        tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port))
            .await
            .is_ok()
    );
}

#[tokio::test]
async fn disabled_server_does_not_accept_messages_on_keepalive_connections() {
    let dir = tempfile::tempdir().unwrap();
    let settings = crate::settings::SettingsFile::new(dir.path().join("settings.json"));
    let service = Service::new(
        settings,
        SecretFile::new(dir.path().join("secret.json")),
        Arc::new(|_, _| Ok(())),
    )
    .unwrap();
    let guard = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let port = guard.local_addr().unwrap().port();
    drop(guard);
    assert_eq!(
        service
            .set_config(
                AgentSettings {
                    enabled: true,
                    port
                },
                0
            )
            .await["ok"],
        true
    );
    let token = service.reveal_token().await.unwrap();
    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{port}/mcp");
    assert_eq!(
        client
            .get(&url)
            .bearer_auth(&token)
            .send()
            .await
            .unwrap()
            .status(),
        405
    );
    assert_eq!(
        service
            .set_config(
                AgentSettings {
                    enabled: false,
                    port
                },
                1
            )
            .await["ok"],
        true
    );
    let result=client.post(&url).bearer_auth(&token).json(&json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","clientInfo":{"name":"late","version":"1"},"capabilities":{}}})).send().await;
    assert!(result.is_err() || result.unwrap().status() != 200);
}

#[tokio::test]
async fn pending_queues_are_bounded_per_client_and_globally() {
    let mut h = Harness::with_options(Options {
        call_timeout: Duration::from_secs(10),
        session_idle: Duration::from_secs(20),
        ..Options::default()
    })
    .await;
    h.transport.ready("epoch".into()).unwrap();
    let first = h.session().await;
    let second = h.session().await;
    let third = h.session().await;
    let mut tasks = Vec::new();
    for session in [&first, &second] {
        for id in 0..32 {
            let request=h.message(session,json!({"jsonrpc":"2.0","id":id,"method":"tools/call","params":{"name":"get_session","arguments":{}}}));
            tasks.push(tokio::spawn(async move {
                request.send().await.unwrap().json::<Value>().await.unwrap()
            }));
        }
        for _ in 0..32 {
            h.event(EVENT_REQUEST).await;
        }
        let result:Value=h.message(session,json!({"jsonrpc":"2.0","id":99,"method":"tools/call","params":{"name":"get_session","arguments":{}}})).send().await.unwrap().json().await.unwrap();
        assert_eq!(
            result["result"]["structuredContent"]["code"],
            "LIMIT_EXCEEDED"
        );
    }
    let result:Value=h.message(&third,json!({"jsonrpc":"2.0","id":99,"method":"tools/call","params":{"name":"get_session","arguments":{}}})).send().await.unwrap().json().await.unwrap();
    assert_eq!(
        result["result"]["structuredContent"]["code"],
        "LIMIT_EXCEEDED"
    );
    h.transport.end_all("disabled");
    for task in tasks {
        assert_eq!(
            task.await.unwrap()["result"]["structuredContent"]["code"],
            "CANCELLED"
        );
    }
}

#[tokio::test]
async fn delete_waits_for_renderer_rollback_confirmation() {
    let mut h = Harness::new().await;
    let session = h.session().await;
    h.transport.ready("epoch".into()).unwrap();
    let request = h
        .client
        .delete(format!("http://{}/mcp", h.server.addr))
        .bearer_auth(TOKEN)
        .header("Mcp-Session-Id", &session)
        .header("MCP-Protocol-Version", "2025-11-25");
    let task = tokio::spawn(async move { request.send().await.unwrap() });
    let mut event = h.event(EVENT_CONTROL).await;
    while event["type"] != "statusRequest" {
        event = h.event(EVENT_CONTROL).await;
    }
    assert!(!task.is_finished());
    assert!(h.transport.publish_status(json!({"bridgeEpoch":"stale","requestId":event["requestId"],"state":{"phase":"ready","transaction":null}})).is_err());
    assert!(!task.is_finished());
    h.transport.publish_status(json!({"bridgeEpoch":"epoch","requestId":event["requestId"],"state":{"phase":"stopped","transaction":{"owner":{"clientSessionId":session}}}})).unwrap();
    assert!(!task.is_finished());
    h.transport.publish_status(json!({"bridgeEpoch":"epoch","requestId":event["requestId"],"state":{"phase":"ready","transaction":null,"worldSessionId":null,"revision":0}})).unwrap();
    assert_eq!(task.await.unwrap().status(), 200);
}

#[tokio::test]
async fn invalid_settings_and_failed_persistence_leave_endpoint_intact() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    let settings = crate::settings::SettingsFile::new(path.clone());
    let service = Service::new(
        settings,
        SecretFile::new(dir.path().join("secret.json")),
        Arc::new(|_, _| Ok(())),
    )
    .unwrap();
    for port in [
        json!(0),
        json!(1023),
        json!(65536),
        json!(1.5),
        json!("48765"),
    ] {
        assert_eq!(
            service
                .set_config_json(json!({"enabled":true,"port":port}), 0)
                .await["code"],
            "INVALID_ARGUMENT"
        );
    }
    let guard = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let port = guard.local_addr().unwrap().port();
    drop(guard);
    assert_eq!(
        service
            .set_config(
                AgentSettings {
                    enabled: true,
                    port
                },
                0
            )
            .await["ok"],
        true
    );
    let token = service.reveal_token().await.unwrap();
    std::fs::remove_file(&path).unwrap();
    std::fs::create_dir(&path).unwrap();
    assert_eq!(
        service
            .set_config(
                AgentSettings {
                    enabled: false,
                    port
                },
                1
            )
            .await["code"],
        "IO"
    );
    assert_eq!(service.get_status().await["snapshot"]["revision"], 1);
    assert_eq!(
        reqwest::Client::new()
            .get(format!("http://127.0.0.1:{port}/mcp"))
            .bearer_auth(token)
            .send()
            .await
            .unwrap()
            .status(),
        405
    );
}

#[tokio::test]
async fn corrupt_secret_startup_fails_closed_and_regeneration_recovers() {
    let dir = tempfile::tempdir().unwrap();
    let settings = crate::settings::SettingsFile::new(dir.path().join("settings.json"));
    let guard = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let port = guard.local_addr().unwrap().port();
    drop(guard);
    settings
        .write_ai(&AgentSettings {
            enabled: true,
            port,
        })
        .unwrap();
    let secret_path = dir.path().join("secret.json");
    std::fs::write(&secret_path, "broken secret").unwrap();
    let service = Service::new(
        settings,
        SecretFile::new(secret_path.clone()),
        Arc::new(|_, _| Ok(())),
    )
    .unwrap();
    service.start().await;
    assert_eq!(service.get_status().await["status"]["state"], "failed");
    assert!(service.reveal_token().await.is_err());
    assert_eq!(
        std::fs::read_to_string(secret_path).unwrap(),
        "broken secret"
    );
    service.regenerate_token(0).await.unwrap();
    assert_eq!(service.get_status().await["status"]["state"], "listening");
    assert_eq!(service.reveal_token().await.unwrap().len(), 64);
    service.shutdown();
}

#[tokio::test]
async fn lost_renderer_heartbeat_revokes_epoch_and_sessions() {
    let mut h = Harness::with_options(Options {
        heartbeat_interval: Duration::from_millis(20),
        heartbeat_timeout: Duration::from_millis(60),
        ..Options::default()
    })
    .await;
    h.transport.ready("epoch".into()).unwrap();
    let session = h.session().await;
    let mut event = h.event(EVENT_CONTROL).await;
    while event["type"] != "sessionEnded" {
        event = h.event(EVENT_CONTROL).await;
    }
    assert_eq!(event["reason"], "disconnect");
    assert_eq!(event["clientSessionId"], session);
    assert!(h
        .transport
        .publish_status(json!({"bridgeEpoch":"epoch","state":{}}))
        .is_err());
    assert_eq!(
        h.message(&session, json!({"jsonrpc":"2.0","id":2,"method":"ping"}))
            .send()
            .await
            .unwrap()
            .status(),
        404
    );
}

#[tokio::test]
async fn config_admission_pause_blocks_reconnects_and_tool_calls() {
    let h = Harness::new().await;
    let session = h.session().await;
    h.transport.ready("epoch".into()).unwrap();
    let pause = h.transport.pause_admission();
    assert!(h
        .init("2025-11-25")
        .await
        .json::<Value>()
        .await
        .unwrap()
        .get("error")
        .is_some());
    let call = json!({"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"get_session","arguments":{}}});
    let result: Value = h
        .message(&session, call.clone())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        result["result"]["structuredContent"]["code"],
        "EDITOR_UNAVAILABLE"
    );
    drop(pause);
    assert_eq!(h.init("2025-11-25").await.status(), 200);
    let result: Value = h
        .message(&session, call)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(result["result"]["structuredContent"]["code"], "TIMEOUT");
}
