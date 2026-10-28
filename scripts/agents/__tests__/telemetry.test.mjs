import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { emit } from "../telemetry.mjs";

const script = fileURLToPath(new URL("../telemetry.mjs", import.meta.url));
let dir;
const saved = { ...process.env };

const readLines = () =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "telemetry-"));
  process.env.LABSHELF_TELEMETRY_SPOOL = dir;
  delete process.env.LABSHELF_TELEMETRY;
  process.env.LABSHELF_PLAN_RUN_ID = "run-1";
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});

describe("emit", () => {
  it("appends one JSON line to <spool>/<date>.jsonl", () => {
    emit("run_started", { options: "x" });
    emit("commit", { hash: "abc" });
    const files = readdirSync(dir);
    assert.equal(files.length, 1);
    assert.match(files[0], /^\d{4}-\d{2}-\d{2}\.jsonl$/);
    const lines = readLines().map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => l.kind), ["run_started", "commit"]);
  });

  it("merges fields with the standard fields", () => {
    emit("test_run", { failing: 2, attempt: 1, session: "s3" });
    const [line] = readLines().map((l) => JSON.parse(l));
    for (const key of ["ts", "kind", "run_id", "plan", "session", "spec", "agent_type", "session_id", "cwd"]) assert.ok(key in line, key);
    assert.equal(line.run_id, "run-1");
    assert.equal(line.failing, 2);
    assert.equal(line.session, "s3");
    assert.equal(line.cwd, process.cwd());
    assert.ok(!Number.isNaN(Date.parse(line.ts)));
  });

  it("creates a missing spool directory", () => {
    process.env.LABSHELF_TELEMETRY_SPOOL = join(dir, "a", "b");
    emit("commit", {});
    assert.equal(readdirSync(join(dir, "a", "b")).length, 1);
  });

  it("does not throw when the spool is unwritable", () => {
    const blocker = join(dir, "file");
    writeFileSync(blocker, "x");
    process.env.LABSHELF_TELEMETRY_SPOOL = join(blocker, "sub");
    assert.doesNotThrow(() => emit("commit", {}));
  });

  it("writes nothing when LABSHELF_TELEMETRY=off", () => {
    process.env.LABSHELF_TELEMETRY = "off";
    emit("commit", {});
    assert.deepEqual(readdirSync(dir), []);
  });

  it("caps an oversize line at 4096 bytes and keeps it valid JSON", () => {
    emit("handoff_invalid", { blocks: "x".repeat(50_000), errors: 3 });
    const [raw] = readLines();
    assert.ok(Buffer.byteLength(raw) <= 4096);
    const line = JSON.parse(raw);
    assert.equal(line.kind, "handoff_invalid");
    assert.equal(line.errors, 3);
  });

  it("caps a line made of many medium fields", () => {
    const fields = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`f${i}`, "y".repeat(500)]));
    emit("commit", fields);
    const [raw] = readLines();
    assert.ok(Buffer.byteLength(raw) <= 4096);
    JSON.parse(raw);
  });
});

describe("CLI", () => {
  it("emits <kind> '<json>' and exits 0", () => {
    const result = spawnSync("node", [script, "spec_deny", '{"tool":"Edit","target":"a.ts"}'], { env: process.env });
    assert.equal(result.status, 0);
    const [line] = readLines().map((l) => JSON.parse(l));
    assert.equal(line.kind, "spec_deny");
    assert.equal(line.tool, "Edit");
  });

  it("exits 0 on invalid JSON and with no arguments", () => {
    assert.equal(spawnSync("node", [script, "commit", "{nope"], { env: process.env }).status, 0);
    assert.equal(spawnSync("node", [script], { env: process.env }).status, 0);
    assert.equal(existsSync(dir), true);
  });
});
