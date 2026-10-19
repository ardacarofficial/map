/** Re-runnable bridge for lanes still adding keys to the legacy TS catalogs. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Preserve the old /{word}/ interpolation; quote all other ICU syntax. */
export function escapeLegacyMessage(message: string): string {
  return message.split(/(\{\w+\})/g).map(part => /^\{\w+\}$/.test(part) ? part : part.replace(/'/g, "''").replace(/[{}]/g, c => `'${c}'`)).join("");
}

/** Count nouns get singular English forms; Turkish keeps the counted noun bare. */
export function pluralize(message: string, locale: string): string {
  if (locale === "tr") return message.replace(/\{(count|columns)\}/g, "{$1, plural, one {#} other {#}}").replace(/\{layers\} katman/g, "{layers, plural, one {# katman} other {# katman}}").replace(/\{levels\} haritada/g, "{levels, plural, one {# haritada} other {# haritada}}");
  const nouns: Record<string, string> = { layers: "layer", candidates: "candidate", cells: "cell", tiles: "tile", tilesets: "tileset", entities: "entity", portals: "portal", levels: "level", maps: "map", steps: "step", entries: "entry", stamps: "stamp", columns: "column" };
  return message.replace(/\{(count|layers|levels|columns)\}( blocked| linked| more)? (layers|candidates|cells|tilesets|tiles|entities|portals|levels|maps|steps|entries|stamps|columns)\b/g,
    (_match, arg: string, modifier: string | undefined, noun: string) => `{${arg}, plural, one {#${modifier ?? ""} ${nouns[noun]}} other {#${modifier ?? ""} ${noun}}}`).replace(/(one \{#[^}]+)(\} other \{#[^}]+)\}\} (are|use|fall)\b/g,
      (_match, one: string, other: string, verb: string) => `${one} ${verb === "are" ? "is" : `${verb}s`}${other} ${verb}}}`)
    .replace(/\{count\}/g, "{count, number}");
}

/** Add only newly merged legacy keys; retain reviewed ICU translations. */
export function mergeFeature(existing: Record<string, string>, entries: Record<string, string>, id: string): Record<string, string> {
  const merged = { ...existing };
  for (const [key, message] of Object.entries(entries)) {
    if (!Object.hasOwn(merged, key)) merged[key] = pluralize(escapeLegacyMessage(message), id);
  }
  return merged;
}

export async function readLegacy(source: string, id: string): Promise<Record<string, Record<string, string>>> {
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
  const module = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`) as Record<string, Record<string, Record<string, string>>>;
  return module[id]!;
}

export async function migrate(ref?: string): Promise<void> {
  for (const [id, nativeName] of [["tr", "Türkçe"], ["en", "English"]] as const) {
    const path = `packages/editor/src/i18n/${id}.ts`;
    const source = ref ? execFileSync("git", ["show", `${ref}:${path}`], { cwd: root, encoding: "utf8" }) : readFileSync(resolve(root, "src/i18n", `${id}.ts`), "utf8");
    const messages = await readLegacy(source, id);
    const folder = resolve(root, "src/i18n/locales", id);
    mkdirSync(folder, { recursive: true });
    for (const [feature, entries] of Object.entries(messages)) {
      const target = resolve(folder, `${feature}.json`);
      const existing = existsSync(target) ? JSON.parse(readFileSync(target, "utf8")) as Record<string, string> : {};
      writeFileSync(target, JSON.stringify(mergeFeature(existing, entries, id), null, 2) + "\n");
    }
    writeFileSync(resolve(folder, "meta.json"), JSON.stringify({ id, nativeName, fallback: "tr" }, null, 2) + "\n");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const refIndex = process.argv.indexOf("--ref");
  await migrate(refIndex < 0 ? undefined : process.argv[refIndex + 1]);
}
