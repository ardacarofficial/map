import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import { TOOL_DEFINITIONS, canonicalJson, generateToolsJson } from "../src/toolSchemas";
import { TOOL_CATALOGUE_HASH } from "../src/catalogue.generated";
import examples from "./fixtures/tool-examples.json";

const names = ["get_session", "get_map_info", "read_region", "list_tilesets", "get_tile_catalog", "list_stamps", "begin_edit", "finish_edit", "cancel_edit", "paint_cells", "paint_rect", "paint_line", "fill", "prepare_smart_source", "smart_brush", "draw_path", "place_stamp", "edit_layer", "list_entity_types", "place_entity", "create_map", "resize_map", "render_preview", "validate_map", "get_tags", "set_tags"];

describe("frozen MCP catalogue", () => {
  it("publishes exactly the agreed tools in order", () => {
    expect(TOOL_DEFINITIONS.map(tool => tool.name)).toEqual(names);
    expect(new Set(names).size).toBe(26);
  });
  it("commits deterministic, self-contained draft 2020-12 schemas", () => {
    const actual = generateToolsJson();
    expect(readFileSync(new URL("../schema/tools.json", import.meta.url), "utf8")).toBe(actual);
    expect(actual.endsWith("\n")).toBe(true);
    expect(actual.includes("\r")).toBe(false);
    expect(createHash("sha256").update(actual).digest("hex")).toBe(examples.catalogueSha256);
    expect(TOOL_CATALOGUE_HASH).toBe(examples.catalogueSha256);
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      const validate = new Ajv2020({ strict: true }).compile(tool.inputSchema);
      const fixture = examples.tools[tool.name];
      expect(fixture.valid.length).toBeGreaterThan(0);
      expect(fixture.invalid.length).toBeGreaterThan(0);
      for (const args of fixture.valid) expect(validate(args), `${tool.name}: ${JSON.stringify(validate.errors)}`).toBe(true);
      for (const args of fixture.invalid) expect(validate(args), `${tool.name}: accepted ${JSON.stringify(args)}`).toBe(false);
      for (const args of fixture.valid) expect(validate({ ...args, unexpected: true }), tool.name).toBe(false);
    }
  });
  it("resolves every local reference, including unused shared definitions", () => {
    for (const tool of TOOL_DEFINITIONS) {
      function visit(value: unknown): void {
        if (value === null || typeof value !== "object") return;
        if ("$ref" in value) {
          const ref = String(value.$ref);
          expect(ref.startsWith("#/"), ref).toBe(true);
          let target: unknown = tool.inputSchema;
          for (const key of ref.slice(2).split("/").map(part => part.replace(/~1/g, "/").replace(/~0/g, "~"))) {
            expect(target !== null && typeof target === "object" && key in target, ref).toBe(true);
            target = (target as Record<string, unknown>)[key];
          }
        }
        for (const child of Object.values(value)) visit(child);
      }
      visit(tool.inputSchema);
    }
  });
  it("sorts object keys recursively without reordering arrays or Unicode text", () => {
    expect(canonicalJson({ z: [{ b: 2, a: "İstanbul" }, 1], a: true }))
      .toBe('{\n  "a": true,\n  "z": [\n    {\n      "a": "İstanbul",\n      "b": 2\n    },\n    1\n  ]\n}\n');
  });
  it("keeps tags independent of edit contexts and map creation inside edits", () => {
    const validate = (name: string, args: unknown) => new Ajv2020().compile(TOOL_DEFINITIONS.find(tool => tool.name === name)!.inputSchema)(args);
    const entry = { target: { kind: "stamp", stampId: "house" }, expectedFingerprint: "a".repeat(64), tags: ["house"] };
    expect(validate("get_tags", { context: { worldSessionId: "world" } })).toBe(true);
    expect(validate("set_tags", { context: { worldSessionId: "world", idempotencyKey: "tags-001" }, entries: [entry] })).toBe(true);
    expect(validate("set_tags", { context: { worldSessionId: "world", transactionId: "edit", idempotencyKey: "tags-001", expectedRevision: 0 }, entries: [entry] })).toBe(false);
    expect(validate("create_map", { context: { worldSessionId: "world" }, name: "Map", width: 8, height: 8, tileWidth: 32, tileHeight: 32 })).toBe(false);
  });
});
