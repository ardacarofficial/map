import { IntlMessageFormat } from "intl-messageformat";

export type ArgumentKind = "string" | "number";
export type ArgumentSchema = Record<string, ArgumentKind>;

/** Walk the FormatJS AST, including arguments in every plural/select branch. */
export function argumentSchema(message: string, locale = "tr"): ArgumentSchema {
  const result: ArgumentSchema = {};
  const visit = (nodes: ReturnType<IntlMessageFormat["getAst"]>) => {
    for (const node of nodes) {
      if (node.type === 0 || node.type === 7) continue;
      if (node.type === 8) { visit(node.children); continue; }
      const kind = node.type === 2 || node.type === 3 || node.type === 4 || node.type === 6 ? "number" : "string";
      if (kind === "number" || !result[node.value]) result[node.value] = kind;
      if (node.type === 5 || node.type === 6) {
        for (const option of Object.values(node.options)) visit(option.value);
      }
    }
  };
  visit(new IntlMessageFormat(message, locale, undefined, { ignoreTag: true }).getAst());
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}
