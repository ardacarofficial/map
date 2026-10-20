import {
  AGENT_LIMITS as L,
  AgentError,
  AgentErrorCode as E,
  type AgentApi,
  type AgentCall,
  type AgentCallContext,
  type AgentFailure,
  type AgentHost,
  type AgentToolResult,
  type ImageBlock,
  type ToolArguments,
  type ToolName,
  type ToolSuccess,
} from "./contracts";
import { TOOL_DEFINITIONS, canonicalJson } from "./toolSchemas";
import { toMcpToolResult } from "./result";
import { CallSignal, Transactions, waitFor } from "./transactions";
import { check, validate } from "./validation";
import { normalizeTags, tagKey, utf8 } from "./tags";
import { mutate } from "./tools/mutations";
import { read } from "./tools/read";

const writes = new Set(
  TOOL_DEFINITIONS.filter(
    (t) => !t.annotations.readOnlyHint && t.name !== "set_tags",
  ).map((t) => t.name),
);
interface Cached {
  fingerprint: string;
  result: AgentToolResult;
  transactionId?: string;
  at: number;
  client: string;
}

export function createAgentApi(host: AgentHost): AgentApi {
  const tx = new Transactions(host),
    cache = new Map<string, Cached>();
  const endedSessions = new Set<string>();
  let activeClient: string | undefined;
  let queue: Promise<unknown> = Promise.resolve(),
    active: CallSignal | undefined,
    queued = 0;
  const perClient = new Map<string, number>();
  function enqueue<T>(task: () => Promise<T> | T): Promise<T> {
    const next = queue.then(task, task);
    queue = next.catch(() => {});
    return next;
  }
  function interrupt() {
    active?.abort();
  }
  tx.interrupt = interrupt;
  tx.onExternal = () => {
    interrupt();
    if (tx.pending) {
      tx.seal("stopped");
      void enqueue(() => tx.cancel());
    }
  };
  function failure(error: unknown, transactionId?: string): AgentToolResult {
    const e =
      error instanceof AgentError
        ? error
        : new AgentError(E.INTERNAL_ERROR, "Agent operation failed");
    const state = tx.state();
    const result: AgentFailure = {
      ok: false,
      code: e.code,
      message: e.message,
      worldSessionId: state.worldSessionId,
      revision: state.revision,
      ...(transactionId ? { transactionId } : {}),
      retryable: e.retryable,
      details: e.details,
    };
    return toMcpToolResult(result);
  }
  function keyFor(
    name: ToolName,
    args: ToolArguments[ToolName],
    call: AgentCall,
  ): string | undefined {
    if (name === "begin_edit") {
      const a = args as ToolArguments["begin_edit"];
      return canonicalJson([
        a.context.worldSessionId,
        call.clientSessionId,
        "begin",
        a.idempotencyKey,
      ]);
    }
    if (writes.has(name) || name === "set_tags") {
      const a = args as
        | ToolArguments["paint_cells"]
        | ToolArguments["set_tags"];
      return canonicalJson([
        a.context.worldSessionId,
        call.clientSessionId,
        "transactionId" in a.context ? a.context.transactionId : "tags",
        a.context.idempotencyKey,
      ]);
    }
    return undefined;
  }
  function prune(client: string): void {
    const now = host.clock.now();
    for (const [key, c] of cache)
      if (
        c.transactionId !== tx.pending?.summary.id &&
        now - c.at > L.reviewIdleMs
      )
        cache.delete(key);
    const entries = [...cache].filter(([, c]) => c.client === client);
    for (const [key, c] of entries)
      if (entries.length > 1023 && c.transactionId !== tx.pending?.summary.id) {
        cache.delete(key);
        entries.pop();
      }
    for (const [id, t] of tx.terminals)
      if (
        now - t.at > L.reviewIdleMs &&
        ![...cache.values()].some((c) => c.transactionId === id)
      )
        tx.terminals.delete(id);
  }
  function replay(c: Cached): AgentToolResult {
    const terminal = c.transactionId
      ? tx.terminals.get(c.transactionId)?.summary
      : undefined;
    if (terminal?.state === "cancelled")
      return failure(
        new AgentError(E.TRANSACTION_CANCELLED, "Transaction was cancelled"),
        c.transactionId,
      );
    const previous = c.result.structuredContent;
    if (!previous.ok) return c.result;
    const state = tx.state();
    const result = {
      ...previous,
      worldSessionId: state.worldSessionId,
      revision: state.revision,
      tentative: !!tx.pending,
      ...("replayed" in previous ? { replayed: true } : {}),
      ...(terminal
        ? { transactionState: terminal.state }
        : c.transactionId === tx.pending?.summary.id
          ? { transactionState: tx.pending!.summary.state }
          : {}),
    } as ToolSuccess;
    return toMcpToolResult(result, c.result.content[1]);
  }
  function log(
    call: AgentCall,
    status: "succeeded" | "failed",
    startedAt: number,
    result: AgentToolResult,
  ): void {
    const s = result.structuredContent;
    const data = s.ok ? s.data : undefined;
    const changed = data && "change" in data ? data.change : undefined;
    // Only inspect schema-validated successful arguments. Never retain raw requests.
    const args = s.ok ? call.arguments as ToolArguments[ToolName] : undefined;
    const transaction = s.ok && (call.name === "finish_edit" || call.name === "cancel_edit")
      ? tx.state().transaction : null;
    const targets = args && "mapId" in args && typeof args.mapId === "string" ? [args.mapId] :
      args && "mapIds" in args && Array.isArray(args.mapIds) ? args.mapIds.filter((id): id is string => typeof id === "string") : [];
    const mapIds = [...targets, ...(changed?.affected.map(a => a.mapId) ?? []), ...(transaction?.affectedMapIds ?? [])];
    try {
      host.activity.append({
        id: host.ids.next("activity"),
        timestamp: host.clock.now(),
        clientInfo: call.clientInfo,
        clientSessionId: call.clientSessionId,
        tool: TOOL_DEFINITIONS.some((t) => t.name === call.name)
          ? (call.name as ToolName)
          : null,
        requestId: null,
        transactionId:
          s.ok && "transactionId" in s
            ? s.transactionId
            : (tx.pending?.summary.id ?? null),
        mapIds: [...new Set(mapIds)],
        status,
        plannedCells: changed?.plannedCells ?? transaction?.counters.plannedWrites ?? 0,
        changedCells: changed?.changedCells ?? transaction?.counters.changedCells ?? 0,
        durationMs: host.clock.now() - startedAt,
        ...(!s.ok ? { code: s.code } : {}),
        summary: call.name,
      });
    } catch {
      /* diagnostics cannot affect a committed operation */
    }
  }
  async function execute(
    call: AgentCall,
    signal: CallSignal,
  ): Promise<AgentToolResult> {
    const startedAt = host.clock.now();
    let result: AgentToolResult, transactionId: string | undefined;
    active = signal;
    activeClient = call.clientSessionId;
    let enteredApply = false;
    try {
      signal.throwIfAborted();
      check(
        !endedSessions.has(call.clientSessionId),
        E.CANCELLED,
        "Authenticated client session has ended",
      );
      validate(call.name, call.arguments);
      const name = call.name as ToolName,
        args = call.arguments as ToolArguments[ToolName];
      const context = "context" in args ? args.context : undefined;
      if (context) tx.world(context.worldSessionId);
      prune(call.clientSessionId);
      const key = keyFor(name, args, call),
        fingerprint = canonicalJson([name, args]);
      const cached = key ? cache.get(key) : undefined;
      if (cached) {
        check(
          cached.fingerprint === fingerprint,
          E.IDEMPOTENCY_CONFLICT,
          "Idempotency key was used with different arguments",
        );
        return replay(cached);
      }
      const callContext: AgentCallContext = { ...call, signal };
      let data: unknown, image: ImageBlock | Uint8Array | undefined;
      if (name === "begin_edit") {
        data = await tx.begin(args as ToolArguments["begin_edit"], callContext);
        transactionId = tx.pending!.summary.id;
      } else if (writes.has(name)) {
        const writeArgs = args as ToolArguments["paint_cells"];
        const pending = tx.owned(
          writeArgs.context,
          callContext,
          name === "cancel_edit",
          name === "cancel_edit",
        );
        transactionId = pending.summary.id;
        if (name === "finish_edit") {
          // No interrupt here: this is the active call that is sealing the writer.
          pending.summary.state = "awaitingApproval";
          tx.phase = "awaitingApproval";
          tx.emit();
          data = {
            transactionId,
            state: "awaitingApproval",
            summary:
              (args as ToolArguments["finish_edit"]).summary ??
              pending.summary.label,
            counters: { ...pending.summary.counters },
            requiresUserApproval: true,
          };
        } else if (name === "cancel_edit") {
          tx.cancel();
          data = {
            transactionId,
            state: "cancelled",
            reason: (args as ToolArguments["cancel_edit"]).reason ?? "",
            rolledBack: true,
          };
        } else {
          const revision = tx.revision;
          try {
            data = await mutate(tx, name, args, callContext);
          } catch (error) {
            if (tx.revision !== revision || !(error instanceof AgentError)) {
              enteredApply = true;
            }
            throw error;
          }
        }
      } else if (name === "set_tags") {
        const a = args as ToolArguments["set_tags"];
        check(
          host.tags.availability().state === "ready",
          E.DISK_CONFLICT,
          "Tags sidecar is unavailable for editing",
        );
        check(
          new Set(a.entries.map((e) => tagKey(e.target))).size ===
            a.entries.length,
          E.INVALID_ARGUMENT,
          "Duplicate tag targets",
        );
        const revision = tx.revision;
        for (const entry of a.entries) {
          normalizeTags(entry.tags);
          const target = entry.target;
          if (target.kind === "tile")
            check(
              host.world
                .tilesets()
                .some(
                  (t) =>
                    t.id === target.tilesetId &&
                    target.tileId <
                      (t.edited?.nextTileId ?? t.columns * t.rows),
                ),
              E.UNKNOWN_ID,
              "Unknown tile",
            );
          else
            check(
              host.world.stamps().some((s) => s.id === target.stampId),
              E.UNKNOWN_ID,
              "Unknown stamp",
            );
          const current = await waitFor(
            target.kind === "tile"
              ? host.images.tileFingerprint(
                  target.tilesetId,
                  target.tileId,
                  signal,
                )
              : host.images.stampFingerprint(target.stampId, signal),
            signal,
          );
          check(
            current === entry.expectedFingerprint,
            E.TAG_FINGERPRINT_CHANGED,
            "Tag fingerprint changed",
          );
        }
        tx.world(a.context.worldSessionId);
        check(
          tx.revision === revision,
          E.REVISION_CONFLICT,
          "World changed while reading fingerprints",
        );
        tx.independent = true;
        try {
          data = await waitFor(
            host.tags.set(
              {
                ...a,
                entries: a.entries.map((e) => ({
                  ...e,
                  tags: normalizeTags(e.tags),
                })),
              },
              callContext,
            ),
            signal,
          );
        } finally {
          tx.independent = false;
        }
      } else {
        const revision = tx.revision,
          worldId = host.session().worldSessionId;
        const output = await read(tx, name, args, callContext);
        signal.throwIfAborted();
        check(
          host.session().worldSessionId === worldId,
          E.STALE_WORLD,
          "World was replaced",
        );
        check(
          tx.revision === revision,
          E.REVISION_CONFLICT,
          "World changed while reading",
        );
        data = output.data;
        if (output.image) {
          const i = output.image;
          check(
            i.width > 0 &&
              i.height > 0 &&
              i.width <= L.imageSide &&
              i.height <= L.imageSide &&
              i.width * i.height <= L.imagePixels &&
              i.png.length <= L.pngBytes,
            E.LIMIT_EXCEEDED,
            "Image budget exceeded",
          );
          image = i.png;
        }
      }
      signal.throwIfAborted();
      const state = tx.state();
      const success = {
        ok: true,
        instanceId: state.instanceId,
        worldSessionId: state.worldSessionId,
        revision: state.revision,
        tentative: !!tx.pending,
        data,
        ...(writes.has(name)
          ? {
              transactionId: transactionId!,
              transactionState:
                tx.pending?.summary.state ??
                tx.terminals.get(transactionId!)?.summary.state ??
                "cancelled",
              replayed: false,
            }
          : name === "set_tags"
            ? { replayed: false }
            : {}),
      } as ToolSuccess;
      result = toMcpToolResult(success, image);
      check(
        utf8(JSON.stringify(result)).length <= L.responseBytes,
        E.LIMIT_EXCEEDED,
        "Response size limit exceeded",
      );
      if (key)
        cache.set(key, {
          fingerprint,
          result,
          at: host.clock.now(),
          client: call.clientSessionId,
          ...(transactionId ? { transactionId } : {}),
        });
    } catch (error) {
      // Expected preflight errors preserve previous work. Unexpected dispatch failures rollback all maps.
      if (
        (enteredApply ||
          (error instanceof AgentError && error.code === E.SOURCE_CHANGED)) &&
        tx.pending
      )
        tx.cancel();
      if (signal.aborted && tx.phase === "preparing") tx.cancel();
      result = failure(error, transactionId);
    } finally {
      if (active === signal) {
        active = undefined;
        activeClient = undefined;
      }
    }
    log(
      call,
      result.structuredContent.ok ? "succeeded" : "failed",
      startedAt,
      result,
    );
    return result;
  }
  return {
    describeTools: () => TOOL_DEFINITIONS,
    getState: () => tx.state(),
    subscribe: (listener) => {
      tx.listeners.add(listener);
      return () => tx.listeners.delete(listener);
    },
    executeTool: (call) => {
      const count = perClient.get(call.clientSessionId) ?? 0;
      if (queued >= L.queueTotal || count >= L.queuePerClient)
        return Promise.resolve(
          failure(new AgentError(E.LIMIT_EXCEEDED, "Agent queue is full")),
        );
      queued++;
      perClient.set(call.clientSessionId, count + 1);
      const signal = new CallSignal();
      signal.onAbort(() => {
        if (active === signal && writes.has(call.name as ToolName) &&
            tx.pending?.summary.owner.clientSessionId === call.clientSessionId)
          tx.seal("stopped");
      });
      const off = call.signal.onAbort(() => signal.abort());
      const timeout =
        call.name === "begin_edit"
          ? L.beginDrainTimeoutMs
          : call.name === "render_preview" ||
              call.name === "get_tile_catalog" ||
              call.name === "list_stamps" ||
              call.name === "prepare_smart_source"
            ? L.imageSourceTimeoutMs
            : L.callTimeoutMs;
      const duration = Math.min(timeout, call.deadline - host.clock.now());
      const timer = host.clock.schedule(Math.max(0, duration), () =>
        signal.abort(new AgentError(E.TIMEOUT, "Agent call deadline expired")),
      );
      if (duration <= 0)
        signal.abort(new AgentError(E.TIMEOUT, "Agent call deadline expired"));
      return enqueue(() => execute(call, signal)).finally(() => {
        off();
        timer();
        queued--;
        perClient.set(
          call.clientSessionId,
          (perClient.get(call.clientSessionId) ?? 1) - 1,
        );
      });
    },
    userAction: (action) => {
      if (action === "stop" || action === "approve") tx.seal("stopped");
      else interrupt();
      return enqueue(async () => {
        const pending = tx.pending;
        // Navigation can load approved metadata followers during review. Enlist them
        // before the synchronous finalizer so saving from that tab sees the same world.
        if (action === "approve" && pending)
          await tx.enlistCached({ ...pending.summary.owner, bridgeEpoch: pending.epoch, deadline: host.clock.now() + L.callTimeoutMs, signal: new CallSignal() });
        const transaction = tx.pending?.summary;
        if (action === "stop") {
          if (tx.phase === "preparing") tx.cancel();
        } else if (action === "approve") tx.approve();
        else tx.cancel();
        if (transaction) {
          try {
            host.activity.append({
              id: host.ids.next("activity"),
              timestamp: host.clock.now(),
              clientInfo: null,
              clientSessionId: null,
              tool: null,
              requestId: null,
              transactionId: transaction.id,
              mapIds: transaction.affectedMapIds,
              status:
                action === "approve"
                  ? "approved"
                  : action === "stop"
                    ? "stopped"
                    : "cancelled",
              plannedCells: transaction.counters.plannedWrites,
              changedCells: transaction.counters.changedCells,
              durationMs: 0,
              summary: action,
            });
          } catch {
            /* log only */
          }
        }
      });
    },
    sessionEnded: (clientSessionId) => {
      endedSessions.add(clientSessionId);
      if (activeClient === clientSessionId) interrupt();
      if (tx.pending?.summary.owner.clientSessionId === clientSessionId) {
        interrupt();
        tx.seal("stopped");
      }
      return enqueue(() => {
        if (tx.pending?.summary.owner.clientSessionId === clientSessionId)
          tx.cancel();
      });
    },
  };
}
