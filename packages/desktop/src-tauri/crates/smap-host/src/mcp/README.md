# Desktop MCP transport

`Service` owns settings, credentials and listener replacement. `Transport` owns
HTTP sessions and bounded bridge correlations; tool semantics belong to the
editor. Production starts `Service::start()` inside `tauri::async_runtime::spawn`.
Tests bind real `127.0.0.1:0` listeners.
Each endpoint accepts at most 16 clients, with at most 64 pending calls in total
and 32 per client. Calls and collaborative membership still have their own
editor limits; the session cap does not grant concurrent write ownership.

## Access and session liveness

`Host` may be `127.0.0.1`, `localhost` or `[::1]` with the listener port (the
socket itself is loopback-only); an `Origin`, when present, must be `http://`
plus one of those. The `Bearer` scheme is case-insensitive. Every HTTP failure
(400/401/403/404/405/406/409/413/415/429/503) carries a JSON-RPC error body
whose message says what to do; 401 adds `WWW-Authenticate: Bearer
error="invalid_token"`. A request without a session for an unknown method
(for example a newer client's `server/discover` probe) gets JSON-RPC -32601,
so the client falls back to `initialize`. After initialization an omitted
`MCP-Protocol-Version` means the negotiated version.

`GET /mcp` opens an optional event stream (at most two per session). Harita
sends no server-initiated messages; the stream only carries comment
keepalives every five seconds. An open stream or an in-flight call keeps a
session alive indefinitely. When the last stream closes and the session stays
quiet for fifteen seconds, the session ends with `disconnect`; a session that
never opened a stream ends after the idle timeout with `expired`. At the
16-client cap, `initialize` evicts the least recently used session without a
stream or call in flight (`expired`); only when every client is live does it
answer 429. Session end never rolls back a draft by itself: the editor's
`sessionEnded` handling decides (orphaned for review, resumable by its agent).

The desktop platform supplies the frozen `AgentConnection`. Native IPC:

- `ai_get_status` → `{snapshot,status}`
- `ai_set_config({settings,expectedRevision})` → `SettingsWriteResult`
- `ai_reveal_token` → token for an explicit reveal/copy action
- `ai_regenerate_token({expectedRevision})` → `AgentSettingsSnapshot`
- `agent_ready({epoch})`, `agent_reply({reply})`,
  `agent_publish_status({status})`

Every native editor window owns an independent `Service`. IPC resolves the
service using Tauri's authenticated caller window label, with no renderer
argument for selecting another window. Each bridge emits only to its owner.
Event payloads are the frozen
`BridgeRequest`, `BridgeControl`, and `AgentConnectionStatus`, sent on
`smap://agent-request`, `smap://agent-control`, and `smap://agent-status`.
All listeners are installed before native readiness is announced.

The main window retains `settings.json` and `ai-secret.json`. Additional
`world-N` windows use `windows/world-N/ai-settings.json` and `ai-secret.json`,
with AI disabled initially and a default port of 48765 + N (up to 65535).
Enable and copy connection settings inside the intended world's window.
Ports, token rotation, sessions, renderer reload and pending requests are
independent. A port already in use produces an explicit error. Closing one
window permanently revokes only its transport and releases its listener;
late readiness or configuration calls cannot reopen the closed service.

## Progressive guide context

`initialize` supplies a short orientation. `resources/list` exposes metadata for
the authoring guide and portable skill; `resources/read` reads one exact
`harita://guide/...` URI. Markdown is embedded in the native binary at compile
time, so resource requests cannot select local files. Static resources have no
subscriptions or list notifications. `resources/templates/list` is empty.

`prompts/list` advertises `harita-map-task`; `prompts/get` accepts a bounded
`task` and optional `topic`, returning the overview and links to relevant
sections. It does not load the entire guide or change editor state. All guide
methods follow the same authenticated, initialized session checks as tools.
The stdio proxy forwards these methods and advertises only upstream capabilities
it implements. Live world state remains available through editor tools.

## Rollback confirmation

After `sessionEnded`, Rust sends a `statusRequest` with a fresh request ID.
The runtime handles session cancellation and returns its current `AgentState`
through `publishStatus({bridgeEpoch,requestId,state})`. Rust waits until the
state is no longer cancelling and has no transaction owned by an ended
session. An early response during rollback does not acknowledge completion;
the transport repeats the status query until completion. Replies from another
epoch cannot acknowledge it.
For a collaborative proposal, acknowledgement also waits until each departed
session is detached from the proposal's member list. Peers may remain running;
ending one client does not demand that their work stop or be rolled back.

While this confirmation is pending, initialize and tool execution are blocked.
DELETE waits for confirmation (503 on timeout). Configuration/credential changes
wait before replacing the endpoint/secret. New initialize/tool calls also remain
paused across persistence, so a client cannot reconnect between rollback
confirmation and publication of a new endpoint or credential. A renderer reload explicitly revokes
the old epoch; its in-memory state is gone and cannot acknowledge a new epoch.
Controls never enter the bounded tool request queue. The same status query
checks renderer liveness every five seconds; a missing reply for fifteen seconds
revokes readiness and the old renderer epoch independently of client pings.

General settings writes preserve the current `ai` member under the same file
lock; only the revision-checked AI command can change it. Credentials live in
`ai-secret.json`, atomically replaced using a temporary file which is already
0600 before any secret bytes are written on Unix. Credential failures never
silently rotate a token.

## Verification

From `packages/desktop/src-tauri`:

```
cargo test
cargo xwin check --locked --target x86_64-pc-windows-msvc
```

A Windows/WebView2 smoke run must still exercise readiness, tool round trips,
clipboard reveal/copy, reload, disable and application shutdown. Host tests and
cross-compilation do not exercise a native WebView2 window.
