# Reproducible MCP task measurements

These fixtures call the real `AgentApi` with the deterministic in-memory host. The sparse search fixture uses the real editor tags adapter and a constant fingerprint stub to isolate enumeration work. They are scripted correctness and application-protocol measurements, **not a live LLM benchmark**. No model credentials, tokens, model latency, subjective quality scores, or automatic gameplay semantics are inferred.

Baseline JSON was captured at commit `755930d`, before implementation edits. The task harness itself was added first. Measurements are single local wall-clock samples; compare correctness, calls, bytes, and counted work, not small timing differences. Fixture setup and `begin_edit` are excluded from counted calls; the village task includes placement, `validate_map`, and `finish_edit`. Human approval and history undo/redo execute locally and are checked separately.

From the repository root, run the optimized tasks and export JSON explicitly:

```sh
MAP_TASK_METRICS_MODE=batch MAP_TASK_METRICS_OUTPUT=/tmp/mcp-tasks.json pnpm exec vitest run packages/agent/test/taskMetrics.test.ts
pnpm exec vitest run packages/editor/src/agent/sparseTags.benchmark.test.ts --reporter=verbose --disableConsoleIntercept
```

Omit `MAP_TASK_METRICS_MODE=batch` to exercise individual house placement on the current implementation. The sparse fixture prints cold/warm metrics and asserts exactly ten candidates and one MCP call per query. Fingerprint implementation/cache correctness is covered separately by `images.test.ts`; the stub does not measure PNG decoding or SHA work. The `mcp-bulk-palette-measurements.json` fixture counts actual retained history arrays and slots; its byte figure estimates pointer storage and excludes engine-specific object overhead.

The task harness also accepts `MAP_TASK_METRICS_EXPECT_BASELINE=1` when copied into the baseline revision: it expects the original 4096-tile rejection and malformed-brush rollback, while keeping the same inputs. The baseline sparse fixture's expected counts are 50,000 fingerprints and thirteen calls; the post fixture explicitly asserts the improved counts. The stored baseline results preserve the pre-edit measurements.

| Workload | Before | After | Correctness |
| --- | --- | --- | --- |
| Four-layer 64×64 read, text | 213,652 bytes | 33,121 bytes (84.5% less) | Parsed text equals structured content |
| Same read, whole tool result | 263,332 bytes | 66,374 bytes | Four complete layers |
| Sixteen houses + validate + finish | 18 calls / 25,597 result bytes | 3 calls / 6,874 result bytes | Sixteen houses; one exact undo and redo |
| 4096 distinct tiles | `LIMIT_EXCEEDED`, unchanged | Success at 729,152 charged bytes | Exact discard; 64 MiB limit unchanged |
| Malformed area brush after painting | `INTERNAL_ERROR`, previous work rolled back | `INVALID_ARGUMENT`, previous work preserved | Transaction remains running |
| Sparse 50,000-tile / ten-tag search | 50,000 fingerprint calls / 13 MCP calls | 10 fingerprint calls / 1 MCP call | Same ten current annotations |

Latency is not uniformly lower: the final village sample took about 12.5 ms locally versus 8.0 ms before because complete preflight adds work; fewer external round trips do not prove faster model inference. Samples ran under varying local load. The post-only actual-PNG sparse fixture measured ten cold pixel hashes and zero warm hashes, but has no matching pre-change real-pixel timing baseline.

The benchmark tasks cover a four-layer 64×64 read, sixteen stamp placements with validation/approval/undo/redo, 4096 distinct palette references with exact discard, malformed smart-brush recovery with prior work, and a 50,000-tile atlas with ten tagged candidates. Focused tests additionally cover goal failures, reference sharing, batch late failures/replay, entity corrections, and real HTTP timeout recovery.

The second MCP audit adds deterministic regressions, separate from the stored timing samples:

- `catalog.test.ts` discovers a 50,000-tile atlas with `includeDetails:false` and asserts zero pixel fingerprints, image identity lookups, or tag reads, including unavailable artwork. Detailed discovery retains its existing default; cursors cannot cross detail modes.
- `images.test.ts` fingerprints a cold two-tile stamp palette with exactly one source PNG decode, checks independent cancellation and source replacement, and verifies that two mocked 24 MiB decoded atlases remain cached without duplicate memory charges.
- `api.test.ts` preserves tentative edits when either the owner or an observer encounters unavailable unrelated artwork, both while running and awaiting approval. Actual world-source invalidation still cancels stale edits.
- `lifecycle.test.ts` uses a valid large entity default to force response-size failure after mutation, then verifies complete rollback and a cancelled retry instead of an uncached applied write.
- `goals.test.ts` detects visibility and opacity changes to protected visual layers. Manual collision remains independent of layer visibility.

These are counted application operations and correctness assertions, not measurements of model quality or inference speed.

The third MCP audit adds focused regressions for long workflows and editor parity:

- `stampSearchBudget.test.ts` searches 1,000 metadata-matching stamps with `limit:16`: fingerprint calls fall from 1,000 to 16 per page, with the next page continuing in order. Matches that depend on AI tags still require current fingerprints.
- `retryDiagnostics.test.ts` checks that idempotent retries appear as calls with measured response bytes, retain affected map IDs, and do not count applied cells twice. Cancelled retries keep the original transaction ID.
- `tagPagination.test.ts` binds ordinary tag-page cursors to the filters and source snapshot, rejecting stale or mismatched continuation while preserving unchanged pagination.
- `stampMapping.test.ts` compares inferred destinations with core, creates missing layers in stamp order, and verifies that missing permission or genuinely ambiguous mappings preserve an existing draft and its counters.

The fourth MCP audit adds lifecycle and sparse-preview regressions:

