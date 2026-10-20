import { inflateSync } from "node:zlib";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { AGENT_LIMITS, AgentErrorCode, MCP_PROTOCOL_VERSIONS } from "../src/contracts";
import schema from "../schema/transport.json";
import vectors from "./fixtures/transport-examples.json";

describe("cross-transport conformance", () => {
  it("shares budgets, protocol versions and stable application error codes", () => {
    expect(vectors.limits).toEqual(AGENT_LIMITS);
    expect(vectors.protocolVersions).toEqual(MCP_PROTOCOL_VERSIONS);
    expect(vectors.errorCodes).toEqual(Object.values(AgentErrorCode));
  });
  it("validates request, reply, control, error and image envelopes", () => {
    const validate = new Ajv2020({ strict: true }).compile(schema);
    for (const value of vectors.valid) expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
    for (const value of vectors.invalid) expect(validate(value), `accepted ${JSON.stringify(value)}`).toBe(false);
  });
  it("preserves stable JSON text, structured payloads and unwrapped PNG bytes", () => {
    let images = 0;
    for (const value of vectors.valid) {
      if (value.type !== "result" || !("result" in value)) continue;
      const result = value.result;
      expect(JSON.parse(result.content[0]!.text!)).toEqual(result.structuredContent);
      expect(JSON.stringify(result.structuredContent)).not.toContain("base64");
      if (result.content.length === 2) {
        const block = result.content[1]!;
        expect(block.type).toBe("image");
        if (!("data" in block) || !("mimeType" in block)) throw new Error("Expected PNG image block");
        expect(block.mimeType).toBe("image/png");
        const png = Buffer.from(block.data!, "base64");
        expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
        expect(png.toString("base64")).toBe(block.data);
        expect(png.readUInt32BE(16)).toBe(1);
        expect(png.readUInt32BE(20)).toBe(1);
        const dataChunks: Buffer[] = [];
        for (let offset = 8; offset < png.length;) {
          const length = png.readUInt32BE(offset);
          if (png.toString("ascii", offset + 4, offset + 8) === "IDAT") dataChunks.push(png.subarray(offset + 8, offset + 8 + length));
          offset += length + 12;
        }
        expect([...inflateSync(Buffer.concat(dataChunks))]).toEqual([0, 255, 0, 0, 255]);
        images++;
      }
    }
    expect(images).toBeGreaterThan(0);
  });
});
