use super::secret::random_hex;
use axum::{
    body::{to_bytes, Body},
    extract::{Request, State},
    http::{HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::any,
    Json, Router,
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io,
    net::{Ipv4Addr, SocketAddr},
    sync::{Arc, Mutex, Weak},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use subtle::ConstantTimeEq;
use tokio::{
    net::TcpListener,
    sync::{oneshot, watch},
    task::JoinHandle,
};

pub const EVENT_REQUEST: &str = "smap://agent-request";
pub const EVENT_CONTROL: &str = "smap://agent-control";
pub const EVENT_STATUS: &str = "smap://agent-status";
const VERSIONS: [&str; 2] = ["2025-11-25", "2025-06-18"];
const CATALOGUE: &str = include_str!("../../../../../../agent/schema/tools.json");
const WORKFLOW: &str = include_str!("../../../../../../agent/schema/workflow.txt");
pub const MAX_REPLY: usize = 8 * 1024 * 1024;
pub const MAX_CLIENTS: usize = 16;
// AgentToolResult has its own full MAX_REPLY budget before bridge correlation.
const BRIDGE_OVERHEAD_LIMIT: usize = 1024;
pub type BridgeSink = Arc<dyn Fn(&'static str, Value) -> Result<(), String> + Send + Sync>;

#[derive(Clone)]
pub struct Options {
    pub call_timeout: Duration,
    pub image_timeout: Duration,
    pub session_idle: Duration,
    pub heartbeat_interval: Duration,
    pub heartbeat_timeout: Duration,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            call_timeout: Duration::from_secs(10),
            image_timeout: Duration::from_secs(30),
            session_idle: Duration::from_secs(300),
            heartbeat_interval: Duration::from_secs(5),
            heartbeat_timeout: Duration::from_secs(15),
        }
    }
}

impl Options {
    fn tool_timeout(&self, name: &str, arguments: &Value) -> Duration {
        let renders_image = match name {
            "render_preview" | "prepare_smart_source" | "begin_edit"
            | "visual_ingest_reference" | "visual_match_reference"
            | "reference_add" | "reference_view" | "reference_quantize" | "render_compare" => true,
            // The agent defaults an omitted image mode to "tiles".
            "get_tile_catalog" => arguments["image"].as_str() != Some("none"),
            "list_stamps" => arguments["previewStampId"].is_string() || arguments["includeSheet"] == true,
            _ => false,
        };
        if renders_image {
            self.image_timeout
        } else {
            self.call_timeout
        }
    }
}
struct Session {
    info: Value,
    version: String,
    initialized: bool,
    touched: Instant,
}
struct Pending {
    epoch: String,
    session: String,
    rpc_id: Value,
    deadline: Instant,
    tx: oneshot::Sender<Value>,
}
struct PendingEnd {
    epoch: String,
    sessions: Vec<String>,
    done: watch::Sender<bool>,
}
struct Inner {
    token: String,
    epoch: Option<String>,
    sessions: HashMap<String, Session>,
    pending: HashMap<String, Pending>,
    published: Option<Value>,
    port: Option<u16>,
    generation: u64,
    token_revision: u64,
    ending: HashMap<String, PendingEnd>,
    heartbeat: Option<(String, Instant)>,
    last_heartbeat: Instant,
    admission_pauses: usize,
    closed: bool,
}
pub struct Transport {
    inner: Mutex<Inner>,
    sink: BridgeSink,
    options: Options,
}
/// The HTTP handler may disappear before its timeout future can run.
struct PendingCall<'a> {
    transport: &'a Transport,
    id: String,
}
impl Drop for PendingCall<'_> {
    fn drop(&mut self) {
        self.transport.cancel_request(&self.id, "clientCancelled");
    }
}
/// Keeps configuration persistence and cancellation one admission boundary.
pub struct AdmissionPause<'a> {
    transport: &'a Transport,
}
impl Drop for AdmissionPause<'_> {
    fn drop(&mut self) {
        self.transport.inner.lock().unwrap().admission_pauses -= 1;
    }
}
pub struct RunningServer {
    pub addr: SocketAddr,
    task: JoinHandle<()>,
    expiry: JoinHandle<()>,
    transport: Weak<Transport>,
    generation: u64,
}
impl RunningServer {
    pub async fn stop(mut self) {
        self.task.abort();
        self.expiry.abort();
        let _ = (&mut self.task).await;
        let _ = (&mut self.expiry).await;
    }
}
impl Drop for RunningServer {
    fn drop(&mut self) {
        if let Some(transport) = self.transport.upgrade() {
            let mut inner = transport.inner.lock().unwrap();
            if inner.generation == self.generation {
                inner.port = None;
                inner.generation += 1;
            }
        }
        self.task.abort();
        self.expiry.abort();
    }
}

