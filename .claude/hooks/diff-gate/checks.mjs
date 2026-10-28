// The four diff checks. Each takes a context { root, toolsRoot, base, head, diff, skippedUntracked? } and resolves to { violations, skipped?, error?, ms }.
// A check never throws: tool crashes come back as `error`, a missing tool or script as `skipped`.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { configReferences, describeExport, ruleClass } from "./annotate.mjs";
import { isAdded, overlapsAdded, showAt } from "./git-diff.mjs";

const TOOL_TIMEOUT_MS = Number(process.env.DIFF_GATE_TOOL_TIMEOUT_MS ?? 90_000);

export function run(command, args, { cwd, timeoutMs = TOOL_TIMEOUT_MS } = {}) {
  return new Promise((done) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "1", FORCE_COLOR: "0" } });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      done({ code: null, stdout, stderr, timedOut, error: error.message });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      done({ code, signal, stdout, stderr, timedOut, error: timedOut ? "timed out" : undefined });
    });
  });
}

async function timed(fn) {
  const start = Date.now();
  try {
    const result = await fn();
    return { violations: [], ...result, ms: Date.now() - start };
  } catch (error) {
    return { violations: [], error: String(error?.message ?? error), ms: Date.now() - start };
  }
}

const FORBIDDEN_PATH = [
  [/^\.claude\//, "agent hooks and settings"],
  [/^scripts\/lint\//, "lint scripts and baselines"],
  [/(^|\/)tsconfig[^/]*\.json$/, "tsconfig"],
  [/(^|\/)eslint\.config\.[cm]?[jt]s$|(^|\/)\.eslintrc[^/]*$/, "eslint config"],
  [/(^|\/)(\.?knip(\.config)?\.[^/]+|\.?jscpd\.json|\.jscpd\.[^/]+)$/, "knip or jscpd config"],
  [/(^|\/)\.?dependency-?[cC]ruiser\.[^/]+$/, "dependency-cruiser config"],
];

function scriptsOf(text) {
  try {
    return JSON.stringify(JSON.parse(text).scripts ?? {});
  } catch {
    return null;
  }
}

export function forbiddenCheck(ctx) {
  return timed(async () => {
    const violations = [];
    for (const [rel, entry] of ctx.diff) {
      const hit = FORBIDDEN_PATH.find(([pattern]) => pattern.test(rel));
      if (hit) {
        violations.push({
          kind: "forbidden-path",
          file: rel,
          message: `${entry.status === "A" ? "adds" : entry.status === "D" ? "deletes" : "modifies"} ${hit[1]}, which agents must not change`,
          fix: "revert it; do not edit lint, hook or tooling config",
        });
      }
      if (basename(rel) === "package.json" && entry.status === "M") {
        const before = showAt(ctx.root, ctx.base, rel);
        const after = ctx.head ? showAt(ctx.root, ctx.head, rel) : readFileSync(join(ctx.root, rel), "utf8");
        if (before !== null && after !== null && scriptsOf(before) !== scriptsOf(after)) {
          violations.push({
            kind: "forbidden-script",
            file: rel,
            message: 'changes the package.json "scripts" section',
            fix: "revert the scripts change; scripts are owned by the maintainers",
          });
        }
      }
    }
    return { violations };
  });
}

const KNIP_LINE_KINDS = ["exports", "types", "nsExports", "nsTypes", "enumMembers", "namespaceMembers"];
const KNIP_INCLUDE = ["files", ...KNIP_LINE_KINDS, "duplicates"].join(",");

// knip reports the whole repo (it is fast, under 2 s here); only issues on lines or files the diff added are kept.
export function knipCheck(ctx) {
  return timed(async () => {
    const bin = join(ctx.toolsRoot, "node_modules/.bin/knip");
    const config = join(ctx.root, "scripts/lint/knip.json");
    if (!existsSync(bin)) return { skipped: "knip binary not found" };
    if (!existsSync(config)) return { skipped: "scripts/lint/knip.json not found" };
    const result = await run(bin, ["--config", "scripts/lint/knip.json", "--reporter", "json", "--no-progress", "--no-config-hints", "--include", KNIP_INCLUDE], { cwd: ctx.root });
    let report;
    try {
      report = JSON.parse(result.stdout);
    } catch {
      return { error: `knip produced no JSON (${result.error ?? `exit ${result.code}`}): ${result.stderr.slice(0, 300)}` };
    }
    const violations = [];
    for (const issue of report.issues ?? []) {
      const file = issue.file;
      const entry = ctx.diff.get(file);
      if (!entry || entry.status === "D") continue;
      if ((issue.files ?? []).length > 0 && entry.status === "A") {
        violations.push({ kind: "unused-file", file, line: 1, message: "new file is not imported by anything reachable", fix: "delete the file or import it from code that is used" });
      }
      for (const group of KNIP_LINE_KINDS) {
        for (const item of issue[group] ?? []) {
          if (isAdded(ctx.diff, file, item.line)) {
            violations.push({ kind: "unused-export", file, line: item.line, symbol: item.name, annotation: { group }, message: `unused ${group === "enumMembers" ? "enum member" : "export"} '${item.name}'`, fix: "delete the unused export or use it" });
          }
        }
      }
      for (const item of issue.duplicates ?? []) {
        const names = Array.isArray(item) ? item.map((part) => part.name).join(" / ") : (item.name ?? "?");
        const line = Array.isArray(item) ? item[0]?.line : item.line;
        if (line === undefined || isAdded(ctx.diff, file, line)) {
          violations.push({ kind: "unused-export", file, line, message: `duplicate export ${names}`, fix: "export it under one name only" });
        }
      }
    }
    await Promise.all(violations.map((violation) => annotateKnip(ctx.root, violation)));
    return { violations };
  });
}

// Adds the facts the policies decide on: `annotation` = { kind, localRefs, ... } for unused exports, { configRefs, configFiles } for unused files.
async function annotateKnip(root, violation) {
  if (violation.kind === "unused-file") {
    const files = await configReferences(root, violation.file);
    violation.annotation = { configRefs: files.length, configFiles: files };
  } else if (violation.kind === "unused-export" && violation.symbol !== undefined && violation.line !== undefined) {
    const info = describeExport(root, violation.file, violation.line, violation.symbol);
    const group = violation.annotation?.group;
    violation.annotation = { kind: info.declKind ?? (group === "enumMembers" ? "enumMember" : null), localRefs: info.selfRefs ?? 0, simpleDecl: info.simpleDecl ?? false, barrel: info.barrel ?? false, reexport: info.reexport ?? false, listExport: info.listExport ?? false };
  }
}

export function jscpdCheck(ctx) {
  return timed(async () => {
    const bin = join(ctx.toolsRoot, "node_modules/.bin/jscpd");
    const configPath = join(ctx.root, "scripts/lint/jscpd.json");
    if (!existsSync(bin)) return { skipped: "jscpd binary not found" };
    if (!existsSync(configPath)) return { skipped: "scripts/lint/jscpd.json not found" };
    // jscpd resolves `path` entries against the config file's folder, so write a copy with absolute paths and a private output folder.
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    const out = mkdtempSync(join(tmpdir(), "diff-gate-jscpd-"));
    try {
      delete config.$schema;
      // Entries are relative to the config folder (current labshelf) or to the repo root (older configs): take whichever exists.
      config.path = (config.path ?? []).map((p) => [resolve(dirname(configPath), p), resolve(ctx.root, p)].find(existsSync)).filter(Boolean);
      config.output = out;
      config.reporters = ["json"];
      config.absolute = true;
      if (config.path.length === 0) return { skipped: "no jscpd source folders" };
      const tmpConfig = join(out, "config.json");
      writeFileSync(tmpConfig, JSON.stringify(config));
      const result = await run(bin, ["--config", tmpConfig, "--silent"], { cwd: ctx.root });
      let report;
      try {
        report = JSON.parse(readFileSync(join(out, "jscpd-report.json"), "utf8"));
      } catch {
        return { error: `jscpd produced no report (${result.error ?? `exit ${result.code}`}): ${(result.stderr || result.stdout).slice(0, 300)}` };
      }
      const rel = (name) => relative(ctx.root, name);
      const violations = [];
      for (const clone of report.duplicates ?? []) {
        const a = { file: rel(clone.firstFile.name), start: clone.firstFile.start, end: clone.firstFile.end };
        const b = { file: rel(clone.secondFile.name), start: clone.secondFile.start, end: clone.secondFile.end };
        const touched = [[a, b], [b, a]].filter(([mine]) => overlapsAdded(ctx.diff, mine.file, mine.start, mine.end));
        if (touched.length === 0) continue;
        const [mine, other] = touched[0];
        violations.push({
          kind: "clone",
          file: mine.file,
          line: mine.start,
          endLine: mine.end,
          message: `${clone.lines} duplicated lines, same code at ${other.file}:${other.start}-${other.end}`,
          fix: "extract the shared code into one function and call it from both places",
        });
      }
      return { violations };
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
}

// sourceRules prints one problem per stderr line (a few add indented or numbered continuation lines).
export function parseRuleProblems(stderr) {
  const problems = [];
  for (const line of stderr.split("\n")) {
    if (/^[\w@./+-]+\.(ts|tsx|css|mjs|cjs|js|json|md)\b/.test(line)) problems.push(line);
    else if (problems.length > 0 && line.trim() !== "") problems[problems.length - 1] += ` | ${line.trim()}`;
  }
  return problems;
}

export function rulesCheck(ctx) {
  return timed(async () => {
    const script = join(ctx.root, "scripts/lint/sourceRules.mjs");
    if (!existsSync(script)) return { skipped: "scripts/lint/sourceRules.mjs not found" };
    const result = await run(process.execPath, [script, "--base", ctx.base], { cwd: ctx.root });
    if (result.error || (result.code !== 0 && result.code !== 1) || /^\s+at .*:\d+:\d+\)?$/m.test(result.stderr) || /not inside a git repository/.test(result.stderr)) {
      return { error: `sourceRules crashed (${result.error ?? `exit ${result.code}`}): ${result.stderr.slice(0, 300)}` };
    }
    // sourceRules lists every untracked file itself: the ones that were already there at session start are not the session's.
    const violations = parseRuleProblems(result.stderr)
      .map((text) => {
        const file = text.match(/^[^\s:]+/)[0];
        const message = text.slice(file.length).replace(/^[:\s]+/, "");
        return { kind: "source-rule", file, message, annotation: { ruleClass: ruleClass(message) }, fix: "see the rule text" };
      })
      .filter((violation) => !ctx.skippedUntracked?.has(violation.file));
    return { violations };
  });
}

export const CHECKS = { forbidden: forbiddenCheck, knip: knipCheck, jscpd: jscpdCheck, rules: rulesCheck };
