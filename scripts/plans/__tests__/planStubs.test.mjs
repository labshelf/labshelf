import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { loadSession, saveSession } from "../planFiles.mjs";
import { planNew } from "../planNew.mjs";
import { planStubs } from "../planStubs.mjs";
import { planTests } from "../planTests.mjs";

const cli = fileURLToPath(new URL("../plan.mjs", import.meta.url));
const write = (root, rel, text) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};

const spec = (extra) => ({
  id: "1.1",
  plan: "demo",
  goal: "adds numbers",
  level: "behaviour",
  runner: { agent: "implementer", model: "sonnet" },
  edit: [],
  acceptance: [
    { id: "A1", check: "adds two numbers" },
    { id: "A2", check: 'handles "quotes"' },
  ],
  tests: { hidden: ["documents/plans/demo/tests/1.1/scripts/x/__tests__/lib.test.mjs"], command: "node scripts/agents/run.mjs test tooling --spec 1.1 -- scripts/x/__tests__/lib.test.mjs" },
  ...extra,
});

const setup = (extra) => {
  const root = mkdtempSync(join(tmpdir(), "plan-stubs-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  const dir = planNew(root, { slug: "demo", level: "N2" });
  saveSession(dir, { ...loadSession(dir, "1"), packages: [spec(extra)] });
  return { root, dir };
};
const args = (dir) => ({ planDir: dir, sessionId: "1", specId: "1.1" });

describe("planStubs", () => {
  it("creates the file with a throwing stub per seam, keeping async and class forms", async () => {
    const { root, dir } = setup({
      seams: [
        { path: "scripts/x/lib.mjs", signature: "export function add(a, b)" },
        { path: "scripts/x/lib.mjs", signature: "export async function load(path)" },
        { path: "scripts/x/lib.mjs", signature: "export class Box" },
      ],
    });
    assert.deepEqual(planStubs(root, args(dir)), { created: ["scripts/x/lib.mjs"], appended: [] });
    const source = readFileSync(join(root, "scripts/x/lib.mjs"), "utf8");
    assert.match(source, /export function add\(a, b\) \{ throw new Error\("not implemented: 1\.1"\); \}/);
    assert.match(source, /export async function load\(path\) \{ throw new Error\("not implemented: 1\.1"\); \}/);
    assert.match(source, /export class Box \{/);
    const lib = await import(`${join(root, "scripts/x/lib.mjs")}?t=${Date.now()}`);
    assert.throws(() => lib.add(1, 2), /not implemented: 1\.1/);
    await assert.rejects(() => lib.load("p"), /not implemented: 1\.1/);
    assert.throws(() => new lib.Box(), /not implemented: 1\.1/);
  });

  it("appends only the missing symbols and never touches an existing one", () => {
    const { root, dir } = setup({
      seams: [
        { path: "scripts/x/lib.mjs", signature: "export function add(a, b)" },
        { path: "scripts/x/lib.mjs", signature: "export function sub(a, b)" },
      ],
    });
    write(root, "scripts/x/lib.mjs", "export function add(a, b) {\n  return a + b;\n}\n");
    assert.deepEqual(planStubs(root, args(dir)), { created: [], appended: ["scripts/x/lib.mjs"] });
    const source = readFileSync(join(root, "scripts/x/lib.mjs"), "utf8");
    assert.ok(source.startsWith("export function add(a, b) {\n  return a + b;\n}\n"));
    assert.match(source, /export function sub\(a, b\) \{ throw new Error\("not implemented: 1\.1"\); \}/);
    assert.equal((source.match(/function add/g) ?? []).length, 1);
    assert.deepEqual(planStubs(root, args(dir)), { created: [], appended: [] });
    assert.equal(readFileSync(join(root, "scripts/x/lib.mjs"), "utf8"), source);
  });

  it("rejects a seam signature it cannot stub", () => {
    const { root, dir } = setup({ seams: [{ path: "scripts/x/lib.mjs", signature: "export const add = 1" }] });
    assert.throws(() => planStubs(root, args(dir)), /unsupported signature/);
  });
});

describe("planTests", () => {
  it("writes a node:test skeleton named per acceptance id that fails on a TODO", () => {
    const { root, dir } = setup({ seams: [{ path: "scripts/x/lib.mjs", signature: "export function add(a, b)" }] });
    const hidden = planTests(root, args(dir));
    assert.equal(hidden, "documents/plans/demo/tests/1.1/scripts/x/__tests__/lib.test.mjs");
    const source = readFileSync(join(root, hidden), "utf8");
    assert.match(source, /node:test/);
    assert.match(source, /import \{ add \} from "\.\.\/lib\.mjs";/);
    assert.match(source, /"A1 adds two numbers"/);
    assert.match(source, /A2 handles \\"quotes\\"/);
    planStubs(root, args(dir));
    write(root, "scripts/x/__tests__/lib.test.mjs", source);
    const { NODE_TEST_CONTEXT: _context, ...env } = process.env;
    const run = spawnSync(process.execPath, ["--test", "--test-reporter=tap", "scripts/x/__tests__/lib.test.mjs"], { cwd: root, encoding: "utf8", env });
    assert.notEqual(run.status, 0);
    assert.match(run.stdout, /TODO: A1 adds two numbers/);
  });

  it("writes a jest skeleton for a .test.ts path and refuses to overwrite", () => {
    const { root, dir } = setup({
      seams: [{ path: "packages/core/src/math/add.ts", signature: "export function add(a: number, b: number): number" }],
      tests: { hidden: ["documents/plans/demo/tests/1.1/packages/core/__tests__/math/add.test.ts"], command: "node scripts/agents/run.mjs test core -- add" },
    });
    const hidden = planTests(root, args(dir));
    const source = readFileSync(join(root, hidden), "utf8");
    assert.match(source, /import \{ add \} from "\.\.\/\.\.\/src\/math\/add";/);
    assert.doesNotMatch(source, /node:test/);
    assert.match(source, /it\("A1 adds two numbers"/);
    assert.throws(() => planTests(root, args(dir)), /already exists/);
  });

  it("is reachable as plan.mjs stubs and plan.mjs tests", () => {
    const { root } = setup({ seams: [{ path: "scripts/x/lib.mjs", signature: "export function add(a, b)" }] });
    const tests = spawnSync("node", [cli, "tests", "1", "1.1"], { cwd: root, encoding: "utf8" });
    assert.equal(tests.status, 0, tests.stderr);
    const stubs = spawnSync("node", [cli, "stubs", "1", "1.1"], { cwd: root, encoding: "utf8" });
    assert.equal(stubs.status, 0, stubs.stderr);
    assert.ok(existsSync(join(root, "scripts/x/lib.mjs")));
    assert.ok(existsSync(join(root, "documents/plans/demo/tests/1.1/scripts/x/__tests__/lib.test.mjs")));
  });
});
