import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { guideResponse } from "../guideProtocol";

test("guide discovery exposes metadata and reads only the nine exact manifest URIs", () => {
  const url = new URL("../../../agent/schema/guide.json", import.meta.url);
  const manifest = JSON.parse(readFileSync(url, "utf8")) as { resources: { uri: string; contentPath: string }[] };
  const listing = guideResponse("resources/list", {}) as { result: { resources: { uri: string }[] } };
  expect(listing.result.resources).toHaveLength(9);
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
