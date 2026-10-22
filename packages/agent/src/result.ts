import { encodeBase64 } from "@smap/core";
import type {
  AgentFailure,
  AgentToolResult,
  ImageBlock,
  ToolSuccess,
} from "./contracts";
import { canonicalJson } from "./toolSchemas";

/** Shared by runtime and all transports. PNG bytes never enter the JSON envelope. */
export function toMcpToolResult(
  result: ToolSuccess | AgentFailure,
  png?: Uint8Array | ImageBlock,
): AgentToolResult {
  const text = { type: "text" as const, text: canonicalJson(result, false) };
  if (!result.ok)
    return { isError: true, content: [text], structuredContent: result };
  const image: ImageBlock | undefined =
    png instanceof Uint8Array
      ? { type: "image", mimeType: "image/png", data: encodeBase64(png) }
      : png;
  return { content: image ? [text, image] : [text], structuredContent: result };
}
