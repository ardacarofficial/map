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
        Self::with_transport(transport, events).await
    }
    async fn with_transport(
        transport: Arc<Transport>,
        events: mpsc::UnboundedReceiver<(&'static str, Value)>,
    ) -> Self {
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
        400
    );
    let put = h.client.put(&url).bearer_auth(TOKEN).send().await.unwrap();
    assert_eq!(put.status(), 405);
    assert_eq!(put.headers()["Allow"], "GET, POST, DELETE");
}

#[tokio::test]
async fn access_failures_explain_themselves_and_local_aliases_work() {
    let h = Harness::new().await;
    let url = format!("http://{}/mcp", h.server.addr);
    let port = h.server.addr.port();
    let res = h.client.post(&url).header("Authorization", "Bearer wrong").json(&json!({})).send().await.unwrap();
    assert_eq!(res.status(), 401);
    assert_eq!(res.headers()["WWW-Authenticate"], "Bearer error=\"invalid_token\"");
    let body: Value = res.json().await.unwrap();
    assert!(body["error"]["message"].as_str().unwrap().contains("Settings > AI"));
    let init = json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","clientInfo":{"name":"alias","version":"1"},"capabilities":{}}});
    // Lowercase scheme, localhost / [::1] Host names and matching Origins are local.
    for (scheme, host) in [("bearer", format!("localhost:{port}")), ("BEARER", format!("[::1]:{port}")), ("Bearer", format!("LocalHost:{port}"))] {
        let res = h.client.post(&url).header("Authorization", format!("{scheme}  {TOKEN}")).header("Host", &host)
            .header("Origin", format!("http://{host}")).json(&init).send().await.unwrap();
        assert_eq!(res.status(), 200, "{scheme} {host}");
        assert!(res.headers().contains_key("Mcp-Session-Id"));
    }
    for (host, origin) in [(format!("example.com:{port}"), None), (format!("localhost:{}", port + 1), None), (format!("localhost:{port}"), Some("http://evil.test"))] {
        let mut request = h.post(json!({})).header("Host", &host);
        if let Some(origin) = origin { request = request.header("Origin", origin); }
        let res = request.send().await.unwrap();
        assert_eq!(res.status(), 403, "{host}");
        assert!(res.json::<Value>().await.unwrap()["error"]["message"].is_string());
    }
    let missing = h.message("0".repeat(64).as_str(), json!({"jsonrpc":"2.0","id":2,"method":"ping"})).send().await.unwrap();
    assert_eq!(missing.status(), 404);
    assert!(missing.json::<Value>().await.unwrap()["error"]["message"].as_str().unwrap().contains("initialize"));
    let not_found = h.client.get(format!("http://{}/other", h.server.addr)).send().await.unwrap();
    assert_eq!(not_found.status(), 404);
    assert!(not_found.json::<Value>().await.unwrap()["error"]["message"].as_str().unwrap().contains("/mcp"));
    // A newer client's discovery probe gets a JSON-RPC answer, so it falls back to initialize.
    let discover: Value = h.post(json!({"jsonrpc":"2.0","id":1,"method":"server/discover","params":{}})).send().await.unwrap().json().await.unwrap();
    assert_eq!(discover["error"]["code"], -32601);
    let no_session = h.post(json!({"jsonrpc":"2.0","id":1,"method":"tools/list"})).send().await.unwrap();
    assert_eq!(no_session.status(), 400);
    assert!(no_session.json::<Value>().await.unwrap()["error"]["message"].as_str().unwrap().contains("Mcp-Session-Id"));
    // After initialization an omitted MCP-Protocol-Version means the negotiated one.
    let session = h.session().await;
    let ping: Value = h.post(json!({"jsonrpc":"2.0","id":5,"method":"ping"})).header("Mcp-Session-Id", &session).send().await.unwrap().json().await.unwrap();
    assert_eq!(ping["result"], json!({}));
}

async fn open_stream(h: &Harness, session: &str) -> reqwest::Response {
    let res = h.client.get(format!("http://{}/mcp", h.server.addr)).bearer_auth(TOKEN)
        .header("Accept", "text/event-stream").header("Mcp-Session-Id", session)
        .header("MCP-Protocol-Version", "2025-11-25").send().await.unwrap();
    assert_eq!(res.status(), 200);
    assert_eq!(res.headers()["Content-Type"], "text/event-stream");
    res
}

