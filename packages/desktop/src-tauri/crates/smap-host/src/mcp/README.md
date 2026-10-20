# Desktop MCP transport

`Service` owns settings, credentials and listener replacement. `Transport` owns
HTTP sessions and bounded bridge correlations; tool semantics belong to the
editor. Production starts `Service::start()` inside `tauri::async_runtime::spawn`.
Tests bind real `127.0.0.1:0` listeners.

The desktop platform supplies the frozen `AgentConnection`. Native IPC:

- `ai_get_status` → `{snapshot,status}`
- `ai_set_config({settings,expectedRevision})` → `SettingsWriteResult`
- `ai_reveal_token` → token for an explicit reveal/copy action
- `ai_regenerate_token({expectedRevision})` → `AgentSettingsSnapshot`
- `agent_ready({epoch})`, `agent_reply({reply})`,
  `agent_publish_status({status})`

Only the main window may invoke these commands. Event payloads are the frozen
`BridgeRequest`, `BridgeControl`, and `AgentConnectionStatus`, sent on
`smap://agent-request`, `smap://agent-control`, and `smap://agent-status`.
All listeners are installed before native readiness is announced.

## Rollback confirmation

After `sessionEnded`, Rust sends a `statusRequest` with a fresh request ID.
The runtime handles session cancellation and returns its current `AgentState`
through `publishStatus({bridgeEpoch,requestId,state})`. Rust waits until the
state is no longer cancelling and has no transaction owned by an ended
session. An early response during rollback does not acknowledge completion;
the transport repeats the status query until completion. Replies from another
epoch cannot acknowledge it.

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
