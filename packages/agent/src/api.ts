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
  type JsonObject,
  type JsonValue,
  type LifecycleCause,
  type SessionEndReason,
  type ToolArguments,
  type ToolName,
  type ToolSuccess,
} from "./contracts";
import { EDITOR_CONTROL_TOOLS, type EditorControlToolName } from "./editorControls";
import { TOOL_DEFINITIONS, canonicalJson } from "./toolSchemas";
import { toMcpToolResult } from "./result";
import { CallSignal, Transactions, waitFor, type CallCheckpoint } from "./transactions";
import { check, validate } from "./validation";
import { hashCanonical, normalizeTags, tagKey, utf8ByteLength } from "./tags";
import { editMap, editStamp, configureWorld } from "./tools/library";
import { keptPreparations, mutate } from "./tools/mutations";
import { read } from "./tools/read";
import { applyOperations, editEntity } from "./tools/operations";
import { validateGoals } from "./tools/goals";
import { pruneReplayCache, type ReplayRecord } from "./replayCache";
import { vision } from "./tools/vision";
import { VISION_TOOL_NAMES, type VisionToolName } from "./vision";

const visionTools = new Set<string>(VISION_TOOL_NAMES);
/** Reference intake reads a picture, not the map: map edits never interrupt it. */
const mapIndependent = new Set<string>(["visual_ingest_reference", "reference_add"]);

const writes = new Set(
  TOOL_DEFINITIONS.filter(
    (t) => !t.annotations.readOnlyHint && t.name !== "set_tags" && !EDITOR_CONTROL_TOOLS.includes(t.name as EditorControlToolName),
  ).map((t) => t.name),
);
const RETRYABLE = new Set<E>([E.REVISION_CONFLICT, E.TIMEOUT, E.WRITER_BUSY, E.EDITOR_UNAVAILABLE]);
const LIFECYCLE_CODES = new Set<E>([E.TRANSACTION_REQUIRED, E.TRANSACTION_NOT_OWNED, E.TRANSACTION_SEALED, E.TRANSACTION_CANCELLED, E.WRITER_BUSY]);
/** One actionable sentence per code when the failing site gave none (C4). */
const NEXT_ACTION: Partial<Record<E, string>> = {
  [E.NO_WORLD]: "Ask the user to open a world, then call get_session.",
  [E.STALE_WORLD]: "The user opened another world; call get_session and omit or refresh context.worldSessionId.",
  [E.LAYER_LOCKED]: "Pass unlockLayerIds to begin_edit, or call edit_layer {action:'update', props:{locked:false}} inside this draft first.",
  [E.LAYER_HIDDEN]: "Pass unlockLayerIds to begin_edit, or call edit_layer {action:'update', props:{visible:true}} inside this draft first.",
  [E.IDEMPOTENCY_CONFLICT]: "Use a new idempotencyKey for a different payload; reuse a key only to retry the identical call.",
  [E.UNKNOWN_ID]: "Use an ID from get_session, get_map_info, list_tilesets or list_stamps.",
  [E.LIMIT_EXCEEDED]: "Split the work into smaller calls.",
  [E.EDITOR_UNAVAILABLE]: "The editor is busy or not connected; wait a moment and retry.",
  [E.INTERNAL_ERROR]: "Call get_session to inspect the draft; tell the user if this repeats.",
};
const HEAVY_READS = new Set<string>(["validate_map", "validate_goals", "read_region"]);
const IMAGE_TOOLS = new Set<string>(["render_preview", "get_tile_catalog", "list_stamps", "prepare_smart_source", "visual_ingest_reference", "visual_match_reference"]);
/** These stage metadata/maps/sources outside MapStore savepoints, so a failed call cannot be undone alone. */
const NOT_ROLLBACKABLE = new Set<string>(["create_map", "create_stamp", "edit_stamp", "edit_map", "configure_world", "prepare_smart_source", "begin_edit", "resume_edit", "finish_edit", "cancel_edit"]);
const endCause = (reason: SessionEndReason | undefined): LifecycleCause =>
  reason === "expired" ? "sessionExpired" : reason === "tokenRegenerated" ? "tokenRegenerated" : "clientDisconnected";
