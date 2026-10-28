#!/usr/bin/env node
// Appends one JSON event line to the plan-telemetry spool; never throws. CLI: telemetry.mjs <kind> '<json>'.
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_LINE_BYTES = 4096;
const MIN_TRUNCATE = 64;
const PROTECTED = new Set(["ts", "kind"]);

const spoolDir = () => process.env.LABSHELF_TELEMETRY_SPOOL || join(homedir(), "Developer", "pessoal", "agent-telemetry", "data", "plan-events");

// Standard fields come from the environment the runner sets; explicit fields override them.
function standardFields(kind) {
  const env = process.env;
  return {
    ts: new Date().toISOString(),
    kind,
    run_id: env.LABSHELF_PLAN_RUN_ID ?? null,
    plan: env.LABSHELF_PLAN ?? null,
    session: env.LABSHELF_PLAN_SESSION ?? null,
    spec: env.LABSHELF_SPEC ?? null,
    agent_type: env.LABSHELF_AGENT_TYPE ?? null,
    session_id: env.CLAUDE_SESSION_ID ?? null,
    cwd: process.cwd(),
  };
}

const byteLength = (value) => Buffer.byteLength(JSON.stringify(value));

// Shrinks the largest field (halving strings, dropping anything else) until the line fits the cap.
function capLine(event) {
  if (byteLength(event) + 1 <= MAX_LINE_BYTES) return event;
  const capped = { ...event, truncated: true };
  while (byteLength(capped) + 1 > MAX_LINE_BYTES) {
    let largest = null;
    let largestSize = 0;
    for (const [key, value] of Object.entries(capped)) {
      if (PROTECTED.has(key) || key === "truncated") continue;
      const size = byteLength(value);
      if (size > largestSize) [largest, largestSize] = [key, size];
    }
    if (largest === null) break;
    const value = capped[largest];
    if (typeof value === "string" && value.length > MIN_TRUNCATE * 2) capped[largest] = value.slice(0, Math.floor(value.length / 2));
    else delete capped[largest];
  }
  return capped;
}

/** Appends `{ts, kind, run_id, plan, …fields}` to `<spool>/<YYYY-MM-DD>.jsonl`. Never throws. */
export function emit(kind, fields = {}) {
  try {
    if (process.env.LABSHELF_TELEMETRY === "off") return;
    const event = capLine({ ...standardFields(kind), ...(fields && typeof fields === "object" ? fields : {}), kind });
    const dir = spoolDir();
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, `${event.ts.slice(0, 10)}.jsonl`), `${JSON.stringify(event)}\n`);
  } catch (error) {
    process.stderr.write(`telemetry: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

function main(argv) {
  const [kind, json] = argv;
  if (!kind) return;
  let fields = {};
  if (json) {
    try {
      fields = JSON.parse(json);
    } catch {
      process.stderr.write("telemetry: fields argument is not valid JSON, emitting without them\n");
    }
  }
  emit(kind, fields);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
  process.exitCode = 0;
}
