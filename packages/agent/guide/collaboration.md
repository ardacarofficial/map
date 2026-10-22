# Collaborate on an understandable common draft

Use a collaborative edit when several clients should contribute to the same pending draft. A single agent can keep using the ordinary exclusive workflow. Divide a shared task by useful scene areas or editing roles, rather than creating one layer per worker. Agree on the art palette, semantic layer stack, intended routes and who owns shared seams.

## Set up once, then claim existing regions

A coordinator begins with the ordinary `begin_edit` fields plus `collaboration:{mode:"regions"}`. It may omit `claims` for a preparation-only stage: it can create shared layers, prepare smart sources and organize supported world/stamp metadata, but cannot paint without a region claim. Once IDs exist, it calls `join_edit` with the current transaction ID and its own claims. Alternatively, the initial `begin_edit` can include claims when all needed targets already exist.

A claim is `{mapId,layerIds:["<existing-layer>"],region:{x,y,width,height}}`. Peers join explicitly with `join_edit`, read context `{worldSessionId}`, the shared `transactionId`, a fresh `idempotencyKey`, current `expectedRevision` and their claims. Peers can join after the coordinator has assigned its own regions. Claims are immutable for this contribution; there is no dynamic claim update or rejoin workflow. Overlapping ownership on the same map/layer is rejected.

Global metadata changes belong to the coordinator's setup stage and freeze after the first successful spatial call or the first peer join, whichever happens first. Finish shared layer/source/stamp preparation before painting or inviting peers. Reuse those assets and semantic layers while painting within claimed regions. Smart neighbor repairs, wide paths and stamp extents count toward the actual write footprint; coordinate boundaries where these would cross another contribution. A coordinator can reserve shared seams or use a later reviewed edit to connect them.

## A two-client example

For a 64×32 map on existing shared layer `ground`, the coordinator can first call `begin_edit` with `collaboration:{mode:"regions"}` and no claims, prepare the shared stack/sources before painting, then self-join. The second client joins that same transaction afterward:

| Caller | Claim on `ground` | Cells owned |
| --- | --- | --- |
| Coordinator self-join | `{x:0,y:0,width:32,height:32}` | x=0…31 |
| Peer join | `{x:32,y:0,width:32,height:32}` | x=32…63 |

These rectangles are half-open and touch without overlap. Each caller reads the current session immediately before its join and supplies this shape, substituting its own region and fresh key:

```js
join_edit({
  context: { worldSessionId: world }, transactionId: group,
  expectedRevision: observedGlobalRevision, idempotencyKey: freshKey,
  claims: [{ mapId: map, layerIds: [ground], region: ownRegion }]
})
```

Both clients paint onto the same semantic layer with separate member tokens; neither needs a worker-named layer. This exact split suits writes whose whole footprint stays on their side. Smart connection repairs may need a halo across x=32: reserve the actual seam/halo footprint for an agreed owner before joining, or keep smart painting inset and connect the boundary in a later reviewed edit. A point on your side does not authorize neighbor repairs on the other side.

## Use the right revision token

The write context carries world/transaction IDs, an idempotency key and **exactly one** revision selector:

- `expectedRevision` checks the global revision strictly; another contributor's completed write can make it stale.
- `expectedMemberRevision` checks your contribution's revision in collaborative mode, allowing unrelated peer writes to proceed.

Use the member revision returned by join/session and subsequent write responses for member-local CAS. `get_session.data.currentClientSessionId` identifies the caller; `get_session.data.transaction.collaboration.members` lists members with their role, state, revision and claims, and successful collaborative writes return envelope `memberRevision`. Do not send both selectors. A typical collaborative mutation context is:

```json
{"context":{"worldSessionId":"<world>","transactionId":"<group>","expectedMemberRevision":3,"idempotencyKey":"<unique-operation>"}}
```

## Submit your contribution, review the common result

`finish_edit` marks the caller ready. The coordinator's finish closes further joins; the group awaits human review once its active contributions are ready or stopped. Finishing is not permission to approve peers' work. Collaborative `cancel_edit` rolls back the caller's bounded contribution, not peers' work. After any peer has joined, shared preparation remains pending even if the coordinator cancels: removing those layers, stamps or sources would break peer dependencies. Human group discard restores the original baseline, including this shared foundation. If no peer ever joined, coordinator cancellation can safely discard the whole proposal. A running member's disconnect rolls its active contribution back, while a ready member's submitted contribution can remain for human review. Inspect session state after any uncertain lifecycle event.

Review local crops and one common overview for coherent routes, seams, scale and density. Report the region changed, shared assets/layers used and outstanding connections. Only the human accepts or discards the common draft. See [workflow](harita://guide/workflow) and [validation](harita://guide/validation) for recovery and checks.

## Recover without disturbing peers

After a timeout, inspect the session's caller ID, membership, state and revision before issuing another mutation. Retain the original key/payload when recovering an operation that may already have completed; a new key is a new action. A canceled or expired member does not dynamically reclaim or expand its old region in this first workflow. Coordinate a subsequent edit after the current group resolves when more work is needed. A ready/disconnected contribution can still await the human's decision, so do not assume disconnect discarded the group.
