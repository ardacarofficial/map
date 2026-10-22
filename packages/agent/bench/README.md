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

In the application, **AI activity → Export diagnostics** saves the filtered visible activity rows to a local JSON file. It includes call outcomes, duration, planned/changed cells, and measured request/text/decoded-image/result byte counts where available. It excludes raw arguments, image content, summaries, client identities, tokens, and transport framing. The editor sends nothing automatically. User approval/discard rows remain separate from tool calls; durations exclude external model inference.
