/** Result files and summaries of the perf harness. */

export interface Metric {
  value: number;
  unit: string;
}

export interface Results {
  label: string;
  date: string;
  metrics: Record<string, Metric>;
  /** Top self-time functions per profiled phase (PERF_PROFILE=1). */
  profiles: Record<string, string[]>;
}

export function percentile(values: readonly number[], p: number): number {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return NaN;
  const i = Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1));
  return v[i]!;
}

export function median(values: readonly number[]): number {
  return percentile(values, 50);
}

/** Markdown table: metric | baseline | this run | change. */
export function formatTable(now: Results, base: Results | null): string {
  const rows = ["| metric | baseline | " + now.label + " | change |", "|---|---:|---:|---:|"];
  for (const [key, m] of Object.entries(now.metrics)) {
    const b = base?.metrics[key];
    const change = b && b.value !== 0 ? `${(((m.value - b.value) / b.value) * 100).toFixed(0)}%` : "";
    rows.push(`| ${key} | ${b ? `${b.value} ${b.unit}` : "–"} | ${m.value} ${m.unit} | ${change} |`);
  }
  return rows.join("\n");
}

interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number };
  children?: number[];
}

interface CpuProfile {
  nodes: ProfileNode[];
  samples?: number[];
  timeDeltas?: number[];
}

/** The `top` functions by self time ("12.3 ms  name  file:line"). */
export function summarizeProfile(profile: CpuProfile, top: number): string[] {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map<string, number>();
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  for (let i = 0; i < samples.length; i++) {
    const node = byId.get(samples[i]!);
    if (!node) continue;
    const f = node.callFrame;
    const file = f.url.slice(f.url.lastIndexOf("/") + 1);
    const key = `${f.functionName || "(anonymous)"}  ${file}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + (deltas[i] ?? 0) / 1000);
  }
  return [...self]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([k, ms]) => `${ms.toFixed(1).padStart(8)} ms  ${k}`);
}
