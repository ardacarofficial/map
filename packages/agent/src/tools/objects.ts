/** Agent side of the object tools: validation and host dispatch. Both tools only read. */
import { isValidTileId } from "@smap/core";
import { AgentErrorCode as E, type AgentCallContext, type ToolArguments } from "../contracts";
import { OBJECT_LIMITS, type AgentObjectsPort, type ObjectToolName } from "../objects";
import type { ReferenceAlignmentInput } from "../vision";
import { type Transactions, waitFor } from "../transactions";
import { check } from "../validation";
import { storeFor, type ReadOutput } from "./read";

function port(tx: Transactions): AgentObjectsPort {
  const objects = tx.host.objects;
  check(objects, E.EDITOR_UNAVAILABLE, "Object detection is unavailable in this host", { nextAction: "Use reference_quantize and render_preview instead." });
  return objects;
}
/** An explicit alignment must describe a real grid; "auto"/"none" are resolved by the host. */
function alignment(value: ToolArguments["reference_detect_objects"]["alignment"]): void {
  if (value === undefined || typeof value === "string") return;
  const a = value as ReferenceAlignmentInput;
  check([a.cellPx, a.offsetX, a.offsetY].every(Number.isFinite) && a.cellPx > 0 && (a.scale === undefined || a.scale > 0), E.INVALID_ARGUMENT, "alignment needs a positive cellPx", { nextAction: "Pass the alignment from reference_align unchanged, or alignment:\"auto\"." });
}

export async function objects(tx: Transactions, name: ObjectToolName, args: ToolArguments[ObjectToolName], call: AgentCallContext): Promise<ReadOutput> {
  switch (name) {
    case "reference_detect_objects": {
      const a = args as ToolArguments["reference_detect_objects"];
      const references = tx.host.references;
      check(references, E.EDITOR_UNAVAILABLE, "Reference images are unavailable in this host");
      const objectPort = port(tx);
      const list = references.list();
      check(list.some(r => r.referenceId === a.referenceId), E.UNKNOWN_ID, "Unknown referenceId", {
        validIds: list.map(r => r.referenceId),
        nextAction: list.length ? "Use a referenceId from get_session.references." : "Ask the user to drop the picture onto the AI activity panel, or call reference_add with a local image path.",
      });
      await storeFor(tx, a.mapId, call);
      alignment(a.alignment);
      const stamps = tx.host.world.stamps();
      for (const id of a.stampIds ?? []) check(stamps.some(s => s.id === id), E.UNKNOWN_ID, "Unknown stamp in stampIds", { stampId: id, validIds: stamps.map(s => s.id).slice(0, 64) });
      const stampIds = a.stampIds ?? stamps.map(s => s.id);
      check(stampIds.length, E.INVALID_ARGUMENT, "The world has no stamps to look for", { nextAction: "Call suggest_stamps on the tileset, show the candidates to the user and create_stamp the ones they accept." });
      check(stampIds.length <= OBJECT_LIMITS.stamps, E.LIMIT_EXCEEDED, "Search at most 64 stamps per call", { nextAction: "Pass stampIds (list_stamps) for the objects the picture shows." });
      const out = await waitFor(objectPort.detect({ ...a, stampIds }, call), call.signal);
      return { data: out.data, ...(out.image ? { image: out.image } : {}) };
    }
    case "suggest_stamps": {
      const a = args as ToolArguments["suggest_stamps"];
      const objectPort = port(tx);
      const tilesets = tx.host.world.tilesets(), tileset = tilesets.find(t => t.id === a.tilesetId);
      check(tileset, E.UNKNOWN_ID, "Unknown tileset", { tilesetId: a.tilesetId, validIds: tilesets.map(t => t.id).slice(0, 64) });
      if (a.region) check(a.region.x + a.region.width <= tileset.columns && a.region.y + a.region.height <= tileset.rows && isValidTileId(tileset, a.region.y * tileset.columns + a.region.x),
        E.OUT_OF_BOUNDS, "region lies outside the tileset sheet", { columns: tileset.columns, rows: tileset.rows });
      const out = await waitFor(objectPort.suggest(a, call), call.signal);
      return { data: out.data, ...(out.image ? { image: out.image } : {}) };
    }
  }
}
