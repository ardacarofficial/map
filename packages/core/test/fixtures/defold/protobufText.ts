/** Test-only, strict protobuf-text subset. Field definitions and enums are
 * read from the pinned official .proto files, not a second schema
 * invented alongside the writer. No runtime dependency on protobuf tooling.
 */
type Field = { cardinality: string; type: string };
type Definition = { fields: Map<string, Field> } | { values: Set<string> };
export interface ProtoMessage { [field: string]: (ProtoMessage | string | number | boolean)[] }
const tokens = (text: string): string[] => text.match(/"(?:\\.|[^"\\])*"|[A-Za-z_][\w.]*|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[^\s]/g) ?? [];

export class ProtoSchema {
  private readonly definitions = new Map<string, Definition>();

  constructor(sources: readonly string[]) {
    for (const source of sources) {
      const clean = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      const packageName = /\bpackage\s+(\w+)\s*;/.exec(clean)![1]!;
      this.readDefinitions(tokens(clean), packageName);
    }
  }

  private readDefinitions(input: string[], prefix: string, fields?: Map<string, Field>): void {
    for (let i = 0; i < input.length;) {
      const token = input[i++];
      if (token === "message" || token === "enum") {
        const name = `${prefix}.${input[i++]!}`;
        if (input[i++] !== "{") throw new Error("Invalid fixture definition");
        const start = i;
        let depth = 1;
        while (depth && i < input.length) {
          if (input[i] === "{") depth++;
          if (input[i] === "}") depth--;
          i++;
        }
        const body = input.slice(start, i - 1);
        if (token === "message") {
          const childFields = new Map<string, Field>();
          this.definitions.set(name, { fields: childFields });
          this.readDefinitions(body, name, childFields);
        } else {
          const values = new Set<string>();
          for (let j = 0; j < body.length - 2; j++) {
            if (body[j + 1] === "=" && /^\d+$/.test(body[j + 2]!)) values.add(body[j]!);
          }
          this.definitions.set(name, { values });
        }
      } else if (fields && (token === "required" || token === "optional" || token === "repeated")) {
        fields.set(input[i + 1]!, { cardinality: token, type: input[i]! });
        while (i < input.length && input[i++] !== ";") { /* skip field options */ }
      }
    }
  }

  private resolve(type: string, owner: string): Definition | undefined {
    let prefix = owner;
    while (prefix) {
      const found = this.definitions.get(`${prefix}.${type}`);
      if (found) return found;
      prefix = prefix.slice(0, Math.max(0, prefix.lastIndexOf(".")));
    }
    return this.definitions.get(type);
  }

  parse(text: string, type: string): ProtoMessage {
    const input = tokens(text);
    let at = 0;
    const read = (definition: Definition | undefined, owner: string, nested = false): ProtoMessage => {
      if (!definition || !("fields" in definition)) throw new Error(`Unknown message ${owner}`);
      const result: ProtoMessage = {};
      while (at < input.length && input[at] !== "}") {
        const name = input[at++]!;
        const field = definition.fields.get(name);
        if (!field) throw new Error(`Unknown field ${owner}.${name}`);
        if (result[name] && field.cardinality !== "repeated") throw new Error(`Duplicate field ${name}`);
        let value: ProtoMessage | string | number | boolean;
        const target = this.resolve(field.type, owner);
        if (target && "fields" in target) {
          if (input[at] === ":") at++;
          if (input[at++] !== "{") throw new Error(`Expected message ${name}`);
          // Find the actual fully qualified owner for relative nested types.
          const fullName = [...this.definitions].find(([, def]) => def === target)![0];
          value = read(target, fullName, true);
        } else {
          if (input[at++] !== ":") throw new Error(`Expected colon ${name}`);
          const token = input[at++]!;
          if (target && "values" in target) {
            if (!target.values.has(token)) throw new Error(`Invalid enum ${name}`);
            value = token;
          } else if (field.type === "string") {
            if (!token.startsWith('"')) throw new Error(`Expected string ${name}`);
            value = JSON.parse(token) as string;
          } else if (field.type === "bool") {
            if (token !== "true" && token !== "false") throw new Error(`Expected bool ${name}`);
            value = token === "true";
          } else {
            value = Number(token);
            if (!Number.isFinite(value)) throw new Error(`Expected number ${name}`);
            if (field.type === "int32" || field.type === "uint32") {
              const min = field.type === "int32" ? -2147483648 : 0;
              const max = field.type === "int32" ? 2147483647 : 4294967295;
              if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${field.type} ${name}`);
            } else if (field.type !== "float" && field.type !== "double") throw new Error(`Unsupported scalar ${field.type}`);
          }
        }
        (result[name] ??= []).push(value);
      }
      for (const [name, field] of definition.fields) {
        if (field.cardinality === "required" && !result[name]) throw new Error(`Missing required ${owner}.${name}`);
      }
      if (nested && input[at++] !== "}") throw new Error("Unclosed message");
      return result;
    };
    const result = read(this.definitions.get(type), type);
    if (at !== input.length) throw new Error("Trailing tokens");
    return result;
  }
}
