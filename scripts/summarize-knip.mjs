// Runs knip and fails if the finding count grew past scripts/knip-baseline.json.
// `--update` rewrites the baseline with the current count instead of gating.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baselineFile = join(root, "scripts", "knip-baseline.json");

const run = spawnSync("pnpm", ["exec", "knip", "--no-exit-code", "--reporter", "json"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
let issues;
try {
  ({ issues } = JSON.parse(run.stdout));
} catch (error) {
  console.error(`knip did not produce a report: ${error.message}\n${run.stderr}`);
  process.exit(1);
}

const totals = {};
for (const issue of issues) {
  for (const [category, findings] of Object.entries(issue)) {
    if (Array.isArray(findings) && findings.length > 0) totals[category] = (totals[category] ?? 0) + findings.length;
  }
}
const count = Object.values(totals).reduce((a, b) => a + b, 0);
const detail = Object.entries(totals).map(([category, n]) => `${category} ${n}`).join(", ");

if (process.argv.includes("--update")) {
  writeFileSync(baselineFile, `${JSON.stringify({ count }, null, 2)}\n`);
  console.log(`knip baseline written: ${count} findings`);
  process.exit(0);
}

const { count: baseline } = JSON.parse(readFileSync(baselineFile, "utf8"));
const grew = count > baseline;
console.log(`knip: ${count} findings (baseline ${baseline})${detail ? `: ${detail}` : ""}. List: pnpm exec knip`);
if (grew) {
  console.error(`knip findings grew from ${baseline} to ${count}. Fix them, or run pnpm knip:update-baseline if the growth is deliberate.`);
}
process.exit(grew ? 1 : 0);
