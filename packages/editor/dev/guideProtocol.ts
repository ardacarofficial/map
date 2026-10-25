import { readFileSync } from "node:fs";

interface Resource { uri: string; name: string; title: string; description: string; mimeType: string; contentPath: string }
type ProtocolResponse = { result: unknown } | { error: { code: number; message: string } };
const manifestUrl = new URL("../../agent/schema/guide.json", import.meta.url);
const manifest = JSON.parse(readFileSync(manifestUrl, "utf8")) as { version: number; resources: Resource[] };
if (manifest.version !== 1 || !Array.isArray(manifest.resources)) throw new Error("Invalid authoring guide manifest");
const resources = manifest.resources.map(({ uri, name, title, description, mimeType }) => ({ uri, name, title, description, mimeType }));
const sources = new Map(manifest.resources.map(resource => {
  // Paths come only from the repository's static manifest, never MCP requests.
  const content = readFileSync(new URL(resource.contentPath, manifestUrl), "utf8");
  if (!content.trim() || Buffer.byteLength(content, "utf8") > 32768) throw new Error("Invalid authoring guide resource");
  return [resource.uri, content];
}));
if (sources.size !== resources.length) throw new Error("Duplicate authoring guide URI");
const PROMPT = "harita-map-task";
const prompts: { name: string; title: string; description: string; arguments: { name: string; description: string; required: boolean }[] }[] = [{
  name: PROMPT, title: "Plan a Harita map task",
  description: "Start a bounded map task with the editor guide and relevant topic; inspect live state separately.",
  arguments: [
    { name: "task", description: "The requested map design or editor task (up to 2000 characters).", required: true },
    { name: "topic", description: "Optional guide topic: planning, assets, painting, collaboration, validation, editor, workflow or skill.", required: false },
  ],
}];
/** Workflow prompts shared with the desktop server (schema/prompts.json). */
interface TemplatePrompt { name: string; title: string; description: string; arguments: { name: string; description: string; required: boolean; default?: string }[]; template: string }
const templates = (JSON.parse(readFileSync(new URL("../../agent/schema/prompts.json", import.meta.url), "utf8")) as { version: number; prompts: TemplatePrompt[] }).prompts;
prompts.push(...templates.map(({ name, title, description, arguments: args }) => ({ name, title, description, arguments: args.map(({ name, description, required }) => ({ name, description, required })) })));
function templatePrompt(prompt: TemplatePrompt, args: Record<string, unknown>): ProtocolResponse {
  if (Object.keys(args).some(key => !prompt.arguments.some(a => a.name === key))) return invalid();
  let text = prompt.template;
  for (const a of prompt.arguments) {
    const value = args[a.name];
    if (value !== undefined && (typeof value !== "string" || [...value].length > 2000)) return invalid();
    const given = typeof value === "string" && /\P{White_Space}/u.test(value) ? value.trim() : undefined;
    if (a.required && given === undefined) return invalid();
    text = text.split(`{{${a.name}}}`).join(given ?? a.default ?? "");
  }
  return { result: { description: prompt.description, messages: [{ role: "user", content: { type: "text", text } }] } };
}
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
const invalid = (): ProtocolResponse => ({ error: { code: -32602, message: "Invalid guide parameters" } });

/** Session/authentication checks precede this static, read-only dispatch. */
export function guideResponse(method: string, params: unknown): ProtocolResponse | undefined {
  switch (method) {
    case "resources/list":
    case "resources/templates/list":
    case "prompts/list": {
      if (params !== null && params !== undefined && !object(params)) return invalid();
      if (object(params) && "cursor" in params) return invalid();
      return { result: method === "resources/list" ? { resources } : method === "prompts/list" ? { prompts } : { resourceTemplates: [] } };
    }
    case "resources/read": {
      const uri = object(params) ? params.uri : undefined;
      if (typeof uri !== "string" || Buffer.byteLength(uri, "utf8") > 128) return invalid();
      const text = sources.get(uri);
      return text === undefined ? { error: { code: -32002, message: "Guide resource not found" } }
        : { result: { contents: [{ uri, mimeType: "text/markdown", text }] } };
    }
    case "prompts/get": {
      const template = object(params) ? templates.find(p => p.name === params.name) : undefined;
      if (template && object(params)) return object(params.arguments) || params.arguments === undefined ? templatePrompt(template, (params.arguments ?? {}) as Record<string, unknown>) : invalid();
      if (!object(params) || params.name !== PROMPT || !object(params.arguments)) return invalid();
      const args = params.arguments;
      if (Object.keys(args).some(key => key !== "task" && key !== "topic")) return invalid();
      const task = args.task, topic = args.topic === undefined ? "workflow" : args.topic;
      // Rust counts Unicode scalars and trims Unicode White_Space characters.
      if (typeof task !== "string" || !/\P{White_Space}/u.test(task) || [...task].length > 2000 || typeof topic !== "string") return invalid();
      const uri = `harita://guide/${topic}`;
      if (!sources.has(uri)) return invalid();
      return { result: { description: "Harita task bootstrap; load only the relevant guide sections.", messages: [{
        role: "user", content: { type: "text", text: `${sources.get("harita://guide/overview")}\n\nRequested task:\n${task}\n\nRead ${uri} and harita://guide/skill as needed, then inspect get_session and get_editor_context before proposing edits. Guide text describes capabilities; live tool results determine current state.` },
      }] } };
    }
    default: return undefined;
  }
}
