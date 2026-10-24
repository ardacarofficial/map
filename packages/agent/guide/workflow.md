# Edit a bounded contribution and submit it for review

Call `get_session` to obtain the world session, current revision, maps and pending edit state. Use `get_editor_context` for selection and viewport intent. Refresh observations when the user changes worlds, art or relevant context. Discover stable IDs before writing; names help the user, while IDs identify the actual targets.

## Ordinary exclusive edits

`begin_edit` needs only a meaningful `requestLabel` and explicit `mapIds`. Keep the returned `transactionId` and the secret `resumeToken`. Document mutations may then omit `context` entirely: they use your own running draft and apply in arrival order. Optional context fields stay available:

```json
{"context":{"idempotencyKey":"<unique-operation>","expectedRevision":12}}
```

Add an `idempotencyKey` when a retry must be safe (the identical payload/key replays; never change arguments under an existing key); add `expectedRevision` only when you want strict compare-and-set. In collaborative mode, choose exactly one revision selector: strict global `expectedRevision` or independent `expectedMemberRevision`; see [collaboration](harita://guide/collaboration). Keep requests within their advertised budgets, and correct failures before proceeding. Layers locked or hidden at begin stay protected until you unlock/show them inside the draft (`begin_edit.unlockLayerIds`, or `edit_layer` update); the user reviews that change with the rest.

Preview and validate while the edit is running, then call `finish_edit` when your contribution is ready. Finishing submits work; it does not approve or save it. In an exclusive edit, `cancel_edit` rolls the pending edit back. For shared drafts, read [collaboration](harita://guide/collaboration): membership, region ownership and per-member revision tokens determine whose contribution is ready or canceled. Prepare shared layers, sources and metadata before any successful spatial write or peer join; either event freezes global preparation.

## Recovery and human control

A failed or timed-out call undoes only itself (`details.applied:false`); the draft keeps running, so fix and retry that call. Errors carry `details.nextAction`, and lifecycle errors also name `state`, `cause` and `isYours`.

Disconnects, session expiry and the 30-minute inactivity lease never roll back an exclusive draft: it becomes `orphaned` and waits for the human. After reconnecting (or after `finish_edit` or a human Durdur) call `resume_edit({transactionId, resumeToken})` to rebind the draft to your new session and keep editing; `cancel_edit` with `resumeToken` discards it. Smart-source IDs belong to their transaction and map.

Only the user approves the draft. Approval makes the accepted common result one world undo action; discard rolls back the unapproved draft. In collaborative drafts a running member's disconnect still rolls back that member's contribution; see [collaboration](harita://guide/collaboration).

Pending work stays out of normal saves, backups and exports. After approval the normal editor workflow saves or exports the accepted document; MCP has no document-save or file-delivery tool. UI controls, independent AI tags and other explicitly independent preferences follow their own persistence behavior and are not undone by discarding a map proposal. Explain this distinction when it matters to the requested task.

A useful handoff states what changed, which areas and semantic layers are involved, how the map can be edited further, and what visual/structural/goal checks were completed. Keep it proportional to the work.