- `preview.test.ts` renders a 4096×4096 collision region containing one occupied chunk into a 64×64 image. The previous dense loop required 16,777,216 `getCell` calls; the fixed renderer makes zero such calls and scans the intersecting stored chunk. Crop boundaries and row-major blending across chunks remain covered. Dense populated layers still require work proportional to stored cells; output dimensions alone do not bound that work.
- `disposal.test.ts` verifies that repeated API teardown releases world/tag subscriptions, cancels active and queued calls, rolls back pending edits, and interrupts approval waiting for a map without committing. `runtime.test.ts` rejects requests as soon as teardown starts and verifies cleanup/replacement after tag persistence fails.
- `createStamp.test.ts` rejects unused edited-atlas slots, including selections mixing allocated and unused slots, while preserving prior pending edits and counters. The last allocated tile still creates a stamp that can be placed and discarded correctly.

In the application, **AI activity → Export diagnostics** saves the filtered visible activity rows to a local JSON file. It includes call outcomes, duration, planned/changed cells, and measured request/text/decoded-image/result byte counts where available. It excludes raw arguments, image content, summaries, client identities, tokens, and transport framing. The editor sends nothing automatically. User approval/discard rows remain separate from tool calls; durations exclude external model inference.

The fifth MCP audit adds adversarial lifecycle, identity, transport, and resource regressions:

- `approvalRace.test.ts` leaves a cached-map load unresolved during approval, then triggers external world invalidation or user discard. Approval is interrupted, the original snapshot is restored, and ownership is released before the late load finishes; no approval history row is published.
- `protectionIdentity.property.test.ts` generates map/layer IDs containing colons, reverses participant order, and varies locked/hidden protection. Tuple-encoded identities prevent one map's layer from overwriting another map's initial protection (40 generated runs).
- `transactionCleanup.test.ts` and the editor's `smartSources.test.ts` exercise throwing source-retirement/image observers after approval or rollback. Remaining assets and source handles are retired, the write gate/pins are released, and ordinary undo/redo and subsequent edits remain usable.
- `mapValidation.test.ts` resolves omitted entity fields using core/export defaults, checks portal destination pixel bounds after target resize, and covers half-open boundaries in 64 generated non-square map cases. Unknown/default references, unavailable target maps, deduplicated asynchronous target loading, issue-page limits, and imported unconfigured portal edits have focused regressions.
- Dev HTTP tests revoke a session while a chunked request body is still arriving; the completed request cannot dispatch. Dev and native bridge tests accept an exactly 8 MiB tool result with bounded correlation-envelope overhead. A native dropped-future regression verifies pending requests release capacity and cancel the exact bridge request without ending the session.
- `stampPreviewBudget.test.ts` renders 4096 distinct edited tiles: counted palette snapshot copies fall from 16,777,216 to 4,096 slots (about 128 MiB to 32 KiB of pointer slots, excluding objects/allocator overhead). The temporary preview store retains zero undo steps instead of 1000. All eight flip orientations retain exact RGBA output. Unused or unavailable palette artwork is not loaded; larger stamp conversion uses at most 4096 nonempty cell objects per dispatch rather than one object per source cell.
- `previewCooperative.test.ts` exercises actual timer-driven cancellation during source discovery and raster traversal: controlled-clock fixtures stop after 128 of 16,384 tile operations, or 1024 of 16,384 stored cells containing invalid references. Expired deadlines stop traversal without waiting for a queued timeout. Synchronous/asynchronous RGBA and metadata remain equal across opacity, manual collision, grid, coordinates, and downscaling.
- `utf8Budget.test.ts` compares allocation-free UTF-8 byte accounting and exact-sized encoding with the platform encoder for 1000 generated arbitrary UTF-16 strings, lone surrogates, Unicode boundaries, and a response-sized mixed string. Budget and activity accounting no longer allocate a growable number array or an encoded copy just to obtain its length.
- `replayCache.test.ts` and `replayPressure.test.ts` bound completed/tag response payloads to 64 MiB of conservative serialized UTF-16 accounting. Payload pressure retains a compact request hash/tombstone: retrying old tags cannot overwrite a newer manual annotation, and retrying a completed `begin_edit` cannot create a new draft. Such retries return an explicit `LIMIT_EXCEEDED` result without repeating the write. Active transaction replies remain pinned. Ended sessions release unreachable cached responses, and empty queue counters are removed.

Scope and remaining limits are explicit:

- These are deterministic application/protocol correctness and counted-work results, not live-agent quality, model-token, total-heap, or wall-clock speed measurements. No finite suite establishes zero defects.
- Cooperative preview traversal improves cancellation opportunities; it does not establish a hard frame-time/Stop-latency bound. One PNG decode/encode, image-sized raster operation, chunk collection/sort, or palette allocation remains synchronous. Populated preview work still scales with stored cells, and the temporary stamp map still holds its occupied chunks.
- The cache byte limit covers evictable completed/tag payloads, not total process memory or pinned active transaction replies. Existing transaction limits, the per-client 1024-record window, and ten-minute inactive-record expiry remain separate bounds; byte-pressure tombstones prevent new silent replay within that window.
- Validation pagination still restarts record enumeration to reach a cursor. The optional `validate_map` region scopes stored tile/collision cells, while entity, palette, and generated-source integrity records retain the existing whole-map behavior. This audit does not invent new regional-validation semantics.
- Manual collision, human approval, source PNG isolation, document format 6, and ordinary undo representation remain unchanged.

Fifth-pass integrated verification: 2,311 unit/integration tests passed with 2 existing skips; all 72 `smap-host` native tests and all 16 Chromium AI workflow tests passed. Workspace TypeScript, ESLint, and production builds passed. These counts describe the tested revision, not a guarantee for untested inputs.