#[tokio::test]
async fn an_open_stream_keeps_a_quiet_session_and_its_close_ends_it_after_the_grace() {
    let mut h = Harness::with_options(Options {
        session_idle: Duration::from_millis(300),
        stream_keepalive: Duration::from_millis(50),
        stream_grace: Duration::from_millis(300),
        ..Options::default()
    })
    .await;
    h.transport.ready("epoch".into()).unwrap();
    let session = h.session().await;
    let mut stream = open_stream(&h, &session).await;
    assert_eq!(&stream.chunk().await.unwrap().unwrap()[..], b": harita\n\n");
    // Longer than session_idle: the live stream proves the client still exists.
    tokio::time::sleep(Duration::from_millis(700)).await;
    assert_eq!(&stream.chunk().await.unwrap().unwrap()[..], b": keepalive\n\n");
    assert_eq!(h.message(&session, json!({"jsonrpc":"2.0","id":1,"method":"ping"})).send().await.unwrap().status(), 200);
    let second = open_stream(&h, &session).await;
    let third = h.client.get(format!("http://{}/mcp", h.server.addr)).bearer_auth(TOKEN)
        .header("Accept", "text/event-stream").header("Mcp-Session-Id", &session).send().await.unwrap();
    assert_eq!(third.status(), 409);
    drop(second);
    let closed = std::time::Instant::now();
    drop(stream);
    let mut control = h.event(EVENT_CONTROL).await;
    while control["type"] != "sessionEnded" {
        control = h.event(EVENT_CONTROL).await;
    }
    assert_eq!(control["reason"], "disconnect");
    assert_eq!(control["clientSessionId"], session);
    assert!(closed.elapsed() >= Duration::from_millis(250));
    assert!(h.transport.clients().is_empty());
}

