// Compiles core once per runtime (neutral, node, dom) and fails on any error, so neutral code
// uses no Node or DOM API. Run from packages/core.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

function hasRuntimeFolder(dir, name) {
  return readdirSync(dir, { withFileTypes: true }).some(
    (entry) => entry.isDirectory() && (entry.name === name || hasRuntimeFolder(join(dir, entry.name), name)),
  );
}

// The node and dom configs add nothing over the neutral one until a node/ or dom/ folder exists.
const configs = ["neutral", "node", "dom"].filter((name) => name === "neutral" || hasRuntimeFolder("src", name));

let failed = false;
for (const name of configs) {
  const run = spawnSync("pnpm", ["exec", "tsc", "-p", `tsconfig.${name}.json`], { encoding: "utf8" });
  const output = `${run.stdout}${run.stderr}`;
  const errors = output.split("\n").filter((line) => line.includes("error TS")).length;
  if (errors > 0 || run.status !== 0) {
    process.stdout.write(output);
    failed = true;
  }
  console.log(`runtime ${name}: ${errors} errors`);
}
process.exit(failed ? 1 : 0);