impl Transport {
    pub fn pause_admission(&self) -> AdmissionPause<'_> {
        self.inner.lock().unwrap().admission_pauses += 1;
        AdmissionPause { transport: self }
    }
    pub fn new(token: String, sink: BridgeSink, options: Options) -> Arc<Self> {
        Arc::new(Self {
            inner: Mutex::new(Inner {
                token,
                epoch: None,
                sessions: HashMap::new(),
                pending: HashMap::new(),
                published: None,
                port: None,
                generation: 0,
                token_revision: 0,
                ending: HashMap::new(),
                heartbeat: None,
                last_heartbeat: Instant::now(),
                admission_pauses: 0,
                closed: false,
            }),
            sink,
            options,
        })
    }
    pub async fn bind(self: &Arc<Self>, port: u16) -> io::Result<RunningServer> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, port)).await?;
        Ok(self.serve_listener(listener))
    }
    pub(super) fn serve_listener(self: &Arc<Self>, listener: TcpListener) -> RunningServer {
        let addr = listener.local_addr().expect("bound TCP listener");
        let generation = {
            let mut inner = self.inner.lock().unwrap();
            inner.port = Some(addr.port());
            inner.generation += 1;
            inner.generation
        };
        let app = Router::new()
            .route("/mcp", any(handle))
            .fallback(fallback)
            .with_state((self.clone(), addr.port(), generation));
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let transport = self.clone();
        let tick = self
            .options
            .session_idle
            .min(Duration::from_secs(1))
            .min(self.options.heartbeat_interval)
            .max(Duration::from_millis(10));
        let expiry = tokio::spawn(async move {
            let mut timer = tokio::time::interval(tick);
            loop {
                timer.tick().await;
                transport.expire();
                transport.probe_ends();
                transport.tick_renderer();
            }
        });
        self.push_status("listening", addr.port(), None);
        RunningServer {
            addr,
            task,
            expiry,
            transport: Arc::downgrade(self),
            generation,
        }
    }
    fn emit(&self, event: &'static str, value: Value) -> Result<(), String> {
        (self.sink)(event, value)
    }
    pub fn push_status(&self, state: &str, port: u16, detail: Option<&str>) {
        let clients: Vec<Value> = self
            .inner
            .lock()
            .unwrap()
            .sessions
            .values()
            .map(|s| s.info.clone())
            .collect();
        let mut clients = clients;
        clients.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
        let mut status = json!({"state": if state == "listening" && !clients.is_empty() { "connected" } else {state}, "port": port, "clients": clients});
        if let Some(detail) = detail {
            status["detail"] = json!(detail);
        }
        let _ = self.emit(EVENT_STATUS, status);
    }
    pub fn clients(&self) -> Vec<Value> {
        let mut clients: Vec<_> = self
            .inner
            .lock()
            .unwrap()
            .sessions
            .values()
            .map(|s| s.info.clone())
            .collect();
        clients.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
        clients
    }
    fn changed(&self) {
        let port = self.inner.lock().unwrap().port;
        if let Some(port) = port {
            self.push_status("listening", port, None);
        }
    }
    pub fn renderer_lost(&self) {
        let (epoch, sessions) = {
            let mut inner = self.inner.lock().unwrap();
            let ended = revoke(&mut inner);
            clear_ends(&mut inner);
            inner.epoch = None;
            inner.published = None;
            ended
        };
        self.emit_ended(epoch, sessions, "disconnect");
    }
    pub fn ready(&self, epoch: String) -> Result<(), String> {
        if epoch.is_empty() || epoch.len() > 128 {
            return Err("invalid epoch".into());
        }
        let (ended, sessions) = {
            let mut inner = self.inner.lock().unwrap();
            if inner.closed { return Err("window closed".into()); }
            let ended = if inner.epoch.as_ref().is_some_and(|e| e != &epoch) {
                let ended = revoke(&mut inner);
                clear_ends(&mut inner);
                Some(ended)
            } else {
                None
            };
            inner.epoch = Some(epoch.clone());
            inner.heartbeat = None;
            inner.last_heartbeat = Instant::now();
            inner.published = None;
            let sessions = inner
                .sessions
                .iter()
                .filter(|(_, s)| s.initialized)
                .map(|(id, s)| (id.clone(), s.info.clone()))
                .collect::<Vec<_>>();
            (ended, sessions)
        };
        if let Some((old_epoch, sessions)) = ended {
            self.emit_ended(old_epoch, sessions, "disconnect");
        }
        for (id, info) in sessions {
            self.emit(EVENT_CONTROL,json!({"type":"sessionStarted","bridgeEpoch":epoch,"clientSessionId":id,"clientInfo":info}))?;
        }
        Ok(())
    }
    pub fn publish_status(&self, status: Value) -> Result<(), String> {
        let mut inner = self.inner.lock().unwrap();
        if inner.epoch.is_none()
            || status["bridgeEpoch"].as_str() != inner.epoch.as_deref()
            || !status["state"].is_object()
        {
            return Err("stale epoch or invalid status".into());
        }
        if let Some(id) = status["requestId"].as_str() {
            if inner
                .heartbeat
                .as_ref()
                .is_some_and(|(pending, _)| pending == id)
            {
                inner.heartbeat = None;
                inner.last_heartbeat = Instant::now();
            }
            if let Some(pending) = inner.ending.get(id) {
                let state = &status["state"];
                let phase = state["phase"].as_str();
                let transaction = &state["transaction"];
                let owner = transaction["owner"]["clientSessionId"].as_str();
                // Review belongs to the human after disconnect. Acknowledge its
                // detached owner without demanding rollback of the retained edit.
                let detached_review = matches!(phase, Some("stopped" | "awaitingApproval"))
                    && transaction["state"].as_str() == phase
                    && transaction["owner"]
                        .get("clientSessionId")
                        .is_some_and(Value::is_null);
                let finalized = phase == Some("ready")
                    && matches!(transaction["state"].as_str(), Some("approved" | "cancelled"));
                let collaboration = transaction.get("collaboration").filter(|value| !value.is_null());
                // A group's owner may be another client while a departed
                // member is still undoing its own contribution. Keep admission
                // paused until that member's authenticated session is detached.
                let members_settled = collaboration.is_none_or(|group| {
                    group["members"].as_array().is_some_and(|members| members.iter().all(|member| {
                        member.get("clientSessionId").is_some_and(|session| session.is_null()
                            || session.as_str().is_some_and(|id| !pending.sessions.iter().any(|s| s == id)))
                    }))
                });
                let owner_detached = collaboration.is_some()
                    && transaction["owner"].get("clientSessionId").is_some_and(Value::is_null);
                let settled = phase.is_some_and(|p| p != "cancelling")
                    && (transaction.is_null()
                        || finalized
                        || (members_settled && (detached_review || owner_detached
                            || owner.is_some_and(|id| !pending.sessions.iter().any(|s| s == id)))));
                if settled {
                    let pending = inner.ending.remove(id).unwrap();
                    let _ = pending.done.send(true);
                }
            }
        }
        inner.published = Some(status["state"].clone());
        Ok(())
    }
    pub fn reply(&self, reply: Value) -> Result<(), String> {
        if serde_json::to_vec(&reply)
            .map_err(|_| "invalid reply")?
            .len()
            > MAX_REPLY + BRIDGE_OVERHEAD_LIMIT
        {
            return Err("reply too large".into());
        }
        let id = reply["requestId"].as_str().ok_or("missing request id")?;
        let mut inner = self.inner.lock().unwrap();
        let pending = inner.pending.get(id).ok_or("unknown request id")?;
        if reply["bridgeEpoch"].as_str() != Some(&pending.epoch)
            || inner.epoch.as_deref() != Some(&pending.epoch)
            || reply["clientSessionId"].as_str() != Some(&pending.session)
            || Instant::now() >= pending.deadline
        {
            return Err("stale correlation or deadline".into());
        }
        let result = match reply["type"].as_str() {
            Some("result")
                if valid_result(&reply["result"])
                    && serde_json::to_vec(&reply["result"])
                        .map_err(|_| "invalid result")?
                        .len()
                        <= MAX_REPLY =>
            {
                reply["result"].clone()
            }
            Some("failure") => {
                let code = reply["error"]["code"].as_str().ok_or("invalid failure")?;
                if ![
                    "EDITOR_UNAVAILABLE",
                    "TIMEOUT",
                    "CANCELLED",
                    "LIMIT_EXCEEDED",
                    "STALE_EPOCH",
                    "INTERNAL_ERROR",
                ]
                .contains(&code)
                {
                    return Err("invalid failure code".into());
                }
                failure(
                    &inner,
                    if code == "STALE_EPOCH" {
                        "EDITOR_UNAVAILABLE"
                    } else {
                        code
                    },
                )
            }
            _ => return Err("invalid reply envelope".into()),
        };
        let pending = inner.pending.remove(id).unwrap();
        pending.tx.send(result).map_err(|_| "request ended".into())
    }
    pub fn rotate_token(&self, token: String) {
        let (epoch, sessions) = {
            let mut inner = self.inner.lock().unwrap();
            inner.token = token;
            inner.token_revision += 1;
            revoke(&mut inner)
        };
        self.emit_ended(epoch, sessions, "tokenRegenerated");
    }
    pub fn end_sessions(&self, reason: &str) {
        let (epoch, sessions) = {
            let mut inner = self.inner.lock().unwrap();
            revoke(&mut inner)
        };
        self.emit_ended(epoch, sessions, reason);
    }
    pub fn end_all(&self, reason: &str) {
        let (epoch, sessions) = {
            let mut inner = self.inner.lock().unwrap();
            if ["disabled", "shutdown"].contains(&reason) {
                inner.port = None;
                inner.generation += 1;
            }
            let ended = revoke(&mut inner);
            if reason == "shutdown" {
                clear_ends(&mut inner);
                inner.closed = true;
                inner.epoch = None;
                inner.published = None;
            }
            ended
        };
        self.emit_ended(epoch, sessions, reason);
    }
    pub(super) fn is_shutdown(&self) -> bool {
        self.inner.lock().unwrap().closed
    }
    fn emit_ended(&self, epoch: Option<String>, sessions: Vec<String>, reason: &str) {
        if let Some(epoch) = epoch {
            for session in sessions {
                let _ = self.emit(EVENT_CONTROL,json!({"type":"sessionEnded","bridgeEpoch":epoch,"clientSessionId":session,"reason":reason}));
            }
        }
        self.changed();
        self.probe_ends();
    }
    fn probe_ends(&self) {
        let probes: Vec<_> = self
            .inner
            .lock()
            .unwrap()
            .ending
            .iter()
            .map(|(id, p)| json!({"type":"statusRequest","bridgeEpoch":p.epoch,"requestId":id}))
            .collect();
        for probe in probes {
            let _ = self.emit(EVENT_CONTROL, probe);
        }
    }
    pub async fn wait_for_ends(&self) -> Result<(), ()> {
        let receivers: Vec<_> = self
            .inner
            .lock()
            .unwrap()
            .ending
            .values()
            .map(|p| p.done.subscribe())
            .collect();
        let wait = async {
            for mut receiver in receivers {
                while !*receiver.borrow_and_update() {
                    if receiver.changed().await.is_err() {
                        return Err(());
                    }
                }
            }
            Ok(())
        };
        tokio::time::timeout(self.options.call_timeout, wait)
            .await
            .map_err(|_| ())?
    }
    fn end_session(&self, session: &str, reason: &str) {
        let (epoch, port) = {
            let mut inner = self.inner.lock().unwrap();
            if inner.sessions.remove(session).is_none() {
                return;
            }
            let ids: Vec<_> = inner
                .pending
                .iter()
                .filter(|(_, p)| p.session == session)
                .map(|(id, _)| id.clone())
                .collect();
            for id in ids {
                let pending = inner.pending.remove(&id).unwrap();
                let _ = pending.tx.send(failure(&inner, "CANCELLED"));
            }
            register_end(&mut inner, vec![session.into()]);
            (inner.epoch.clone(), inner.port)
        };
        if let Some(epoch) = epoch {
            let _ = self.emit(EVENT_CONTROL, json!({"type":"sessionEnded","bridgeEpoch":epoch,"clientSessionId":session,"reason":reason}));
        }
        if port.is_some() {
            self.changed();
        }
        self.probe_ends();
    }
    fn tick_renderer(&self) {
        let (lost, probe) = {
            let mut inner = self.inner.lock().unwrap();
            let Some(epoch) = inner.epoch.clone() else {
                return;
            };
            if inner
                .heartbeat
                .as_ref()
                .is_some_and(|(_, sent)| sent.elapsed() >= self.options.heartbeat_timeout)
            {
                let ended = revoke(&mut inner);
                clear_ends(&mut inner);
                inner.epoch = None;
                inner.published = None;
                inner.heartbeat = None;
                (Some(ended), None)
            } else if inner.heartbeat.is_none()
                && inner.last_heartbeat.elapsed() >= self.options.heartbeat_interval
            {
                let Ok(id) = random_hex() else {
                    return;
                };
                inner.heartbeat = Some((id.clone(), Instant::now()));
                (
                    None,
                    Some(json!({"type":"statusRequest","bridgeEpoch":epoch,"requestId":id})),
                )
            } else {
                (None, None)
            }
        };
        if let Some((epoch, sessions)) = lost {
            self.emit_ended(epoch, sessions, "disconnect");
        }
        if let Some(probe) = probe {
            let _ = self.emit(EVENT_CONTROL, probe);
        }
    }
    fn expire(&self) {
        let ids: Vec<_> = self
            .inner
            .lock()
            .unwrap()
            .sessions
            .iter()
            .filter(|(_, s)| s.touched.elapsed() >= self.options.session_idle)
            .map(|(id, _)| id.clone())
            .collect();
        for id in ids {
            self.end_session(&id, "expired");
        }
    }
    fn cancel(&self, session: &str, rpc_id: &Value, reason: &str) {
        let id = self
            .inner
            .lock()
            .unwrap()
            .pending
            .iter()
            .find(|(_, p)| p.session == session && p.rpc_id == *rpc_id)
            .map(|(id, _)| id.clone());
        if let Some(id) = id {
            self.cancel_request(&id, reason);
        }
    }
    fn cancel_request(&self, id: &str, reason: &str) {
        let found = {
            let mut inner = self.inner.lock().unwrap();
            inner.pending.remove(id).map(|p| {
                (
                    p,
                    failure(
                        &inner,
                        if reason == "timeout" {
                            "TIMEOUT"
                        } else {
                            "CANCELLED"
                        },
                    ),
                )
            })
        };
        if let Some((pending, result)) = found {
            let _ = self.emit(EVENT_CONTROL, json!({"type":"cancel","bridgeEpoch":pending.epoch,"clientSessionId":pending.session,"requestId":id,"reason":reason}));
            let _ = pending.tx.send(result);
        }
    }
    async fn call(&self, session: &str, rpc_id: Value, params: &Value) -> Value {
        let (id, rx, envelope, duration) = {
            let mut inner = self.inner.lock().unwrap();
            if inner.closed || inner.admission_pauses > 0 || !inner.ending.is_empty() {
                return failure(&inner, "EDITOR_UNAVAILABLE");
            }
            let Some(epoch) = inner.epoch.clone() else {
                return failure(&inner, "EDITOR_UNAVAILABLE");
            };
            if inner.pending.len() >= 64
                || inner
                    .pending
                    .values()
                    .filter(|p| p.session == session)
                    .count()
                    >= 32
            {
                return failure(&inner, "LIMIT_EXCEEDED");
            }
            let Some(client) = inner.sessions.get(session) else {
                return failure(&inner, "EDITOR_UNAVAILABLE");
            };
            let info = client.info.clone();
            let name = params["name"].as_str().unwrap_or("");
            let duration = self.options.tool_timeout(name, &params["arguments"]);
            let id = match random_hex() {
                Ok(id) => id,
                Err(_) => return failure(&inner, "INTERNAL_ERROR"),
            };
            let (tx, rx) = oneshot::channel();
            let envelope = json!({"type":"tools/call","requestId":id,"bridgeEpoch":epoch,"clientSessionId":session,"clientInfo":info,"deadline":now_ms()+duration.as_millis() as u64,"name":params["name"],"arguments":params.get("arguments").cloned().unwrap_or(json!({}))});
            inner.pending.insert(
                id.clone(),
                Pending {
                    epoch,
                    session: session.into(),
                    rpc_id: rpc_id.clone(),
                    deadline: Instant::now() + duration,
                    tx,
                },
            );
            (id, rx, envelope, duration)
        };
        let _pending_call = PendingCall {
            transport: self,
            id: id.clone(),
        };
        if self.emit(EVENT_REQUEST, envelope).is_err() {
            self.inner.lock().unwrap().pending.remove(&id);
            return failure(&self.inner.lock().unwrap(), "EDITOR_UNAVAILABLE");
        }
        match tokio::time::timeout(duration, rx).await {
            Ok(Ok(result)) => result,
            _ => {
                self.cancel_request(&id, "timeout");
                failure(&self.inner.lock().unwrap(), "TIMEOUT")
            }
        }
    }
}
fn register_end(inner: &mut Inner, sessions: Vec<String>) {
    if sessions.is_empty() {
        return;
    }
    if let Some(epoch) = inner.epoch.clone() {
        let Ok(id) = random_hex() else {
            inner.epoch = None;
            return;
        };
        let (done, _) = watch::channel(false);
        inner.ending.insert(
            id,
            PendingEnd {
                epoch,
                sessions,
                done,
            },
        );
    }
}
fn clear_ends(inner: &mut Inner) {
    for (_, pending) in inner.ending.drain() {
        let _ = pending.done.send(true);
    }
}
// Revoke credentials/renderer ownership and all in-flight work under one lock.
fn revoke(inner: &mut Inner) -> (Option<String>, Vec<String>) {
    let sessions: Vec<String> = inner.sessions.drain().map(|(id, _)| id).collect();
    register_end(inner, sessions.clone());
    for (_, pending) in std::mem::take(&mut inner.pending) {
        let _ = pending.tx.send(failure(inner, "CANCELLED"));
    }
    (inner.epoch.clone(), sessions)
}
fn failure(inner: &Inner, code: &str) -> Value {
    let state = inner.published.as_ref();
    let data = json!({"ok":false,"code":code,"message":code,"worldSessionId":state.and_then(|s|s.get("worldSessionId")).cloned().unwrap_or(Value::Null),"revision":state.and_then(|s|s.get("revision")).and_then(Value::as_u64).unwrap_or(0),"retryable": (["TIMEOUT","EDITOR_UNAVAILABLE"].contains(&code)),"details":{}});
    json!({"isError":true,"content":[{"type":"text","text":data.to_string()}],"structuredContent":data})
}
fn valid_result(value: &Value) -> bool {
    let Some(content) = value["content"].as_array() else {
        return false;
    };
    (1..=2).contains(&content.len())
        && content[0]["type"] == "text"
        && content[0]["text"].is_string()
        && value["structuredContent"].is_object()
        && (content.len() == 1
            || (value["isError"] != true
                && content[1]["type"] == "image"
                && content[1]["mimeType"] == "image/png"
                && content[1]["data"].as_str().is_some_and(|s| {
                    !s.starts_with("data:") && s.len() <= 4 * 1024 * 1024 * 4 / 3 + 4
                })))
}
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn single<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    let mut values = headers.get_all(name).iter();
    let first = values.next()?.to_str().ok()?;
    if values.next().is_some() {
        None
    } else {
        Some(first)
    }
}
fn response(status: StatusCode, body: Option<Value>) -> Response {
    let mut res = match body {
        Some(body) => (status, Json(body)).into_response(),
        None => status.into_response(),
    };
    res.headers_mut()
        .insert("Cache-Control", "no-store".parse().unwrap());
    res
}
fn rpc(id: Value, result: Value) -> Response {
    response(
        StatusCode::OK,
        Some(json!({"jsonrpc":"2.0","id":id,"result":result})),
    )
}
fn error(id: Value, code: i32, message: &str) -> Response {
    response(
        StatusCode::OK,
        Some(json!({"jsonrpc":"2.0","id":id,"error":{"code":code,"message":message}})),
    )
}
async fn fallback() -> Response {
    response(StatusCode::NOT_FOUND, None)
}