#[tokio::test]
async fn the_client_cap_evicts_the_oldest_quiet_session_but_not_live_streams() {
    let mut h = Harness::new().await;
    h.transport.ready("epoch".into()).unwrap();
    let mut sessions = Vec::new();
    for _ in 0..MAX_CLIENTS {
        sessions.push(h.session().await);
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
    let _stream = open_stream(&h, &sessions[0]).await;
    let res = h.init("2025-11-25").await;
    assert_eq!(res.status(), 200);
    let mut control = h.event(EVENT_CONTROL).await;
    while control["type"] != "sessionEnded" {
        control = h.event(EVENT_CONTROL).await;
    }
    assert_eq!(control["reason"], "expired");
    // sessions[0] streams, so the next oldest quiet session made room.
    assert_eq!(control["clientSessionId"], sessions[1]);
    // Until the editor acknowledges the ended session, new clients are asked to retry.
    let busy: Value = h.init("2025-11-25").await.json().await.unwrap();
    assert!(busy["error"]["message"].as_str().unwrap().contains("Retry"));
}

#[tokio::test]
async fn a_full_house_of_live_streams_answers_429_with_a_hint() {
    let h = Harness::new().await;
    let mut streams = Vec::new();
    for _ in 0..MAX_CLIENTS {
        let session = h.session().await;
        streams.push(open_stream(&h, &session).await);
    }
    let res = h.init("2025-11-25").await;
    assert_eq!(res.status(), 429);
    assert!(res.json::<Value>().await.unwrap()["error"]["message"].as_str().unwrap().contains("Close an unused AI client"));
    drop(streams);
}

#[tokio::test]
async fn lifecycle_versions_catalogue_and_sessions() {
    let h = Harness::new().await;
    for version in ["2025-11-25", "2025-06-18"] {
        let res = h.init(version).await;
        let body: Value = res.json().await.unwrap();
        assert_eq!(body["result"]["protocolVersion"], version);
        assert_eq!(body["result"]["serverInfo"]["name"], "harita");
        assert_eq!(body["result"]["instructions"], include_str!("../../../../../../agent/schema/workflow.txt").trim());
    }
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
    let tools = body["result"]["tools"].as_array().unwrap();
    assert!(tools.len() >= 33);
    for name in ["visual_ingest_reference", "visual_match_reference", "create_stamp"] {
        assert!(tools.iter().any(|tool| tool["name"] == name), "missing {name}");
    }
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
async fn complete_api_result_budget_survives_bridge_correlation() {
    let mut h = Harness::with_options(Options {
        call_timeout: Duration::from_secs(3),
        ..Options::default()
    })
    .await;
    h.transport.ready("epoch".into()).unwrap();
    let session = h.session().await;
    let request = h.message(
        &session,
        json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_session"}}),
    );
    let task =
        tokio::spawn(async move { request.send().await.unwrap().json::<Value>().await.unwrap() });
    let req = h.event(EVENT_REQUEST).await;
    let mut result = json!({"content":[{"type":"text","text":""}],"structuredContent":{}});
    let overhead = serde_json::to_vec(&result).unwrap().len();
    result["content"][0]["text"] = json!("x".repeat(super::transport::MAX_REPLY - overhead));
    assert_eq!(
        serde_json::to_vec(&result).unwrap().len(),
        super::transport::MAX_REPLY
    );
    let reply = json!({"type":"result","requestId":req["requestId"],"clientSessionId":session,"bridgeEpoch":"epoch","result":result});
    let mut too_large = reply.clone();
    too_large["result"]["structuredContent"]["tooLarge"] = json!(true);
    assert!(h.transport.reply(too_large).is_err());
    h.transport.reply(reply).unwrap();
    assert_eq!(task.await.unwrap()["result"], result);
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
        400
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
    h.transport.publish_status(json!({"bridgeEpoch":"epoch","requestId":event["requestId"],"state":{"phase":"ready","transaction":{"state":"cancelled","owner":{"clientSessionId":session}},"worldSessionId":null,"revision":0}})).unwrap();
    assert_eq!(task.await.unwrap().status(), 200);
}

#[tokio::test]
async fn delete_accepts_detached_review_without_rolling_it_back() {
    for phase in ["stopped", "awaitingApproval"] {
        let mut h = Harness::new().await;
        let session = h.session().await;
        h.transport.ready("epoch".into()).unwrap();
        let request = h.client.delete(format!("http://{}/mcp", h.server.addr))
            .bearer_auth(TOKEN).header("Mcp-Session-Id", &session)
            .header("MCP-Protocol-Version", "2025-11-25");
        let mut task = tokio::spawn(async move { request.send().await.unwrap() });
        let mut event = h.event(EVENT_CONTROL).await;
        while event["type"] != "statusRequest" { event = h.event(EVENT_CONTROL).await; }
        // A detached running edit is not a safe end acknowledgement.
        h.transport.publish_status(json!({"bridgeEpoch":"epoch","requestId":event["requestId"],"state":{"phase":"running","transaction":{"owner":{"clientSessionId":null}}}})).unwrap();
        assert!(tokio::time::timeout(Duration::from_millis(20), &mut task).await.is_err());
        h.transport.publish_status(json!({"bridgeEpoch":"epoch","requestId":event["requestId"],"state":{"phase":phase,"transaction":{"state":phase,"owner":{"clientSessionId":null,"clientInfo":{"name":"Test","version":"1"}}}}})).unwrap();
        assert_eq!(task.await.unwrap().status(), 200);
    }
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
        400
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

#[tokio::test]
async fn unsupported_version_negotiates_fallback_and_enforces_selected_header() {
    let h = Harness::new().await;
    let res = h.init("2099-01-01").await;
    let session = res.headers()["Mcp-Session-Id"]
        .to_str()
        .unwrap()
        .to_string();
    assert_eq!(
        res.json::<Value>().await.unwrap()["result"]["protocolVersion"],
        "2025-11-25"
    );
    assert_eq!(
        h.message(
            &session,
            json!({"jsonrpc":"2.0","method":"notifications/initialized"})
        )
        .send()
        .await
        .unwrap()
        .status(),
        202
    );
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
    assert_eq!(
        h.message(&session, json!({"jsonrpc":"2.0","id":3,"method":"ping"}))
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()["result"],
        json!({})
    );
}

#[tokio::test]
async fn window_services_keep_settings_tokens_and_lifetimes_independent() {
    let dir = tempfile::tempdir().unwrap();
    let settings = crate::settings::SettingsFile::new(dir.path().join("settings.json"));
    let windows = WindowServices::new(dir.path().to_owned(), settings.clone());
    let main = windows.register("main", Arc::new(|_, _| Ok(()))).unwrap();
    let second = windows.register("world-1", Arc::new(|_, _| Ok(()))).unwrap();
    assert_eq!(main.get_status().await["snapshot"]["settings"], json!({"enabled":false,"port":48765}));
    assert_eq!(second.get_status().await["snapshot"]["settings"], json!({"enabled":false,"port":48766}));
    assert_ne!(main.reveal_token().await.unwrap(), second.reveal_token().await.unwrap());
    assert!(windows.register("main", Arc::new(|_, _| Ok(()))).is_err());
    for invalid in ["world-0", "world-01", "world-+1", "world-../main", "../main", "other", "world-65536"] {
        assert!(windows.register(invalid, Arc::new(|_, _| Ok(()))).is_err(), "{invalid}");
    }
    assert!(windows.get("other").is_none());
    assert_eq!(second.set_config(AgentSettings { enabled: false, port: 49001 }, 0).await["ok"], true);
    assert_eq!(main.get_status().await["snapshot"]["revision"], 0);
    assert_eq!(main.get_status().await["snapshot"]["settings"]["port"], 48765);
    assert_eq!(settings.read_ai().unwrap(), AgentSettings::default());
    let second_file = crate::settings::SettingsFile::new(dir.path().join("windows/world-1/ai-settings.json"));
    assert_eq!(second_file.read_ai().unwrap().port, 49001);
    windows.remove("main").unwrap();
    assert!(windows.get("main").is_none());
    assert!(main.transport().ready("late-main".into()).is_err());
    assert_eq!(main.set_config(AgentSettings::default(), 0).await["code"], "EDITOR_UNAVAILABLE");
    assert!(main.reveal_token().await.is_err());
    assert!(second.transport().ready("still-alive".into()).is_ok());
    assert_eq!(second.get_status().await["snapshot"]["revision"], 1);
    assert!(windows.get("world-1").is_some());
    windows.shutdown_all();
    assert!(second.transport().ready("late-second".into()).is_err());
}

#[tokio::test]
async fn window_requests_replies_status_and_teardown_cannot_cross() {
    let dir = tempfile::tempdir().unwrap();
    let settings = crate::settings::SettingsFile::new(dir.path().join("settings.json"));
    let windows = WindowServices::new(dir.path().to_owned(), settings);
    let (tx_a, events_a) = mpsc::unbounded_channel();
    let (tx_b, events_b) = mpsc::unbounded_channel();
    let service_a = windows.register("main", Arc::new(move |event, value| {
        tx_a.send((event, value)).map_err(|_| "closed".into())
    })).unwrap();
    let service_b = windows.register("world-1", Arc::new(move |event, value| {
        tx_b.send((event, value)).map_err(|_| "closed".into())
    })).unwrap();
    // Deliberately share credentials and epochs: native service ownership must
    // still separate correlation IDs, client sessions and published world IDs.
    service_a.transport().rotate_token(TOKEN.into());
    service_b.transport().rotate_token(TOKEN.into());
    let mut a = Harness::with_transport(service_a.transport().clone(), events_a).await;
    let mut b = Harness::with_transport(service_b.transport().clone(), events_b).await;
    a.transport.ready("same-epoch".into()).unwrap();
    b.transport.ready("same-epoch".into()).unwrap();
    a.transport.publish_status(json!({"bridgeEpoch":"same-epoch","state":{"worldSessionId":"world-a","revision":11}})).unwrap();
    b.transport.publish_status(json!({"bridgeEpoch":"same-epoch","state":{"worldSessionId":"world-b","revision":22}})).unwrap();
    let session_a = a.session().await;
    let session_b = b.session().await;
    assert_ne!(session_a, session_b);
    assert_eq!(b.message(&session_a, json!({"jsonrpc":"2.0","id":1,"method":"ping"})).send().await.unwrap().status(), 404);
    let call = |marker: &str| json!({"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"get_session","arguments":{"marker":marker}}});
    let request_a = a.message(&session_a, call("a"));
    let request_b = b.message(&session_b, call("b"));
    let task_a = tokio::spawn(async move { request_a.send().await.unwrap().json::<Value>().await.unwrap() });
    let task_b = tokio::spawn(async move { request_b.send().await.unwrap().json::<Value>().await.unwrap() });
    let event_a = a.event(EVENT_REQUEST).await;
    let event_b = b.event(EVENT_REQUEST).await;
    assert_eq!(event_a["arguments"]["marker"], "a");
    assert_eq!(event_b["arguments"]["marker"], "b");
    let result = json!({"content":[{"type":"text","text":"{}"}],"structuredContent":{"ok":true,"worldSessionId":"world-b"}});
    let reply_a = json!({"type":"result","requestId":event_a["requestId"],"bridgeEpoch":"same-epoch","clientSessionId":session_a,"result":result});
    assert!(b.transport.reply(reply_a).is_err());
    let reply_b = json!({"type":"result","requestId":event_b["requestId"],"bridgeEpoch":"same-epoch","clientSessionId":session_b,"result":result});
    assert!(a.transport.reply(reply_b.clone()).is_err());
    windows.remove("main").unwrap();
    let cancelled = task_a.await.unwrap();
    assert_eq!(cancelled["result"]["structuredContent"]["code"], "CANCELLED");
    assert_eq!(cancelled["result"]["structuredContent"]["worldSessionId"], "world-a");
    b.transport.reply(reply_b).unwrap();
    assert_eq!(task_b.await.unwrap()["result"], result);
    assert_eq!(b.transport.clients().len(), 1);
    assert!(windows.get("world-1").is_some());
    assert_eq!(b.message(&session_b, json!({"jsonrpc":"2.0","id":20,"method":"ping"})).send().await.unwrap().status(), 200);
    assert_eq!(a.init("2025-11-25").await.status(), 503);
}

#[tokio::test]
async fn closing_a_window_during_endpoint_configuration_releases_the_candidate_socket() {
    let dir = tempfile::tempdir().unwrap();
    let settings = crate::settings::SettingsFile::new(dir.path().join("settings.json"));
    let windows = WindowServices::new(dir.path().to_owned(), settings.clone());
    let (tx, events) = mpsc::unbounded_channel();
    let service = windows.register("main", Arc::new(move |event, value| {
        tx.send((event, value)).map_err(|_| "closed".into())
    })).unwrap();
    service.transport().rotate_token(TOKEN.into());
    let mut h = Harness::with_transport(service.transport().clone(), events).await;
    h.transport.ready("epoch".into()).unwrap();
    h.session().await;
    let candidate = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).await.unwrap();
    let port = candidate.local_addr().unwrap().port();
    drop(candidate);
    let configuring = service.clone();
    let update = tokio::spawn(async move {
        configuring.set_config(AgentSettings { enabled: true, port }, 0).await
    });
    loop {
        if h.event(EVENT_CONTROL).await["type"] == "sessionEnded" { break; }
    }
    windows.remove("main").unwrap();
    service.finish_shutdown().await;
    assert_eq!(update.await.unwrap()["code"], "EDITOR_UNAVAILABLE");
    assert_eq!(service.get_status().await["snapshot"]["revision"], 0);
    assert_eq!(settings.read_ai().unwrap(), AgentSettings::default());
    service.start().await;
    assert!(service.transport().ready("late-epoch".into()).is_err());
    assert!(tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await.is_ok());
}

#[tokio::test]
async fn guide_resources_and_prompts_are_discoverable_and_bound_to_authenticated_sessions() {
    let h = Harness::new().await;
    assert_eq!(h.post(json!({"jsonrpc":"2.0","id":1,"method":"resources/list"})).send().await.unwrap().status(), 400);
    let initialized = h.init("2025-11-25").await;
    let session = initialized.headers()["Mcp-Session-Id"].to_str().unwrap().to_owned();
    let initialization: Value = initialized.json().await.unwrap();
    assert_eq!(initialization["result"]["capabilities"]["resources"], json!({"subscribe":false,"listChanged":false}));
    assert_eq!(initialization["result"]["capabilities"]["prompts"], json!({"listChanged":false}));
    let request = |method: &str, params: Value| h.message(&session, json!({"jsonrpc":"2.0","id":20,"method":method,"params":params}));
    let not_ready: Value = request("resources/list", json!({})).send().await.unwrap().json().await.unwrap();
    assert!(not_ready.get("error").is_some());
    assert_eq!(h.message(&session, json!({"jsonrpc":"2.0","method":"notifications/initialized"})).send().await.unwrap().status(), 202);
    let listing: Value = request("resources/list", json!({})).send().await.unwrap().json().await.unwrap();
    let resources = listing["result"]["resources"].as_array().unwrap();
    assert_eq!(resources.len(), 9);
    assert!(!listing.to_string().contains("contentPath"));
    for resource in resources {
        assert!(resource.get("text").is_none());
        let response: Value = request("resources/read", json!({"uri":resource["uri"]})).send().await.unwrap().json().await.unwrap();
        let content = &response["result"]["contents"][0];
        assert_eq!(content["uri"], resource["uri"]);
        assert_eq!(content["mimeType"], "text/markdown");
        assert!(content["text"].as_str().is_some_and(|s| !s.trim().is_empty() && s.len() <= 32768));
    }
    let templates: Value = request("resources/templates/list", json!({})).send().await.unwrap().json().await.unwrap();
    assert_eq!(templates["result"], json!({"resourceTemplates":[]}));
    for uri in ["file:///etc/passwd", "harita://guide/../secret", "harita://guide/unknown"] {
        let response: Value = request("resources/read", json!({"uri":uri})).send().await.unwrap().json().await.unwrap();
        assert_eq!(response["error"]["code"], -32002);
    }
    for (method, params) in [
        ("resources/read", json!({})), ("resources/list", json!({"cursor":"unknown"})),
        ("prompts/get", json!({"name":"unknown","arguments":{"task":"village"}})),
        ("prompts/get", json!({"name":"harita-map-task","arguments":{"task":"x".repeat(2001)}})),
        ("prompts/get", json!({"name":"harita-map-task","arguments":{"task":"village","topic":"../secret"}})),
    ] {
        let response: Value = request(method, params).send().await.unwrap().json().await.unwrap();
        assert_eq!(response["error"]["code"], -32602, "{method}");
    }
    let prompts: Value = request("prompts/list", json!({})).send().await.unwrap().json().await.unwrap();
    assert_eq!(prompts["result"]["prompts"][0]["name"], "harita-map-task");
    let prompt: Value = request("prompts/get", json!({"name":"harita-map-task","arguments":{"task":"Design a village","topic":"collaboration"}})).send().await.unwrap().json().await.unwrap();
    let message = prompt["result"]["messages"][0]["content"]["text"].as_str().unwrap();
    assert!(message.contains("Design a village"));
    assert!(message.contains("harita://guide/collaboration"));
    assert!(message.contains("harita://guide/skill"));
    assert!(message.len() < 8192);
    let unauthenticated = h.client.post(format!("http://{}/mcp", h.server.addr)).json(&json!({"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"harita://guide/skill"}})).send().await.unwrap();
    assert_eq!(unauthenticated.status(), 401);
}

#[tokio::test]
async fn collaborative_disconnect_waits_for_only_the_departed_members_cleanup() {
    for owner_is_departing in [false, true] {
        let mut h = Harness::new().await;
        let departed = h.session().await;
        let peer = h.session().await;
        h.transport.ready("epoch".into()).unwrap();
        let request = h.client.delete(format!("http://{}/mcp", h.server.addr)).bearer_auth(TOKEN)
            .header("Mcp-Session-Id", &departed).header("MCP-Protocol-Version", "2025-11-25");
        let mut deletion = tokio::spawn(async move { request.send().await.unwrap() });
        let mut event = h.event(EVENT_CONTROL).await;
        while event["type"] != "statusRequest" { event = h.event(EVENT_CONTROL).await; }
        let owner = if owner_is_departing { json!(departed) } else { json!(peer) };
        let mut state = json!({"phase":"running","transaction":{"state":"running","owner":{"clientSessionId":owner},
            "collaboration":{"mode":"regions","joinOpen":false,"members":[
                {"id":"departing","clientSessionId":departed,"state":"cancelling","detached":false},
                {"id":"peer","clientSessionId":peer,"state":"running","detached":false}
            ]}}});
        h.transport.publish_status(json!({"bridgeEpoch":"epoch","requestId":event["requestId"],"state":state})).unwrap();
        assert!(tokio::time::timeout(Duration::from_millis(20), &mut deletion).await.is_err());
        state["transaction"]["collaboration"]["members"][0]["clientSessionId"] = Value::Null;
        state["transaction"]["collaboration"]["members"][0]["state"] = json!("cancelled");
        state["transaction"]["collaboration"]["members"][0]["detached"] = json!(true);
        if owner_is_departing { state["transaction"]["owner"]["clientSessionId"] = Value::Null; }
        h.transport.publish_status(json!({"bridgeEpoch":"epoch","requestId":event["requestId"],"state":state})).unwrap();
        assert_eq!(deletion.await.unwrap().status(), 200);
        assert_eq!(h.transport.clients().len(), 1);
        assert_eq!(h.message(&peer, json!({"jsonrpc":"2.0","id":4,"method":"ping"})).send().await.unwrap().status(), 200);
        assert_eq!(h.init("2025-11-25").await.status(), 200);
    }
}
