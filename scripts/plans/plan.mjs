#!/usr/bin/env node
// Plan CLI: `node scripts/plans/plan.mjs <cmd> …`. Parses arguments and calls one module per command; no logic here.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePlanDir } from "./planFiles.mjs";
import { planClose } from "./planClose.mjs";
import { planFromBrief } from "./planFromBrief.mjs";
import { planLint } from "./planLint.mjs";
import { planNew } from "./planNew.mjs";
import { planPrompt } from "./planPrompt.mjs";
import { planRed, restoreRed } from "./planRed.mjs";
import { planStale } from "./planStale.mjs";
import { planStart } from "./planStart.mjs";
import { planStubs } from "./planStubs.mjs";
import { planTests } from "./planTests.mjs";

// A command is (ctx) => exit code | void, with ctx = { root, positional, flags, out(line) }.
// To add a command: import its module and add one entry here.
export const COMMANDS = {
  new: ({ root, positional: [slug], flags, out }) => {
    const dir = planNew(root, { slug, level: flags.level, title: flags.title });
    out(`created ${dir}`);
  },
  lint: ({ root, positional: [dir], out }) => {
    if (!dir) throw new Error("plan lint: <dir> is required");
    const problems = planLint(root, resolve(dir));
    problems.forEach(out);
    return problems.length > 0 ? 1 : 0;
  },
  "from-brief": ({ root, positional: [brief], flags, out }) => {
    if (!brief) throw new Error("plan from-brief: <brief.yaml> is required");
    const briefFile = resolve(brief);
    const planDir = resolvePlanDir(root, { plan: flags.plan, near: briefFile });
    const spec = planFromBrief(root, { briefFile, specId: flags.spec, sessionId: flags.session, planDir });
    out(`spec ${spec.id} written to ${planDir}`);
  },
  prompt: ({ root, positional: [sessionId, specId], flags, out }) => {
    if (!sessionId || !specId) throw new Error("plan prompt: <session> <id> are required");
    out(planPrompt(root, { planDir: resolvePlanDir(root, { plan: flags.plan }), sessionId, specId }));
  },
  close: ({ root, positional: [sessionId], flags, out }) => {
    if (!sessionId) throw new Error("plan close: <session> is required");
    const { status, commits } = planClose(root, { planDir: resolvePlanDir(root, { plan: flags.plan }), sessionId });
    out(`session ${sessionId} ${status}: ${commits.length} commit(s)`);
  },
  stubs: ({ root, positional: [sessionId, specId], flags, out }) => {
    if (!sessionId || !specId) throw new Error("plan stubs: <session> <id> are required");
    const { created, appended } = planStubs(root, { planDir: resolvePlanDir(root, { plan: flags.plan }), sessionId, specId });
    created.forEach((path) => out(`created ${path}`));
    appended.forEach((path) => out(`appended ${path}`));
  },
  tests: ({ root, positional: [sessionId, specId], flags, out }) => {
    if (!sessionId || !specId) throw new Error("plan tests: <session> <id> are required");
    out(`created ${planTests(root, { planDir: resolvePlanDir(root, { plan: flags.plan }), sessionId, specId })}`);
  },
  red: ({ root, positional: [sessionId, specId], flags, out }) => {
    if (flags.restore) {
      restoreRed(root).forEach((path) => out(`restored ${path}`));
      return 0;
    }
    if (!sessionId || !specId) throw new Error("plan red: <session> <id> are required (or --restore)");
    const { ok, problems, total } = planRed(root, { planDir: resolvePlanDir(root, { plan: flags.plan }), sessionId, specId });
    problems.forEach(out);
    out(ok ? `red: ${total} tests, all fail with "not implemented"` : "red: rejected");
    return ok ? 0 : 1;
  },
  start: ({ root, positional: [sessionId, specId], flags, out }) => {
    if (!sessionId || !specId) throw new Error("plan start: <session> <id> are required");
    const { copied, created, appended } = planStart(root, { planDir: resolvePlanDir(root, { plan: flags.plan }), sessionId, specId });
    copied.forEach((path) => out(`test ${path}`));
    created.forEach((path) => out(`created ${path}`));
    appended.forEach((path) => out(`appended ${path}`));
  },
  stale: ({ root, positional: [sessionId, specId], flags, out }) => {
    if (!sessionId || !specId) throw new Error("plan stale: <session> <id> are required");
    const changed = planStale(root, { planDir: resolvePlanDir(root, { plan: flags.plan }), sessionId, specId });
    changed.forEach(out);
    return changed.length > 0 ? 1 : 0;
  },
};

/** Splits argv into positional arguments and `--name value` flags (`--name` alone is `true`). */
export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) positional.push(argv[i]);
    else if (argv[i + 1] === undefined || argv[i + 1].startsWith("--")) flags[argv[i].slice(2)] = true;
    else flags[argv[i].slice(2)] = argv[++i];
  }
  return { positional, flags };
}

const repoRoot = () => execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

function main(argv) {
  const [cmd, ...rest] = argv;
  const command = Object.hasOwn(COMMANDS, cmd ?? "") ? COMMANDS[cmd] : null;
  if (!command) throw new Error(`plan: unknown command ${cmd ?? "(none)"} (expected one of ${Object.keys(COMMANDS).join(", ")})`);
  const { positional, flags } = parseArgs(rest);
  return command({ root: repoRoot(), positional, flags, out: (line) => console.log(line) }) ?? 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