#[cfg(test)]
mod deadline_tests {
    use super::*;

    #[tokio::test]
    async fn dropping_a_call_cancels_its_bridge_request_without_ending_the_session() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let captured = events.clone();
        let transport = Transport::new(
            "token".into(),
            Arc::new(move |event, value| {
                captured.lock().unwrap().push((event, value));
                Ok(())
            }),
            Options::default(),
        );
        transport.ready("epoch".into()).unwrap();
        transport.inner.lock().unwrap().sessions.insert(
            "session".into(),
            Session {
                info: json!({"name":"test","version":"1"}),
                version: VERSIONS[0].into(),
                initialized: true,
                touched: Instant::now(),
            },
        );
        let params = json!({"name":"get_session"});
        let mut call = Box::pin(transport.call("session", json!(1), &params));
        assert!(tokio::time::timeout(Duration::from_millis(1), &mut call)
            .await
            .is_err());
        assert_eq!(transport.inner.lock().unwrap().pending.len(), 1);
        drop(call);
        let inner = transport.inner.lock().unwrap();
        assert!(inner.pending.is_empty());
        assert!(inner.sessions.contains_key("session"));
        assert!(inner.ending.is_empty());
        drop(inner);
        let events = events.lock().unwrap();
        let request = &events
            .iter()
            .find(|(event, _)| *event == EVENT_REQUEST)
            .unwrap()
            .1;
        let cancels: Vec<_> = events
            .iter()
            .filter(|(event, value)| *event == EVENT_CONTROL && value["type"] == "cancel")
            .collect();
        assert_eq!(cancels.len(), 1);
        assert_eq!(cancels[0].1["requestId"], request["requestId"]);
        assert_eq!(cancels[0].1["reason"], "clientCancelled");
    }

    #[test]
    fn image_defaults_and_reference_work_use_image_timeout() {
        let options = Options::default();
        assert_eq!(options.call_timeout, Duration::from_secs(10));
        assert_eq!(options.image_timeout, Duration::from_secs(30));
        for name in [
            "render_preview",
            "prepare_smart_source",
            "begin_edit",
            "visual_ingest_reference",
            "visual_match_reference",
            "reference_add",
            "reference_view",
            "reference_quantize",
            "render_compare",
        ] {
            assert_eq!(options.tool_timeout(name, &json!({})), options.image_timeout, "{name}");
        }
        for arguments in [json!({}), Value::Null, json!({"image":"tiles"}), json!({"image":"sheet"})] {
            assert_eq!(options.tool_timeout("get_tile_catalog", &arguments), options.image_timeout);
        }
        assert_eq!(options.tool_timeout("list_stamps", &json!({"previewStampId":"house"})), options.image_timeout);
        assert_eq!(options.tool_timeout("list_stamps", &json!({"includeSheet":true})), options.image_timeout);
    }

    #[test]
    fn metadata_and_ordinary_calls_keep_configured_call_timeout() {
        let options = Options {
            call_timeout: Duration::from_millis(17),
            image_timeout: Duration::from_millis(51),
            ..Options::default()
        };
        for (name, arguments) in [
            ("get_tile_catalog", json!({"image":"none"})),
            ("list_stamps", json!({})),
            ("get_session", json!({})),
            ("create_stamp", json!({})),
            ("paint_cells", json!({})),
        ] {
            assert_eq!(options.tool_timeout(name, &arguments), options.call_timeout, "{name}");
        }
        assert_eq!(options.tool_timeout("get_tile_catalog", &json!({})), options.image_timeout);
    }
}
fn depth(value: &Value, n: usize) -> bool {
    if n > 32 {
        return false;
    }
    match value {
        Value::Object(o) => o.values().all(|v| depth(v, n + 1)),
        Value::Array(a) => a.iter().all(|v| depth(v, n + 1)),
        _ => true,
    }
}
fn printable(value: &Value) -> String {
    value
        .as_str()
        .unwrap_or("")
        .chars()
        .filter(|c| {
            !c.is_control() && !matches!(*c,'\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
        })
        .take(80)
        .collect()
}
async fn handle(
    State((transport, port, generation)): State<(Arc<Transport>, u16, u64)>,
    request: Request<Body>,
) -> Response {
    let headers = request.headers();
    let (authorized, token_revision) = {
        let inner = transport.inner.lock().unwrap();
        (
            single(headers, "authorization")
                .and_then(|s| s.strip_prefix("Bearer "))
                .is_some_and(|token| {
                    token.len() == 64 && bool::from(token.as_bytes().ct_eq(inner.token.as_bytes()))
                }),
            inner.token_revision,
        )
    };
    if !authorized {
        let mut res = response(StatusCode::UNAUTHORIZED, None);
        res.headers_mut()
            .insert("WWW-Authenticate", "Bearer".parse().unwrap());
        return res;
    }
    if transport.is_shutdown() || transport.inner.lock().unwrap().generation != generation {
        return response(StatusCode::SERVICE_UNAVAILABLE, None);
    }
    let host = format!("127.0.0.1:{port}");
    if single(headers, "host") != Some(host.as_str())
        || request
            .uri()
            .authority()
            .is_some_and(|a| a.as_str() != host)
    {
        return response(StatusCode::FORBIDDEN, None);
    }
    let origin = format!("http://{host}");
    if headers.contains_key("origin") && single(headers, "origin") != Some(origin.as_str()) {
        return response(StatusCode::FORBIDDEN, None);
    }
    if request.uri().query().is_some_and(|q| {
        q.split('&').any(|p| {
            ["token", "access_token", "authorization"].contains(&p.split('=').next().unwrap_or(""))
        })
    }) {
        return response(StatusCode::UNAUTHORIZED, None);
    }
    if request.method() != Method::POST && request.method() != Method::DELETE {
        let mut res = response(StatusCode::METHOD_NOT_ALLOWED, None);
        res.headers_mut()
            .insert("Allow", "POST, DELETE".parse().unwrap());
        return res;
    }
    transport.expire();
    let session_header = single(headers, "mcp-session-id").map(str::to_owned);
    let version_header = single(headers, "mcp-protocol-version").map(str::to_owned);
    let deleting = request.method() == Method::DELETE;
    if !deleting
        && !single(headers, "content-type").is_some_and(|s| {
            s.split(';')
                .next()
                .unwrap_or("")
                .trim()
                .eq_ignore_ascii_case("application/json")
        })
    {
        return response(StatusCode::UNSUPPORTED_MEDIA_TYPE, None);
    }
    if !deleting
        && headers.contains_key("accept")
        && !single(headers, "accept").is_some_and(|s| {
            s.split(',')
                .any(|v| matches!(v.trim().split(';').next(), Some("application/json" | "*/*")))
        })
    {
        return response(StatusCode::NOT_ACCEPTABLE, None);
    }
    let message: Value = if deleting {
        Value::Null
    } else {
        let bytes = match to_bytes(request.into_body(), 1024 * 1024).await {
            Ok(bytes) => bytes,
            Err(_) => return response(StatusCode::PAYLOAD_TOO_LARGE, None),
        };
        match serde_json::from_slice(&bytes) {
            Ok(value) => value,
            Err(_) => return error(Value::Null, -32700, "Parse error"),
        }
    };
    {
        let inner = transport.inner.lock().unwrap();
        if inner.generation != generation {
            return response(StatusCode::SERVICE_UNAVAILABLE, None);
        }
        if inner.token_revision != token_revision {
            return response(StatusCode::UNAUTHORIZED, None);
        }
    }
    let id = message.get("id").cloned().unwrap_or(Value::Null);
    let has_id = message.get("id").is_some();
    let method = message["method"].as_str().unwrap_or("");
    if !deleting
        && (!message.is_object()
            || message["jsonrpc"] != "2.0"
            || method.is_empty()
            || !depth(&message, 0)
            || (has_id
                && !(id.as_str().is_some_and(|s| !s.is_empty() && s.len() <= 128)
                    || id
                        .as_i64()
                        .is_some_and(|n| n.unsigned_abs() <= 9007199254740991))))
    {
        return response(
            StatusCode::BAD_REQUEST,
            Some(
                json!({"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"Invalid Request"}}),
            ),
        );
    }
    if method == "initialize" {
        if !has_id || session_header.is_some() {
            return error(id, -32600, "Invalid initialize");
        }
        let params = &message["params"];
        let Some(requested_version) = params["protocolVersion"].as_str() else {
            return error(id, -32602, "Invalid protocol version");
        };
        let version = if VERSIONS.contains(&requested_version) {
            requested_version
        } else {
            VERSIONS[0]
        };
        if !params["clientInfo"]["name"].is_string()
            || !params["clientInfo"]["version"].is_string()
            || !params["capabilities"].is_object()
        {
            return error(id, -32602, "Invalid client info");
        }
        let session = match random_hex() {
            Ok(id) => id,
            Err(_) => return error(id, -32603, "Internal error"),
        };
        {
            let mut inner = transport.inner.lock().unwrap();
            if inner.generation != generation || inner.token_revision != token_revision {
                return response(StatusCode::UNAUTHORIZED, None);
            }
            if inner.admission_pauses > 0 || !inner.ending.is_empty() {
                return error(id, -32000, "Editor cancellation pending");
            }
            if inner.sessions.len() >= MAX_CLIENTS {
                return error(id, -32000, "Client limit reached");
            }
            inner.sessions.insert(session.clone(),Session {info:json!({"name":printable(&params["clientInfo"]["name"]),"version":printable(&params["clientInfo"]["version"])}),version:version.into(),initialized:false,touched:Instant::now()});
        }
        transport.changed();
        let mut res = rpc(
            id,
            json!({"protocolVersion":version,"serverInfo":{"name":"harita","version":env!("CARGO_PKG_VERSION")},"capabilities":{"tools":{"listChanged":false},"resources":{"subscribe":false,"listChanged":false},"prompts":{"listChanged":false}},"instructions":WORKFLOW.trim()}),
        );
        res.headers_mut()
            .insert("Mcp-Session-Id", session.parse().unwrap());
        return res;
    }
    let Some(session) = session_header else {
        return response(StatusCode::BAD_REQUEST, None);
    };
    {
        let mut inner = transport.inner.lock().unwrap();
        let Some(client) = inner.sessions.get_mut(&session) else {
            return response(StatusCode::NOT_FOUND, None);
        };
        if version_header.as_deref() != Some(client.version.as_str()) {
            return response(StatusCode::BAD_REQUEST, None);
        }
        client.touched = Instant::now();
        if !deleting
            && !client.initialized
            && !["notifications/initialized", "ping"].contains(&method)
        {
            return error(id, -32000, "Client not initialized");
        }
        if has_id
            && inner
                .pending
                .values()
                .any(|p| p.session == session && p.rpc_id == id)
        {
            return error(id, -32600, "Duplicate request id");
        }
    }
    if deleting {
        transport.end_session(&session, "delete");
        return response(
            if transport.wait_for_ends().await.is_ok() {
                StatusCode::OK
            } else {
                StatusCode::SERVICE_UNAVAILABLE
            },
            None,
        );
    }
    if has_id {
        if let Some(result) = super::guide::dispatch(method, message.get("params").unwrap_or(&Value::Null)) {
            return match result {
                Ok(result) => rpc(id, result),
                Err(failure) => error(id, failure.code, failure.message),
            };
        }
    }
    match method {
        "notifications/initialized" if !has_id => {
            let event = {
                let mut inner = transport.inner.lock().unwrap();
                let Some(client) = inner.sessions.get_mut(&session) else {
                    return response(StatusCode::NOT_FOUND, None);
                };
                let first = !client.initialized;
                client.initialized = true;
                let info = client.info.clone();
                if first {
                    inner.epoch.clone().map(|epoch|json!({"type":"sessionStarted","bridgeEpoch":epoch,"clientSessionId":session,"clientInfo":info}))
                } else {
                    None
                }
            };
            if let Some(event) = event {
                let _ = transport.emit(EVENT_CONTROL, event);
            }
            response(StatusCode::ACCEPTED, None)
        }
        "notifications/cancelled" if !has_id => {
            transport.cancel(&session, &message["params"]["requestId"], "clientCancelled");
            response(StatusCode::ACCEPTED, None)
        }
        _ if !has_id => response(StatusCode::ACCEPTED, None),
        "ping" => rpc(id, json!({})),
        "tools/list" => {
            let catalogue: Value =
                serde_json::from_str(CATALOGUE).expect("embedded catalogue must parse");
            rpc(id, json!({"tools":catalogue["tools"]}))
        }
        "tools/call" => {
            let params = &message["params"];
            if !params["name"]
                .as_str()
                .is_some_and(|s| !s.is_empty() && s.len() <= 128)
                || params.get("arguments").is_some_and(|a| !a.is_object())
            {
                return error(id, -32602, "Invalid tool call");
            }
            let result = transport.call(&session, id.clone(), params).await;
            rpc(id, result)
        }
        _ => error(id, -32601, "Method not found"),
    }
}
