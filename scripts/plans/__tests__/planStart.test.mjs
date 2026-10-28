import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { loadSession, saveSession } from "../planFiles.mjs";
import { planNew } from "../planNew.mjs";
import { planStart } from "../planStart.mjs";

const cli = fileURLToPath(new URL("../plan.mjs", import.meta.url));
const HIDDEN = "documents/plans/demo/tests/1.1/scripts/x/__tests__/lib.test.mjs";
const TEST_SOURCE = 'import { add } from "../lib.mjs";\n';
const write = (root, rel, text) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};

const setup = () => {
  const root = mkdtempSync(join(tmpdir(), "plan-start-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  const dir = planNew(root, { slug: "demo", level: "N2" });
  saveSession(dir, {
    ...loadSession(dir, "1"),
    packages: [
      {
        id: "1.1",
        plan: "demo",
        goal: "g",
        level: "behaviour",
        runner: { agent: "implementer", model: "opus" },
        edit: [],
        seams: [
          { path: "scripts/x/lib.mjs", signature: "export function add(a, b)" },
          { path: "scripts/x/lib.mjs", signature: "export function sub(a, b)" },
        ],
        acceptance: [{ id: "A1", check: "c" }],
        tests: { hidden: [HIDDEN], command: "node scripts/agents/run.mjs test tooling --spec 1.1 -- scripts/x/__tests__/lib.test.mjs" },
      },
    ],
  });
  write(root, HIDDEN, TEST_SOURCE);
  write(root, "scripts/x/lib.mjs", "export function add(a, b) {\n  return a + b;\n}\n");
  return { root, dir };
};

let spool;
beforeEach(() => {
  spool = mkdtempSync(join(tmpdir(), "plan-start-spool-"));
  process.env.LABSHELF_TELEMETRY_SPOOL = spool;
});
afterEach(() => {
  delete process.env.LABSHELF_TELEMETRY_SPOOL;
});

const events = () => readdirSync(spool).flatMap((f) => readFileSync(join(spool, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));

describe("planStart", () => {
  it("copies the hidden tests into place and stubs only the missing seams", () => {
    const { root, dir } = setup();
    const result = planStart(root, { planDir: dir, sessionId: "1", specId: "1.1" });
    assert.deepEqual(result, { copied: ["scripts/x/__tests__/lib.test.mjs"], created: [], appended: ["scripts/x/lib.mjs"] });
    assert.equal(readFileSync(join(root, "scripts/x/__tests__/lib.test.mjs"), "utf8"), TEST_SOURCE);
    const lib = readFileSync(join(root, "scripts/x/lib.mjs"), "utf8");
    assert.ok(lib.startsWith("export function add(a, b) {\n  return a + b;\n}\n"));
    assert.match(lib, /export function sub\(a, b\) \{ throw new Error\("not implemented: 1\.1"\); \}/);
  });

  it("emits package_started with level and model", () => {
    const { root, dir } = setup();
    planStart(root, { planDir: dir, sessionId: "1", specId: "1.1" });
    const [event] = events().filter((e) => e.kind === "package_started");
    assert.equal(event.level, "behaviour");
    assert.equal(event.model, "opus");
    assert.equal(event.spec, "1.1");
    assert.equal(event.plan, "demo");
  });

  it("fails before writing anything when a hidden test is missing", () => {
    const { root, dir } = setup();
    execFileSync("rm", [join(root, HIDDEN)]);
    assert.throws(() => planStart(root, { planDir: dir, sessionId: "1", specId: "1.1" }), /does not exist/);
    assert.equal(readFileSync(join(root, "scripts/x/lib.mjs"), "utf8").includes("sub"), false);
  });

  it("is reachable as plan.mjs start", () => {
    const { root } = setup();
    const result = spawnSync("node", [cli, "start", "1", "1.1"], { cwd: root, encoding: "utf8", env: { ...process.env, LABSHELF_TELEMETRY_SPOOL: spool } });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /scripts\/x\/__tests__\/lib\.test\.mjs/);
    assert.equal(events().filter((e) => e.kind === "package_started").length, 1);
  });
});
