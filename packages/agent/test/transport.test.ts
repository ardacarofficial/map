import { inflateSync } from "node:zlib";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { AGENT_LIMITS, AgentErrorCode, MCP_PROTOCOL_VERSIONS } from "../src/contracts";
import schema from "../schema/transport.json";
import vectors from "./fixtures/transport-examples.json";
import { harness, success } from "./helpers";
import { canonicalJson } from "../src/toolSchemas";
import { toMcpToolResult } from "../src/result";

describe("cross-transport conformance", () => {
  it("reduces dense runtime JSON text by at least 75% while preserving payload and PNG blocks", async () => {
    const h = harness({width:64,height:64});
    const store = h.host.stores.get("map-1")!;
    for (let i=1;i<4;i++) store.dispatch({type:"addLayer",layer:{id:`layer-${i}`,name:`Layer ${i}`}});
    const result = await h.read("read_region",{mapId:"map-1",layerIds:["ground","layer-1","layer-2","layer-3"],region:{x:0,y:0,width:64,height:64}});
    const payload = success(result), compact = result.content[0]!;
    if (compact.type!=="text") throw new Error("Expected text");
    const textBytes = Buffer.byteLength(compact.text), prettyBytes = Buffer.byteLength(canonicalJson(payload));
    expect(textBytes/prettyBytes).toBeLessThanOrEqual(0.25);
    expect(JSON.parse(compact.text)).toEqual(payload);
    expect(compact.text).not.toContain("\n");
    const image = {type:"image" as const,mimeType:"image/png" as const,data:"AAECA/8="};
    expect(toMcpToolResult(payload,image).content[1]).toBe(image);
    expect(toMcpToolResult(payload).content[0]).toEqual(compact);
  });
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
