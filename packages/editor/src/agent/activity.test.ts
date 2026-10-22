import { expect, it } from "vitest";
import type { ActivityLogEntry } from "@smap/agent";
import { exportActivityMetrics } from "./activity";

it("exports bounded metric fields without client identities, summaries, or request payloads", () => {
  const entry: ActivityLogEntry = {
    id: "secret-id", timestamp: 123, clientInfo: { name: "private-client", version: "1" },
    clientSessionId: "private-session", requestId: "private-request", transactionId: "private-transaction",
    mapIds: ["private-map"], tool: "read_region", status: "succeeded", plannedCells: 0, changedCells: 0,
    durationMs: 42, summary: "Bearer secret-credential", requestBytes: 10, textBytes: 20, imageBytes: 30, resultBytes: 60,
  };
  const text = exportActivityMetrics([entry]), parsed = JSON.parse(text);
  expect(parsed).toMatchObject({ format: "smap-ai-diagnostics", toolCalls: 1, failedCalls: 0, rows: [{ tool: "read_region", requestBytes: 10, textBytes: 20, imageBytes: 30, resultBytes: 60 }] });
  expect(text).not.toMatch(/private|secret|Bearer/);
});
