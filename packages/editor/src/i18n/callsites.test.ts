import ts from "typescript";
import { expect, it } from "vitest";
import { messageArguments, type MessageKey } from "./messages.generated";

const sources = import.meta.glob<string>(["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}", "!../i18n/**"], { eager: true, query: "?raw", import: "default" });

it("static t() calls use existing keys and supply every required argument", () => {
  const problems: string[] = [];
  for (const [path, source] of Object.entries(sources)) {
    if (!source.includes("t(")) continue;
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false, path.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t") {
        const key = node.arguments[0];
        if (key && ts.isStringLiteral(key)) {
          const required = messageArguments[key.text as MessageKey];
          if (!required) problems.push(`${path}: unknown key ${key.text}`);
          else {
            const params = node.arguments[1];
            if (!params || (ts.isObjectLiteralExpression(params) && !params.properties.some(ts.isSpreadAssignment))) {
              const provided = new Set(params?.properties.flatMap(property => property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? [property.name.text] : []) ?? []);
              for (const arg of Object.keys(required)) if (!provided.has(arg)) problems.push(`${path}: ${key.text} missing ${arg}`);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  expect(problems).toEqual([]);
}, 30_000);
