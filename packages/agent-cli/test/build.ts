import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

/** Exercise the packaged stdio entry on clean checkouts as well as after pnpm build. */
export default async function buildCli() {
  const require = createRequire(import.meta.url);
  await promisify(execFile)(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", "tsconfig.json"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)), timeout: 120000,
  });
}
