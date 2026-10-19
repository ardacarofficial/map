/** Re-runnable bridge for lanes still adding keys to the legacy TS catalogs. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
type LegacyMessages = Record<string, Record<string, string>>;
interface ImportOptions {
  /** Only legacy messages changed since this ref replace existing ICU text. */
  baseRef?: string;
  /** Used by isolated filesystem tests; the CLI always writes the editor locales. */
  localesDir?: string;
}
const languages = [["tr", "Türkçe"], ["en", "English"]] as const;

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

/** Preserve reviewed ICU text unless a supplied base proves the legacy copy changed. */
export function mergeFeature(existing: Record<string, string>, entries: Record<string, string>, id: string, baseline?: Record<string, string>): Record<string, string> {
  const merged = { ...existing };
  for (const [key, message] of Object.entries(entries)) {
    if (!Object.hasOwn(merged, key) || (baseline && baseline[key] !== message)) merged[key] = pluralize(escapeLegacyMessage(message), id);
  }
  return merged;
}

export async function readLegacy(source: string, id: string): Promise<LegacyMessages> {
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
  const module = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`) as Record<string, Record<string, Record<string, string>>>;
  const messages = module[id];
  if (!messages || typeof messages !== "object" || Array.isArray(messages)) throw new Error(`Missing legacy ${id} export`);
  return messages;
}

function gitSource(ref: string, id: string): string {
  return execFileSync("git", ["show", `${ref}:packages/editor/src/i18n/${id}.ts`], { cwd: root, encoding: "utf8" });
}

function legacySchema(messages: LegacyMessages): Record<string, string[]> {
  return Object.fromEntries(Object.entries(messages).flatMap(([feature, entries]) => {
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) throw new Error(`Invalid legacy feature: ${feature}`);
    return Object.entries(entries).map(([key, text]) => {
      if (typeof text !== "string") throw new Error(`Invalid legacy message: ${feature}.${key}`);
      return [`${feature}.${key}`, [...new Set([...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]!))].sort()] as const;
    });
  }).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

async function importSources(sources: Record<"tr" | "en", string>, options: ImportOptions): Promise<void> {
  // Read and validate both inputs before changing any resource files.
  const tr = await readLegacy(sources.tr, "tr");
  const en = await readLegacy(sources.en, "en");
  if (JSON.stringify(legacySchema(tr)) !== JSON.stringify(legacySchema(en))) throw new Error("Legacy TR/EN key or placeholder mismatch");
  const catalogs = { tr, en };
  const baselines = options.baseRef ? {
    tr: await readLegacy(gitSource(options.baseRef, "tr"), "tr"),
    en: await readLegacy(gitSource(options.baseRef, "en"), "en"),
  } : undefined;
  for (const [id, nativeName] of languages) {
    const folder = resolve(options.localesDir ?? resolve(root, "src/i18n/locales"), id);
    mkdirSync(folder, { recursive: true });
    for (const [feature, entries] of Object.entries(catalogs[id])) {
      const target = resolve(folder, `${feature}.json`);
      const existing = existsSync(target) ? JSON.parse(readFileSync(target, "utf8")) as Record<string, string> : {};
      writeFileSync(target, JSON.stringify(mergeFeature(existing, entries, id, baselines?.[id][feature] ?? (baselines ? {} : undefined)), null, 2) + "\n");
    }
    const meta = resolve(folder, "meta.json");
    if (!existsSync(meta)) writeFileSync(meta, JSON.stringify({ id, nativeName, fallback: "tr" }, null, 2) + "\n");
  }
}

/** File inputs are read-only; unrelated resources and locale metadata are retained. */
export async function importLegacyFiles(trPath: string, enPath: string, options: ImportOptions = {}): Promise<void> {
  await importSources({ tr: readFileSync(trPath, "utf8"), en: readFileSync(enPath, "utf8") }, options);
}

export async function migrate(ref?: string, baseRef?: string): Promise<void> {
  const source = (id: string) => ref ? gitSource(ref, id) : readFileSync(resolve(root, "src/i18n", `${id}.ts`), "utf8");
  await importSources({ tr: source("tr"), en: source("en") }, baseRef ? { baseRef } : {});
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = (name: string) => {
    const index = process.argv.indexOf(name);
    if (index < 0) return undefined;
    const value = process.argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
    return value;
  };
  const filesIndex = process.argv.indexOf("--files");
  if (filesIndex >= 0) {
    const trPath = process.argv[filesIndex + 1];
    const enPath = process.argv[filesIndex + 2];
    if (!trPath || !enPath || trPath.startsWith("--") || enPath.startsWith("--")) throw new Error("Usage: pnpm i18n:import-legacy <tr.ts> <en.ts> [--base-ref <revision>]");
    const baseRef = option("--base-ref");
    await importLegacyFiles(trPath, enPath, baseRef ? { baseRef } : {});
    execFileSync(process.execPath, ["--experimental-strip-types", resolve(root, "scripts/i18n-gen.ts")], { cwd: root, stdio: "inherit" });
  } else await migrate(option("--ref"), option("--base-ref"));
}
