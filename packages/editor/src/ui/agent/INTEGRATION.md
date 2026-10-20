# Lane 5 integration

`agentUiAdapter.ts` is the only UI/runtime seam. B0 does not include lane 2's
`agent/agentUiState.ts`. Bind that runtime once per world and dispose the binding
when the world closes:

```ts
const dispose = installAgentUiAdapter({
  api,                         // getState / subscribe / userAction from AgentApi
  activity,                    // entries / subscribe from AgentActivityPort
  canApprove: () => !applying,  // false throughout a bounded in-flight apply
  tags: {
    read: target => readTag(target),
    write: entry => writeTag(entry),
    list: query => listTags(query),
    subscribe: onTagsChanged,
  },
});
```

`read` returns a frozen-contract `TagRecord`; `write` accepts `TagWrite` and must
use the same world/idempotency/fingerprint command path as MCP. Map operations,
undo, edit locks, persistence and token lifecycle remain runtime/host owned.
Notify the adapter's API subscription when `applying` changes as well as when
phase/counters change. Approval defaults to disabled if no safety callback is
provided. Activity is capped to the latest 500 UI rows; Clear is session-only.
The runtime keeps its own contract-sized activity buffer.

UI commands are registered by `useAiCommands` in `EditorLayout`. They use the
existing registry/shortcut dispatcher, with empty default keys. Lane 2's command
policy must allow `ai.stop`, `ai.approve`, `ai.discard`, `ai.openSettings`,
`ai.editTags`, `view.aiActivity`, and all `panel.aiActivity.*` docking commands
while pending; manual tag writes are disabled by the tags form while pending.
Keep any existing runtime registration for these commands consistent with this
single presentation registration.

The dock command generator's `panel.aiActivity.show` title needs
`ai.activity.title` (the UI replaces that title after mount). Update
`ui/layout/dockCommands.ts` in its owning/integration lane to select this key
alongside its existing color-panel special case; no new docking locale needed.

Settings use the frozen `Platform.agent` service directly. The listener draft
is separate from the ordinary settings JSON, because the host owns its CAS
revision and persistence. Save commits it, Cancel does not; token regeneration
is explicitly confirmed and immediate. Browser without this capability shows
the O6 desktop fact. Copy uses the effective status port and a freshly revealed
token, with exactly one clipboard write. No token enters settings JSON or logs.

`ai-settings.spec.ts` and `ai-activity.spec.ts` run on B0 without a dev MCP host.
`ai-edit.spec.ts` runs only when `agent/agentUiState.ts` is present and requires
lane 2 + lane 4 + this binding. Its agent changes use the real paired HTTP route;
there is no direct map-write hook. `e2e/fixtures/aiMcp.ts` is a small HTTP fixture
because lane 4's SDK helper is absent on B0. Replace that fixture with the shared
`e2e/support/agentClient.ts` adapter once its API is available. The merged normal
suite must start the host on E2E_MCP_PORT (48781 for this lane), with an available
token or HARITA_MCP_TOKEN, and HARITA_DEV_MCP=1. These tests are not proof of
transaction/paint-lock behavior until run on that merged stack.

The O2 Inspector section opens a selected-target M dialog. Missing/stale metadata
navigation uses the same read-only paged `get_tags` path through `tags.list`.
