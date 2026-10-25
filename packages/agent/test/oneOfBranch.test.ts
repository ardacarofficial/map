import { describe, expect, it } from "vitest";
import { explainSchemaErrors } from "../src/validation";

const stamp = { tool: "place_stamp", args: { mapId: "m1", stampId: "s1", at: { x: 0, y: 0 } } };
const line = { tool: "paint_line", args: { mapId: "m1", layerId: "l1", from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, value: null } };

describe("oneOf best-branch selection in schema errors", () => {
  it("names the matching apply_operations child, with a JS-style path", () => {
    const msg = explainSchemaErrors("apply_operations", { operations: [line, line, stamp] });
    expect(msg).toBe("operations[2].args.layerMapping: required (place_stamp)");
  });
  it("does not leak other tools' branches when several children are wrong", () => {
    const msg = explainSchemaErrors("apply_operations", { operations: [stamp, line, stamp] });
    expect(msg).toBe("operations[0].args.layerMapping: required (place_stamp); operations[2].args.layerMapping: required (place_stamp)");
    expect(msg).not.toMatch(/paint_cells|must be "/);
  });
  it("reports a stray property on the matching child only", () => {
    const msg = explainSchemaErrors("apply_operations", { operations: [{ ...line, args: { ...line.args, bogus: 1 } }] });
    expect(msg).toBe("operations[0].args: unknown property 'bogus' (paint_line)");
  });
  it("edit_entity picks the branch by its action discriminator", () => {
    expect(explainSchemaErrors("edit_entity", { mapId: "m1", entityId: "e1", action: "move" })).toBe("at: required (move)");
    expect(explainSchemaErrors("edit_entity", { mapId: "m1", entityId: "e1", action: "update" })).toBe("fields: required (update)");
  });
  it("validate_goals checks pick the branch by kind", () => {
    const msg = explainSchemaErrors("validate_goals", { mapId: "m1", checks: [{ kind: "entity_count", region: { x: 0, y: 0, width: 1, height: 1 }, layerIds: ["l1"], min: 0 }] });
    expect(msg).toBe("checks[0].max: required (entity_count)");
  });
  it("without a matching discriminator, falls back to the nearest branch", () => {
    const msg = explainSchemaErrors("edit_entity", { mapId: "m1", entityId: "e1", action: "teleport" });
    expect(msg).toMatch(/action: must be/);
  });
});
