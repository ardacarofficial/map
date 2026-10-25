import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import { TOOL_DEFINITIONS, canonicalJson } from "../src/toolSchemas";
import { PUBLISHED_TOOLS, generateToolsJson } from "../src/publishedCatalogue";
import { TOOL_CATALOGUE_HASH } from "../src/catalogue.generated";
import examples from "./fixtures/tool-examples.json";

const names = ["get_session", "get_map_info", "read_region", "list_tilesets", "get_tile_catalog", "list_stamps", "begin_edit", "finish_edit", "cancel_edit", "paint_cells", "paint_rect", "paint_line", "fill", "prepare_smart_source", "smart_brush", "draw_path", "place_stamp", "edit_layer", "list_entity_types", "place_entity", "create_map", "resize_map", "render_preview", "validate_map", "get_tags", "set_tags", "visual_ingest_reference", "visual_match_reference", "create_stamp", "resume_edit", "paint_grid", "replace_tiles", "clear_region", "get_editor_context", "edit_entity", "apply_operations", "validate_goals", "get_export_settings", "configure_export", "get_editor_state", "configure_editor", "configure_layout", "configure_application", "list_editor_commands", "editor_ui", "run_editor_command", "edit_map", "edit_stamp", "get_world_settings", "configure_world", "import_tiled", "join_edit", "reference_add", "reference_view", "reference_quantize", "render_compare", "reference_align", "reference_detect_objects", "suggest_stamps"];

describe("frozen MCP catalogue", () => {
  it("marks only writes that persist outside the human-reviewed draft as destructive", () => {
    const annotations = Object.fromEntries(TOOL_DEFINITIONS.map(tool => [tool.name, tool.annotations]));
    for (const name of ["begin_edit", "resume_edit", "finish_edit", "cancel_edit", "paint_cells", "paint_grid", "replace_tiles", "clear_region", "smart_brush", "draw_path", "place_stamp", "create_map", "import_tiled", "apply_operations", "edit_stamp", "configure_world", "join_edit"]) {
      expect(annotations[name], name).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    }
    for (const name of ["set_tags", "configure_export", "configure_layout", "configure_application"]) expect(annotations[name]?.destructiveHint, name).toBe(true);
    expect(annotations.paint_rect?.idempotentHint).toBe(true);
    expect(annotations.place_entity?.idempotentHint).toBeUndefined();
    for (const tool of TOOL_DEFINITIONS.filter(item => item.annotations.readOnlyHint)) expect(tool.annotations.destructiveHint, tool.name).toBe(false);
  });
  it("publishes exactly the agreed tools in order", () => {
    expect(TOOL_DEFINITIONS.map(tool => tool.name)).toEqual(names);
    expect(new Set(names).size).toBe(59);
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
      const fixture = examples.tools[tool.name as keyof typeof examples.tools];
      expect(fixture.valid.length).toBeGreaterThan(0);
      expect(fixture.invalid.length).toBeGreaterThan(0);
      for (const args of fixture.valid) expect(validate(args), `${tool.name}: ${JSON.stringify(validate.errors)}`).toBe(true);
      for (const args of fixture.invalid) expect(validate(args), `${tool.name}: accepted ${JSON.stringify(args)}`).toBe(false);
      for (const args of fixture.valid) expect(validate({ ...args, unexpected: true }), tool.name).toBe(false);
    }
  }, 30000);
  it("lists a compact catalogue under 40 KB that every valid call satisfies", () => {
    const listed = JSON.stringify({ tools: PUBLISHED_TOOLS });
    expect(Buffer.byteLength(listed, "utf8")).toBeLessThan(40 * 1024);
    expect(JSON.parse(readFileSync(new URL("../schema/tools.json", import.meta.url), "utf8"))).toEqual({ tools: JSON.parse(listed).tools });
    const listedNames = PUBLISHED_TOOLS.map(tool => tool.name);
    for (const hidden of ["get_editor_state", "configure_editor", "configure_layout", "configure_application", "list_editor_commands", "run_editor_command", "get_export_settings", "configure_export"])
      expect(listedNames, hidden).not.toContain(hidden);
    expect(listedNames).toContain("editor_ui");
    expect(listedNames.length).toBe(names.length - 8);
    for (const tool of PUBLISHED_TOOLS) {
      expect(tool.description.length, tool.name).toBeLessThan(420);
      expect(JSON.stringify(tool.inputSchema)).not.toContain("$ref");
      const validate = new Ajv2020({ strict: false }).compile(tool.inputSchema);
      for (const args of examples.tools[tool.name as keyof typeof examples.tools].valid) expect(validate(args), `${tool.name}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });
  it("bounds batches at 32 existing-ID operations and forbids implicit stamp layer creation", () => {
    const validate = new Ajv2020({ strict: true }).compile(TOOL_DEFINITIONS.find(tool => tool.name === "apply_operations")!.inputSchema);
    const fixture = examples.tools.apply_operations.valid[0]!;
    const item = fixture.operations[0]!;
    expect(validate({ ...fixture, operations: Array.from({ length: 32 }, () => item) })).toBe(true);
    expect(validate({ ...fixture, operations: Array.from({ length: 33 }, () => item) })).toBe(false);
    expect(validate({ ...fixture, operations: [{ tool: "place_stamp", args: { mapId: "map", stampId: "house", at: { x: 0, y: 0 } } }] })).toBe(false);
    expect(validate({ ...fixture, operations: [{ tool: "place_stamp", args: { mapId: "map", stampId: "house", at: { x: 0, y: 0 }, layerMapping: [{ sourceLayerId: "base", targetLayerId: "ground" }], allowCreateLayers: true } }] })).toBe(false);
  });
  it("resolves every local reference, including transitive shared definitions", () => {
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
    // C2: write context fields are optional; the API resolves the caller's own edit.
    expect(validate("create_map", { context: { worldSessionId: "world" }, name: "Map", width: 8, height: 8, tileWidth: 32, tileHeight: 32 })).toBe(true);
    expect(validate("create_map", { name: "Map", width: 8, height: 8, tileWidth: 32, tileHeight: 32 })).toBe(true);
    expect(validate("create_map", { context: { expectedRevision: 1, expectedMemberRevision: 1 }, name: "Map", width: 8, height: 8, tileWidth: 32, tileHeight: 32 })).toBe(false);
  });
});
