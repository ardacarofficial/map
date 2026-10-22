# Edit a bounded contribution and submit it for review

Call `get_session` to obtain the world session, current revision, maps and pending edit state. Use `get_editor_context` for selection and viewport intent. Refresh observations when the user changes worlds, art or relevant context. Discover stable IDs before writing; names help the user, while IDs identify the actual targets.

## Ordinary exclusive edits

`begin_edit` takes read context `{worldSessionId}`, the observed `expectedRevision`, a fresh `idempotencyKey`, a meaningful `requestLabel` and explicit `mapIds`. Retain its transaction ID. Each document mutation takes:

```json
{"context":{"worldSessionId":"<world>","transactionId":"<edit>","expectedRevision":12,"idempotencyKey":"<unique-operation>"}}
```

Use the latest returned revision for the next exclusive operation. In collaborative mode, choose exactly one revision selector: strict global `expectedRevision` or independent `expectedMemberRevision`; see [collaboration](harita://guide/collaboration). A distinct action needs a fresh key. Repeating the identical payload/key can recover a known replay; never change arguments under an existing key. Batched `apply_operations` calls also have one outer key and revision. Keep requests within their advertised budgets, and correct failures before proceeding. An initially protected layer stays protected through the edit; unlocking it is not a workaround.

Preview and validate while the edit is running, then call `finish_edit` when your contribution is ready. Finishing submits work; it does not approve or save it. In an exclusive edit, `cancel_edit` rolls the pending edit back. For shared drafts, read [collaboration](harita://guide/collaboration): membership, region ownership and per-member revision tokens determine whose contribution is ready or canceled. Prepare shared layers, sources and metadata before any successful spatial write or peer join; either event freezes global preparation.

## Recovery and human control

After a timeout, disconnect or uncertain response, inspect `get_session` before deciding what to do next. Do not blindly repeat writes with a new key. Recover the active transaction, determine which operation completed and continue only from observed state. Opaque smart-source IDs belong to their transaction and map. Idle expiry and cancellation can invalidate them.

Only the user approves the draft. Approval makes the accepted common result one world undo action; discard rolls back the unapproved draft. Submitted/stopped work may remain for human review after a client disconnects. Active contribution disconnect/expiry behavior depends on exclusive versus collaborative ownership; inspect session state rather than assuming the entire draft vanished.

Pending work stays out of normal saves, backups and exports. After approval the normal editor workflow saves or exports the accepted document; MCP has no document-save or file-delivery tool. UI controls, independent AI tags and other explicitly independent preferences follow their own persistence behavior and are not undone by discarding a map proposal. Explain this distinction when it matters to the requested task.

A useful handoff states what changed, which areas and semantic layers are involved, how the map can be edited further, and what visual/structural/goal checks were completed. Keep it proportional to the work.
