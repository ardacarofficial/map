/**
 * (h) Linux desktop cold start: process spawn → "window shown" in the app
 * log (Rust logs it when the hidden window is shown, see
 * `src-tauri/src/lib.rs`), welcome screen vs. a project from argv.
 *
 * Needs a release build (`pnpm desktop:build`, or `pnpm --filter
 * @smap/desktop tauri build --no-bundle`) and Xvfb. Skipped otherwise.
 * `PERF_DESKTOP_BIN` overrides the binary.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { test } from "@playwright/test";

import { generateBigProject, type ProjectFiles } from "./bigProject";
import { formatTable, median, type Results } from "./report";

const RESULTS = fileURLToPath(new URL("./results/", import.meta.url));
const LABEL = process.env.PERF_LABEL ?? "latest";
const RUNS = Number(process.env.PERF_RUNS ?? 5);
const BIN =
  process.env.PERF_DESKTOP_BIN ??
  fileURLToPath(new URL("../../packages/desktop/src-tauri/target/release/harita-tasarlayici", import.meta.url));
const DISPLAY = ":97";

function writeProject(dir: string, project: ProjectFiles): string {
  rmSync(dir, { recursive: true, force: true });
  for (const [path, content] of project.files) {
    mkdirSync(dirname(`${dir}/${path}`), { recursive: true });
    writeFileSync(`${dir}/${path}`, content);
  }
  return `${dir}/project.smap`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Start {
  shown: number;
  ready: number;
  why: string;
  marks: string;
}

/** One cold start; returns ms from spawn to "window shown". */
async function coldStart(home: string, args: string[]): Promise<Start> {
  const log = `${home}/.local/share/com.smap.haritatasarlayici/logs/harita.log`;
  rmSync(log, { force: true });
  const env = { ...process.env, HOME: home, XDG_DATA_HOME: `${home}/.local/share`, XDG_CONFIG_HOME: `${home}/.config`, DISPLAY };
  const t0 = Date.now();
  const child: ChildProcess = spawn(BIN, args, { env, stdio: "ignore" });
  try {
    for (let waited = 0; waited < 15_000; waited += 20) {
      await sleep(20);
      const text = existsSync(log) ? readFileSync(log, "utf8") : "";
      const shown = /^(\S+) INFO\s+\S+: window shown \(([^)]+)\)/m.exec(text);
      if (!shown) continue;
      const ready = /startup ms: (.*)$/m.exec(text);
      const readyAt = /^(\S+) INFO\s+frontend: startup ms/m.exec(text);
      return {
        shown: Date.parse(shown[1]!) - t0,
        ready: readyAt ? Date.parse(readyAt[1]!) - t0 : NaN,
        why: shown[2]!,
        marks: ready?.[1] ?? "",
      };
    }
    throw new Error(`window not shown; log:\n${existsSync(log) ? readFileSync(log, "utf8") : "(none)"}`);
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => child.once("exit", r));
  }
}

test("desktop cold start", async () => {
  test.skip(!existsSync(BIN), `no desktop release build at ${BIN}`);
  test.skip(spawnSync("which", ["Xvfb"]).status !== 0, "no Xvfb");
  const work = `${RESULTS}desktop-work`;
  const home = `${work}/home`;
  mkdirSync(home, { recursive: true });
  const small = writeProject(`${work}/small`, generateBigProject(64, 2));
  const big = writeProject(`${work}/big`, generateBigProject());
  const xvfb = spawn("Xvfb", [DISPLAY, "-screen", "0", "1920x1080x24", "-nolisten", "tcp"], { stdio: "ignore" });
  await sleep(800);
  const results: Results = { label: LABEL, date: new Date().toISOString(), metrics: {}, profiles: {} };
  try {
    await coldStart(home, []); // first run: creates settings / caches, not counted
    for (const [name, args] of [
      ["welcome", []],
      ["project 64² from argv", [small]],
      ["project 1024² from argv", [big]],
    ] as const) {
      const runs: Start[] = [];
      for (let i = 0; i < RUNS; i++) runs.push(await coldStart(home, [...args]));
      const key = `h.desktop ${name} → window shown`;
      results.metrics[key] = { value: median(runs.map((r) => r.shown)), unit: "ms" };
      results.metrics[`h.desktop ${name} → frontend ready log`] = { value: median(runs.map((r) => r.ready)), unit: "ms" };
      console.log(`${key}: ${runs.map((r) => `${r.shown} (${r.why})`).join(", ")}\n  marks: ${runs.at(-1)!.marks}`);
    }
  } finally {
    xvfb.kill();
  }
  writeFileSync(`${RESULTS}${LABEL}-desktop.json`, `${JSON.stringify(results, null, 2)}\n`);
  let base: Results | null = null;
  try {
    base = JSON.parse(readFileSync(`${RESULTS}baseline-desktop.json`, "utf8")) as Results;
  } catch {
    // no baseline yet
  }
  console.log(`\n${formatTable(results, base)}`);
});
