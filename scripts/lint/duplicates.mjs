// Runs jscpd and fails if the duplicate clone count grew past scripts/lint/duplicatesBaseline.json.
// `--update` rewrites the baseline with the current count instead of gating.
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const baselineFile = join(root, "scripts", "lint", "duplicatesBaseline.json");
const reportFile = join(root, ".jscpd-report", "jscpd-report.json");

// The report is deleted first, so a stale file from an earlier run can never be read as this run's result.
rmSync(join(root, ".jscpd-report"), { recursive: true, force: true });
const run = spawnSync("pnpm", ["exec", "jscpd", "--config", "scripts/lint/jscpd.json", "--silent", "--output", join(root, ".jscpd-report")], {
  encoding: "utf8",
  cwd: root,
  maxBuffer: 64 * 1024 * 1024,
});
if (run.status !== 0) {
  console.error(`jscpd failed (exit ${run.status ?? run.error?.message}):\n${run.stdout}${run.stderr}`);
  process.exit(1);
}
let statistics;
try {
  ({ statistics } = JSON.parse(readFileSync(reportFile, "utf8")));
} catch (error) {
  console.error(`jscpd did not produce a report: ${error.message}\n${run.stderr}`);
  process.exit(1);
}
if (!(statistics.total.sources > 0)) {
  console.error("jscpd scanned 0 files: check the paths in scripts/lint/jscpd.json.");
  process.exit(1);
}

const count = statistics.total.clones;

if (process.argv.includes("--update")) {
  writeFileSync(baselineFile, `${JSON.stringify({ count }, null, 2)}\n`);
  console.log(`jscpd baseline written: ${count} duplicate blocks`);
  process.exit(0);
}

const { count: baseline } = JSON.parse(readFileSync(baselineFile, "utf8"));
const grew = count > baseline;
console.log(
  `jscpd: ${count} duplicate blocks (baseline ${baseline}, ${statistics.total.duplicatedLines} duplicated lines). List: pnpm exec jscpd --config scripts/lint/jscpd.json --reporters console`,
);
if (grew) {
  console.error(`jscpd clones grew from ${baseline} to ${count}. Fix them, or run pnpm jscpd:update-baseline if the growth is deliberate.`);
}
process.exit(grew ? 1 : 0);
