import { fileURLToPath } from "node:url";
import { build } from "vite";
import { afterEach, expect, test, vi } from "vitest";
import { agentPlugin } from "../agentPlugin";
afterEach(() => { vi.unstubAllEnvs(); });

test("production eliminates the guarded browser pairing client and serve-only plugin", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("HARITA_DEV_MCP", "1");
  const client = fileURLToPath(new URL("../../src/agent/devConnection.ts", import.meta.url));
  const result = await build({
    configFile: false, logLevel: "silent",
    plugins: [agentPlugin(), { name: "production-guard-fixture", resolveId: (id) => id === "virtual:entry" ? "\0entry" : undefined,
      load: (id) => id === "\0entry" ? `export function boot(){if(import.meta.env.DEV)return import(${JSON.stringify(client)});return null;}` : undefined }],
    build: { write: false, minify: true, rolldownOptions: { input: "virtual:entry", preserveEntrySignatures: "strict", output: { format: "es" } } },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((item) => "output" in item ? item.output : []);
  const code = outputs.map((output) => output.type === "chunk" ? output.code : "").join("\n");
  expect(code).toContain("boot");
  expect(code).not.toMatch(/harita:agent|__harita|pairing|devConnection|node:|modelcontextprotocol/);
});
