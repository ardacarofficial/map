import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { guideResponse } from "../guideProtocol";

test("guide discovery exposes metadata and reads only the ten exact manifest URIs", () => {
  const url = new URL("../../../agent/schema/guide.json", import.meta.url);
  const manifest = JSON.parse(readFileSync(url, "utf8")) as { resources: { uri: string; contentPath: string }[] };
  const listing = guideResponse("resources/list", {}) as { result: { resources: { uri: string }[] } };
  expect(listing.result.resources).toHaveLength(10);
  expect(JSON.stringify(listing)).not.toContain("contentPath");
  expect(JSON.stringify(listing)).not.toContain("# Harita");
  for (const resource of manifest.resources) {
    const response = guideResponse("resources/read", { uri: resource.uri });
    expect(response).toEqual({ result: { contents: [{ uri: resource.uri, mimeType: "text/markdown", text: readFileSync(new URL(resource.contentPath, url), "utf8") }] } });
  }
  expect(guideResponse("resources/templates/list", {})).toEqual({ result: { resourceTemplates: [] } });
  for (const uri of ["file:///etc/passwd", "harita://guide/../secret", "harita://guide/unknown"]) {
    expect(guideResponse("resources/read", { uri })).toEqual({ error: { code: -32002, message: "Guide resource not found" } });
  }
  expect(guideResponse("resources/subscribe", { uri: "harita://guide/overview" })).toBeUndefined();
});

test("prompts load a concise overview and relevant links with bounded Unicode task arguments", () => {
  const response = guideResponse("prompts/get", { name: "harita-map-task", arguments: { task: "Design a village", topic: "collaboration" } }) as { result: { messages: { content: { text: string } }[] } };
  const text = response.result.messages[0]!.content.text;
  expect(text).toContain("Design a village");
  expect(text).toContain("harita://guide/collaboration");
  expect(text).toContain("harita://guide/skill");
  expect(Buffer.byteLength(text)).toBeLessThan(8192);
  expect(guideResponse("prompts/get", { name: "harita-map-task", arguments: { task: "🧱".repeat(2000) } })).toHaveProperty("result");
  for (const args of [
    { task: "🧱".repeat(2001) }, { task: "\u0085" }, { task: "" }, { task: "world", topic: "../secret" },
    { task: "world", topic: 1 }, { task: "world", unknown: "option" },
  ]) expect(guideResponse("prompts/get", { name: "harita-map-task", arguments: args })).toEqual({ error: { code: -32602, message: "Invalid guide parameters" } });
  for (const method of ["resources/list", "resources/templates/list", "prompts/list"]) {
    expect(guideResponse(method, { cursor: "unknown" })).toHaveProperty("error.code", -32602);
  }
  expect(guideResponse("resources/read", {})).toHaveProperty("error.code", -32602);
  expect(guideResponse("prompts/get", { name: "unknown", arguments: { task: "world" } })).toHaveProperty("error.code", -32602);
});

test("workflow prompts map_from_image and map_from_text expand their arguments", () => {
  const listed = guideResponse("prompts/list", {}) as { result: { prompts: { name: string; arguments: { name: string; required: boolean }[] }[] } };
  expect(listed.result.prompts.map(p => p.name)).toEqual(["harita-map-task", "map_from_image", "map_from_text"]);
  expect(listed.result.prompts[1]!.arguments).toEqual([expect.objectContaining({ name: "reference", required: true }), expect.objectContaining({ name: "map", required: false })]);
  const image = guideResponse("prompts/get", { name: "map_from_image", arguments: { reference: "/home/me/köy.png" } }) as { result: { messages: { content: { text: string } }[] } };
  const text = image.result.messages[0]!.content.text;
  expect(text).toContain("/home/me/köy.png");
  expect(text).toContain("the active map");
  for (const step of ["reference_add", "reference_quantize", "paint_grid", "draw_path", "place_stamp", "render_compare", "finish_edit"]) expect(text).toContain(step);
  expect(text).not.toContain("{{");
  const village = guideResponse("prompts/get", { name: "map_from_text", arguments: { description: "a village with a river", map: "Köy" } }) as { result: { messages: { content: { text: string } }[] } };
  expect(village.result.messages[0]!.content.text).toContain("on Köy in Harita: a village with a river");
  for (const args of [{}, { description: "  " }, { description: "x", extra: "y" }, { description: 3 }, { description: "x".repeat(2001) }])
    expect(guideResponse("prompts/get", { name: "map_from_text", arguments: args })).toEqual({ error: { code: -32602, message: "Invalid guide parameters" } });
});
