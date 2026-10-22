import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { TOOL_DEFINITIONS, reachableSchemaDefinitions } from "../src/toolSchemas";

describe("tool schema payload", () => {
  it("retains transitive references, nested pointers, escaped keys and recursive definitions", () => {
    const definitions = {
      Node: { type: "object", properties: { next: { $ref: "#/$defs/Node" }, value: { $ref: "#/$defs/a~1b~0c" } } },
      "a/b~c": { type: "string", minLength: 1 },
      Unused: { type: "number" },
    };
    const schema = {
      type: "object", properties: { root: { $ref: "#/$defs/Node" } }, required: ["root"],
      $defs: reachableSchemaDefinitions({ $ref: "#/$defs/Node/properties/value" }, definitions),
    };
    expect(Object.keys(schema.$defs)).toEqual(["Node", "a/b~c"]);
    const validate = new Ajv2020({ strict: true }).compile(schema);
    expect(validate({ root: { next: { value: "leaf" } } })).toBe(true);
    expect(validate({ root: { next: { value: "" } } })).toBe(false);
    expect(reachableSchemaDefinitions({}, definitions)).toEqual({});
    expect(() => reachableSchemaDefinitions({ $ref: "#/$defs/Missing" }, definitions)).toThrow("Unknown schema definition: Missing");
  });

  it("publishes exactly the reachable definitions and compiles every self-contained schema", () => {
    for (const tool of TOOL_DEFINITIONS) {
      const { $defs, ...root } = tool.inputSchema;
      const definitions = $defs as Record<string, unknown>;
      expect(definitions, tool.name).toEqual(reachableSchemaDefinitions(root, definitions));
      expect(() => new Ajv2020({ strict: true }).compile(tool.inputSchema), tool.name).not.toThrow();
    }
  });

  it("substantially reduces tools/list bytes compared with sharing every definition on every tool", () => {
    const allDefinitions = Object.assign({}, ...TOOL_DEFINITIONS.map(tool => tool.inputSchema.$defs));
    const unpruned = TOOL_DEFINITIONS.map(tool => ({ ...tool, inputSchema: { ...tool.inputSchema, $defs: allDefinitions } }));
    const publishedBytes = new TextEncoder().encode(JSON.stringify({ tools: TOOL_DEFINITIONS })).byteLength;
    const unprunedBytes = new TextEncoder().encode(JSON.stringify({ tools: unpruned })).byteLength;
    expect(publishedBytes / unprunedBytes).toBeLessThan(0.65);
  });
});