interface Cached extends ReplayRecord {
  fingerprint: string;
  result?: AgentToolResult;
  transactionId?: string;
  at: number;
  client: string;
  memberId?: string;
  tool?: ToolName;
}

export function createAgentApi(host: AgentHost): AgentApi {
  const tx = new Transactions(host),
    cache = new Map<string, Cached>();
  const endedSessions = new Map<string, LifecycleCause>();
  const signals = new Set<CallSignal>();
  const lifetime = new CallSignal();
  let disposed = false, disposal: Promise<void> | undefined;
  let referenceWorld = host.session().worldSessionId;
  function syncReferenceWorld() {
    const current = host.session().worldSessionId;
    if (current !== referenceWorld) { host.visualReferences?.clear(); referenceWorld = current; }
  }
  let activeClient: string | undefined;
  let activeTool: string | undefined;
  let queue: Promise<unknown> = Promise.resolve(),
    active: CallSignal | undefined,
    approval: CallSignal | undefined,
    queued = 0;
  const perClient = new Map<string, number>();
  function enqueue<T>(task: () => Promise<T> | T): Promise<T> {
    const next = queue.then(task, task);
    queue = next.catch(() => {});
    return next;
  }
  function interrupt() {
    active?.abort();
    approval?.abort();
  }
  tx.interrupt = interrupt;
  tx.onExternal = () => {
    if (disposed) return;
    const worldChanged = host.session().worldSessionId !== referenceWorld;
    syncReferenceWorld();
    // An explicit reference upload does not depend on map contents.
    if (worldChanged || !mapIndependent.has(activeTool ?? "")) interrupt();
    if (tx.pending) {
      if(tx.pending.collaboration){tx.pending.collaboration.stopAll("An external source or world changed; human review/discard is required");tx.seal("stopped","worldChanged");return;}
      tx.seal("stopped","worldChanged");
      void enqueue(() => tx.cancel("cancelled","worldChanged"));
    }
  };
  function failure(error: unknown, transactionId?: string, call?: Pick<AgentCall, "clientSessionId">, extra: JsonObject = {}): AgentToolResult {
    const e =
      error instanceof AgentError
        ? error
        : new AgentError(E.INTERNAL_ERROR, "Agent operation failed");
    const state = tx.state();
    let details: Record<string, JsonValue> = { ...e.details, ...extra };
    if (call && LIFECYCLE_CODES.has(e.code) && !("state" in details)) details = { ...tx.lifecycle(call), ...details };
    const next = NEXT_ACTION[e.code];
    if (!("nextAction" in details) && next) details.nextAction = next;
    const result: AgentFailure = {
      ok: false,
      ...tx.memberRevision({clientSessionId:call?.clientSessionId??activeClient??""},transactionId),
      code: e.code,
      message: e.message,
      worldSessionId: state.worldSessionId,
      revision: state.revision,
      ...(transactionId ? { transactionId } : {}),
      retryable: e.retryable || RETRYABLE.has(e.code),
      details,
    };
    return toMcpToolResult(result);
  }
  /** C2: fill omitted context fields from the open world and the caller's own draft. */
  function normalize(name: string, raw: unknown, call: AgentCall): unknown {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return raw;
    if (name === "join_edit" || EDITOR_CONTROL_TOOLS.includes(name as EditorControlToolName)) return raw;
    const tool = TOOL_DEFINITIONS.find(t => t.name === name);
    const properties = tool?.inputSchema.properties as Record<string, unknown> | undefined;
    if (!tool || !properties || !("context" in properties)) return raw;
    const defs = (tool.inputSchema.$defs ?? {}) as Record<string, unknown>;
    const input = raw as Record<string, unknown>;
    const context: Record<string, unknown> = { ...((input.context as Record<string, unknown> | undefined) ?? {}) };
    context.worldSessionId ??= host.session().worldSessionId ?? "";
    if ("WriteContext" in defs) {
      context.transactionId ??= tx.defaultTransaction(call.clientSessionId) ?? "";
      context.idempotencyKey ??= "";
    } else if ("TagWriteContext" in defs) context.idempotencyKey ??= "";
    return { ...input, context, ...(name === "begin_edit" ? { idempotencyKey: input.idempotencyKey ?? "" } : {}) };
  }
  function keyFor(
    name: ToolName,
    args: ToolArguments[ToolName],
    call: AgentCall,
  ): string | undefined {
    if(name==="join_edit"){const a=args as ToolArguments["join_edit"];return canonicalJson([a.context.worldSessionId,call.clientSessionId,"join",a.transactionId,a.idempotencyKey]);}
    if (name === "resume_edit") return undefined;
    if (name === "begin_edit") {
      const a = args as ToolArguments["begin_edit"];
      if (!a.idempotencyKey) return undefined;
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
      if (!a.context.idempotencyKey) return undefined;
      return canonicalJson([
        a.context.worldSessionId,
        call.clientSessionId,
        "transactionId" in a.context ? a.context.transactionId : "tags",
        a.context.idempotencyKey,
      ]);
    }
    return undefined;
  }
  function prune(): void {
    const now = host.clock.now();
    pruneReplayCache(cache, tx.pending?.summary.id, now);
    const retainedTransactions = new Set([...cache.values()].map(c => c.transactionId));
    for (const [id, t] of tx.terminals)
      if (now - t.at > L.reviewIdleMs && !retainedTransactions.has(id))
        tx.terminals.delete(id);
  }
  function replay(c: Cached): AgentToolResult {
    const member=c.memberId?(tx.pending?.collaboration?.members.get(c.memberId)??tx.terminals.get(c.transactionId??"")?.summary.collaboration?.members.find(m=>m.id===c.memberId)):undefined;
    if(member?.state==="cancelled"&&c.tool!=="cancel_edit")return failure(new AgentError(E.TRANSACTION_CANCELLED,"This member contribution was cancelled"),c.transactionId);
    const terminal = c.transactionId
      ? tx.terminals.get(c.transactionId)?.summary
      : undefined;
    if (terminal?.state === "cancelled")
      return failure(
        new AgentError(E.TRANSACTION_CANCELLED, "Transaction was cancelled"),
        c.transactionId,
      );
    if (!c.result)
      return failure(new AgentError(E.LIMIT_EXCEEDED,
        "Cached response was released; the original request was not repeated"), c.transactionId);
    const previous = c.result.structuredContent;
    if (!previous.ok) return c.result;
    const state = tx.state();
    const result = {
      ...previous,
      ...(member?{memberId:member.id,memberRevision:member.revision}:{}),
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
    replayed = false,
  ): void {
    const s = result.structuredContent;
    const data = s.ok ? s.data : undefined;
    // C3 compact tools report {changed, maps?} instead of a full ChangeSummary.
    const compact = data && "changed" in data && typeof data.changed === "number"
      ? { plannedCells: data.changed, changedCells: data.changed,
          affected: "maps" in data && Array.isArray(data.maps) ? data.maps.map(m => ({ mapId: (m as { mapId: string }).mapId })) : [] }
      : undefined;
    const changed = data && "change" in data ? data.change : compact;
    // Only inspect schema-validated successful arguments. Never retain raw requests.
    const args = s.ok ? call.arguments as ToolArguments[ToolName] : undefined;
    const transaction = s.ok && "transactionId" in s && (call.name === "finish_edit" || call.name === "cancel_edit")
      ? tx.pending?.summary.id === s.transactionId ? tx.pending.summary : tx.terminals.get(s.transactionId)?.summary : null;
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
        ...(tx.memberFor(call)?{memberId:tx.memberFor(call)!.id}:"memberId"in s&&s.memberId?{memberId:s.memberId}:{}),
        transactionId:
          "transactionId" in s
            ? s.transactionId ?? null
            : (tx.pending?.summary.id ?? null),
        mapIds: [...new Set(mapIds)],
        status,
        plannedCells: replayed ? 0 : changed?.plannedCells ?? transaction?.counters.plannedWrites ?? 0,
        changedCells: replayed ? 0 : changed?.changedCells ?? transaction?.counters.changedCells ?? 0,
        durationMs: host.clock.now() - startedAt,
        ...(args ? { requestBytes: utf8ByteLength(JSON.stringify({ name: call.name, arguments: args })) } : {}),
        textBytes: result.content.reduce((sum, block) => sum + (block.type === "text" ? utf8ByteLength(block.text) : 0), 0),
        imageBytes: result.content.reduce((sum, block) => sum + (block.type === "image" ? Math.floor(block.data.length * 3 / 4) - (block.data.endsWith("==") ? 2 : block.data.endsWith("=") ? 1 : 0) : 0), 0),
        resultBytes: utf8ByteLength(JSON.stringify(result)),
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
    let result: AgentToolResult | undefined;
    let transactionId: string | undefined, replayed = false;
    active = signal;
    activeClient = call.clientSessionId;
    activeTool = call.name;
    let enteredApply = false,globalMutation=false,completed=false;
    let checkpoint: CallCheckpoint | undefined, startRevision = tx.revision;
    try {
      signal.throwIfAborted();
      const ended = endedSessions.get(call.clientSessionId);
      if (ended) throw new AgentError(E.CANCELLED, "Authenticated client session has ended",
        { cause: ended, nextAction: "Reconnect (a new MCP session) and call resume_edit with your transactionId and resumeToken." });
      syncReferenceWorld();
      validate(call.name, call.arguments);
      const name = call.name as ToolName,
        rawArgs = call.arguments,
        args = normalize(name, rawArgs, call) as ToolArguments[ToolName];
      const context = "context" in args ? args.context : undefined;
      if (context) tx.world(context.worldSessionId);
      prune();
      const key = keyFor(name, args, call),
        fingerprint = key ? hashCanonical([name, rawArgs]) : "";
      const cached = key ? cache.get(key) : undefined;
      if (cached) {
        check(
          cached.fingerprint === fingerprint,
          E.IDEMPOTENCY_CONFLICT,
          "Idempotency key was used with different arguments",
        );
        replayed = true;
        result = replay(cached);
        return result;
      }
      const callContext: AgentCallContext = { ...call, signal };
      let data: unknown, image: ImageBlock | Uint8Array | undefined;
      if(name==="join_edit"){data=await tx.join(args as ToolArguments["join_edit"],callContext);transactionId=tx.pending!.summary.id;}
      else if (name === "begin_edit") {
        data = await tx.begin(args as ToolArguments["begin_edit"], callContext);
        transactionId = tx.pending!.summary.id;
        completed = true;
      } else if (name === "resume_edit") {
        data = tx.resume(args as ToolArguments["resume_edit"], callContext);
        transactionId = tx.pending!.summary.id;
        completed = true;
      } else if (writes.has(name)) {
        const writeArgs = args as ToolArguments["paint_cells"];
        if (name === "cancel_edit") tx.claimWithToken(writeArgs.context.transactionId, (args as ToolArguments["cancel_edit"]).resumeToken, callContext);
        const pending = tx.owned(
          writeArgs.context,
          callContext,
          name === "cancel_edit",
          name === "cancel_edit",
        );
        transactionId = pending.summary.id;
        if (name === "finish_edit" && pending.collaboration) {
          data=tx.finishMember(callContext,(args as ToolArguments["finish_edit"]).summary??pending.summary.label);
        } else if (name === "finish_edit") {
          // No interrupt here: this is the active call that is sealing the writer.
          pending.summary.state = "awaitingApproval";
          pending.summary.cause = "agentFinished";
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
          completed = true;
        } else if (name === "cancel_edit") {
          const member=tx.memberFor(callContext);
          if(pending.collaboration&&pending.collaboration.hasJoined)tx.cancelMember(callContext.clientSessionId);
          else tx.cancel("cancelled", "agentCancelled");
          completed = true;
          data = {
            transactionId,
            state: "cancelled",
            reason: (args as ToolArguments["cancel_edit"]).reason ?? "",
            rolledBack: true,
            ...(member?{memberId:member.id,scope:"member",sharedResourcesRetained:!!tx.pending?.collaboration?.hasJoined}:{}),
          };
        } else {
          const revision = tx.revision;
          startRevision = revision;
          checkpoint = pending.collaboration || NOT_ROLLBACKABLE.has(name) ? undefined : tx.checkpoint();
          try {
            tx.beginMemberCall(callContext);
            globalMutation=["prepare_smart_source","edit_layer","create_map","resize_map","create_stamp","edit_map","edit_stamp","configure_world"].includes(name);
            if(globalMutation)tx.assertGlobal(callContext);
            data = name === "edit_map" ? editMap(tx, args as ToolArguments["edit_map"])
              : name === "edit_stamp" ? editStamp(tx, args as ToolArguments["edit_stamp"])
              : name === "configure_world" ? configureWorld(tx, args as ToolArguments["configure_world"])
              : name === "apply_operations"
              ? await applyOperations(tx, args as ToolArguments["apply_operations"], callContext)
              : name === "edit_entity"
                ? await editEntity(tx, args as ToolArguments["edit_entity"], callContext)
                : await mutate(tx, name, args, callContext);
            // Postflight failures must not leave an applied write without a
            // successful response or an idempotency record for its retry.
            enteredApply = true;
            completed = true;
            tx.finishMemberCall();
            // render_preview highlight:"lastCall": full change summaries, or compact C3 results ({changed, bounds?}) on args.mapId.
            try {
              type Affected = { mapId: string; bounds?: { x: number; y: number; width: number; height: number } }[];
              const out = data as { change?: { affected: Affected }; changed?: number; bounds?: Affected[number]["bounds"] } | undefined;
              const mapId = (args as { mapId?: unknown }).mapId;
              const affected: Affected | undefined = out?.change ? out.change.affected
                : typeof out?.changed === "number" && typeof mapId === "string" ? [{ mapId, ...(out.bounds ? { bounds: out.bounds } : {}) }] : undefined;
              if (affected) host.references?.noteChange?.(affected);
            } catch { /* diagnostics only */ }
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
        let output;
        if (name === "get_world_settings") {
          output = {data: {settings: host.world.settings()}, image: undefined};
        } else if (EDITOR_CONTROL_TOOLS.includes(name as EditorControlToolName)) {
          const port = host.editorControls;
          check(port, E.EDITOR_UNAVAILABLE, "Editor controls are unavailable in this host");
          let controlData: unknown;
          switch (name) {
            case "get_export_settings": controlData = await waitFor(port.getExportSettings(callContext), signal); break;
            case "configure_export": controlData = await waitFor(port.configureExport(args as ToolArguments["configure_export"], callContext), signal); break;
            case "get_editor_state": controlData = port.getState(); break;
            case "configure_editor": controlData = await waitFor(port.configure(args as ToolArguments["configure_editor"], callContext), signal); break;
            case "configure_layout": controlData = port.configureLayout(args as ToolArguments["configure_layout"]); break;
            case "configure_application": controlData = await waitFor(port.configureApplication(args as ToolArguments["configure_application"], callContext), signal); break;
            case "list_editor_commands": controlData = port.listCommands(args as ToolArguments["list_editor_commands"]); break;
            case "run_editor_command": controlData = port.runCommand(args as ToolArguments["run_editor_command"]); break;
          }
          output = { data: controlData, image: undefined };
        } else if (name === "get_editor_context") {
          check(host.editorContext, E.EDITOR_UNAVAILABLE, "Editor context is unavailable in this host");
          output = { data: host.editorContext(), image: undefined };
        } else if (name === "validate_goals") {
          output = { data: await validateGoals(tx, args as ToolArguments["validate_goals"], callContext), image: undefined };
        } else if (name === "visual_ingest_reference" || name === "visual_match_reference") {
          const port = host.visualReferences;
          check(port, E.EDITOR_UNAVAILABLE, "Visual reference matching is unavailable in this host");
          output = { data: await waitFor<unknown>(name === "visual_ingest_reference"
            ? port.ingestReference(args as ToolArguments["visual_ingest_reference"], callContext)
            : port.matchReference(args as ToolArguments["visual_match_reference"], callContext), signal), image: undefined };
        } else if (visionTools.has(name)) {
          output = await vision(tx, name as VisionToolName, args as ToolArguments[VisionToolName], callContext);
        } else output = await read(tx, name, args, callContext);
        signal.throwIfAborted();
        check(
          host.session().worldSessionId === worldId,
          E.STALE_WORLD,
          "World was replaced",
        );
        check(
          mapIndependent.has(name) || tx.revision === revision,
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
      // A write that completed is kept and replay-cached even if its caller gave up meanwhile.
      if (!completed) signal.throwIfAborted();
      const state = tx.state();
      const success = {
        ok: true,
        instanceId: state.instanceId,
        worldSessionId: state.worldSessionId,
        revision: state.revision,
        tentative: !!tx.pending,
        ...tx.memberRevision(callContext,transactionId),
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
      const serializedResult = JSON.stringify(result);
      check(
        utf8ByteLength(serializedResult) <= L.responseBytes,
        E.LIMIT_EXCEEDED,
        "Response size limit exceeded",
      );
      if (key) {
        cache.set(key, {
          retainedBytes: 2 * serializedResult.length,
          fingerprint,
          result,
          at: host.clock.now(),
          client: call.clientSessionId,
          tool:name,
          ...tx.memberRevision(callContext,transactionId),
          ...(transactionId ? { transactionId } : {}),
        });
        prune();
      }
      tx.releaseMemberCall();
    } catch (error) {
      let failureError=error;
      // Collaborative failures recover only this call/member; peer contributions stay pending.
      const collaborative=!!tx.pending?.collaboration,scopedMutation=!!tx.memberCall;
      try{
        if(collaborative&&globalMutation&&enteredApply&&!tx.pending!.collaboration!.hasJoined){tx.releaseMemberCall();tx.cancel();}
        else if(collaborative){tx.recoverMemberCall();if(signal.aborted&&scopedMutation&&tx.memberFor(call)?.state==="running")tx.cancelMember(call.clientSessionId);if(error instanceof AgentError&&error.code===E.SOURCE_CHANGED){tx.pending!.invalidated=true;tx.pending!.collaboration!.stopAll("A shared source changed; human discard is required");tx.seal("stopped");}}
      }catch(recoveryError){failureError=recoveryError;}
      // Exclusive drafts: a failed call never discards earlier calls. Only that call is
      // undone (core savepoints); a source change still invalidates the whole draft.
      let extra: JsonObject = {};
      const isWrite = writes.has(call.name as ToolName) && !["begin_edit", "resume_edit", "finish_edit", "cancel_edit"].includes(call.name);
      if (!collaborative && tx.pending && isWrite) {
        const partial = enteredApply || tx.revision !== startRevision;
        try {
          if (error instanceof AgentError && error.code === E.SOURCE_CHANGED) { tx.cancel("cancelled", "worldChanged"); extra = { applied: false }; }
          else if (!partial) extra = { applied: false };
          else if (error !== null && typeof error === "object" && keptPreparations.has(error))
            extra = { applied: false, preparedSourceId: keptPreparations.get(error)!, nextAction: "Nothing was painted; the smart source was prepared and kept in this draft. Fix the arguments and retry." };
          else if (checkpoint && tx.rollbackCall(checkpoint)) extra = { applied: false };
          else {
            extra = { applied: true, nextAction: "This call may have been applied; inspect with read_region/get_session before retrying." };
            if (!(error instanceof AgentError)) tx.seal("stopped");
          }
        } catch (recoveryError) {
          failureError = recoveryError;
          if (tx.pending) tx.seal("stopped");
          extra = { applied: true };
        }
        if (extra.applied === false && signal.aborted && tx.phase === "running" && failureError instanceof AgentError && !("nextAction" in failureError.details))
          extra = { ...extra, nextAction: "Nothing from this call was applied and your draft is still running; retry it (split very large work into smaller calls)." };
      }
      if (signal.aborted && tx.phase === "preparing") tx.cancel();
      result = failure(failureError, transactionId, call, extra);
    } finally {
      if (active === signal) {
        active = undefined;
        activeClient = undefined;
        activeTool = undefined;
      }
      if (result) log(
        call,
        result.structuredContent.ok ? "succeeded" : "failed",
        startedAt,
        result,
        replayed,
      );
    }
    return result;
  }
  return {
    describeTools: () => TOOL_DEFINITIONS,
    getState: () => tx.state(),
    subscribe: (listener) => {
      if (disposed) return () => {};
      tx.listeners.add(listener);
      return () => tx.listeners.delete(listener);
    },
    executeTool: (call) => {
      if (disposed)
        return Promise.resolve(failure(new AgentError(E.CANCELLED, "Agent API is disposed")));
      const count = perClient.get(call.clientSessionId) ?? 0;
      if (queued >= L.queueTotal || count >= L.queuePerClient)
        return Promise.resolve(
          failure(new AgentError(E.LIMIT_EXCEEDED, "Agent queue is full")),
        );
      queued++;
      perClient.set(call.clientSessionId, count + 1);
      const signal = new CallSignal();
      signals.add(signal);
      // Aborts (timeout, client cancel) end only this call; the draft keeps running.
      const off = call.signal.onAbort(() => signal.abort());
      const timeout =
        call.name === "begin_edit"
          ? L.beginDrainTimeoutMs
          : IMAGE_TOOLS.has(call.name) || visionTools.has(call.name)
            ? L.imageSourceTimeoutMs
            : writes.has(call.name as ToolName) || HEAVY_READS.has(call.name)
              ? L.mutationTimeoutMs
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
        signals.delete(signal);
        queued--;
        const remaining = (perClient.get(call.clientSessionId) ?? 1) - 1;
        if (remaining > 0) perClient.set(call.clientSessionId, remaining);
        else perClient.delete(call.clientSessionId);
      });
    },
    userAction: (action) => {
      if (disposed) return Promise.resolve();
      if (action === "stop") tx.seal("stopped", "humanStopped");
      else if (action === "approve") tx.seal("stopped");
      else interrupt();
      return enqueue(async () => {
        if (disposed) return;
        const pending = tx.pending;
        // Navigation can load approved metadata followers during review. Enlist them
        // before the synchronous finalizer so saving from that tab sees the same world.
        if (action === "approve" && pending) {
          const signal = new CallSignal();
          approval = signal;
          const off = lifetime.onAbort(() => signal.abort());
          try {
            await tx.enlistCached({ signal });
          } finally {
            off();
            if (approval === signal) approval = undefined;
          }
        }
        if (disposed) return;
        const transaction = tx.pending?.summary;
        if (action === "stop") {
          if (tx.phase === "preparing") tx.cancel();
        } else if (action === "approve") tx.approve();
        else tx.cancel("cancelled", "humanDiscarded");
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
    sessionEnded: (clientSessionId, reason) => {
      if (disposed) return Promise.resolve();
      const cause = endCause(reason);
      endedSessions.set(clientSessionId, cause);
      // Ended sessions are rejected before replay, so their payloads are unreachable.
      for (const [key, entry] of cache)
        if (entry.client === clientSessionId) cache.delete(key);
      host.visualReferences?.sessionEnded(clientSessionId);
      const collaborative=tx.pending?.collaboration,member=tx.memberFor({clientSessionId});
      if(collaborative&&member){
        if(activeClient===clientSessionId)active?.abort();
        const rollback=member.state==="running"||member.state==="cancelling";
        if(!rollback)tx.detachMember(clientSessionId);
        return enqueue(()=>{if(rollback&&tx.pending?.collaboration===collaborative){tx.cancelMember(clientSessionId,true);}});
      }
      const pending = tx.pending;
      const owned = pending?.summary.owner.clientSessionId === clientSessionId;
      // C5: session loss never rolls back applied work. A running draft is orphaned
      // (sealed for the human, resumable with its token); only unapplied preparation is cancelled.
      const preparing = owned && tx.phase === "preparing";
      if (owned && tx.phase === "running") tx.orphan(cause);
      else if (owned && !preparing) {
        pending.summary.owner.clientSessionId = null;
        tx.emit();
      }
      if (activeClient === clientSessionId || preparing) interrupt();
      return enqueue(() => {
        if (preparing && tx.pending === pending) tx.cancel();
      });
    },
    dispose: () => {
      if (disposal) return disposal;
      disposed = true;
      lifetime.abort();
      for (const signal of signals) signal.abort();
      disposal = enqueue(() => {
        try {
          tx.cancel();
        } finally {
          tx.dispose();
          cache.clear();
          endedSessions.clear();
          perClient.clear();
          host.visualReferences?.clear();
        }
      });
      return disposal;
    },
  };
}
