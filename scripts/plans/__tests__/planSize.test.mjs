import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { planSize, suggestLevel } from "../planSize.mjs";

const FACTS = fileURLToPath(new URL("../../code/facts.mjs", import.meta.url));
const CLI = fileURLToPath(new URL("../plan.mjs", import.meta.url));
const SRC = "packages/core/src";

let root;
let dbPath;
const put = (path, text) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};
const sizeOf = (...paths) => Object.fromEntries(planSize(root, paths).map((line) => line.split(/: (.*)/s).slice(0, 2)));

before(() => {
  root = mkdtempSync(join(tmpdir(), "plan-size-"));
  dbPath = join(root, ".code-facts", "facts.db");
  put("packages/core/package.json", JSON.stringify({ name: "@labshelf/core", version: "0.0.0", main: "src/index.ts", types: "src/index.ts" }));
  put(`${SRC}/lone.ts`, "export function lone(): number {\n  return 1;\n}\n");
  put(`${SRC}/hub.ts`, "export function hub(): number {\n  return 2;\n}\n");
  for (const n of [1, 2, 3, 4]) {
    put(`${SRC}/user${n}.ts`, `import { hub } from "./hub.js";\n\nexport function use${n}(): number {\n  return hub();\n}\n`);
  }
  put(`${SRC}/sync/engine.ts`, "export function engine(): number {\n  return 3;\n}\n");
  put("packages/vscode/src/view.ts", "export function view(): number {\n  return 4;\n}\n");
  mkdirSync(join(root, "node_modules", "@labshelf"), { recursive: true });
  symlinkSync(join("..", "..", "packages", "core"), join(root, "node_modules", "@labshelf", "core"));
  spawnSync("git", ["init", "-q"], { cwd: root });
  const env = { ...process.env, LABSHELF_FACTS_ROOT: root, LABSHELF_FACTS_DB: dbPath };
  const built = spawnSync(process.execPath, [FACTS, "build", "--quiet"], { env, encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  delete process.env.LABSHELF_FACTS_DB;
});
after(() => rmSync(root, { recursive: true, force: true }));

describe("planSize on an indexed fixture", () => {
  it("N0: one file, at most 3 callers, no risk path", () => {
    assert.deepEqual(sizeOf(`${SRC}/lone.ts`), { files: "1", packages: "1 (core)", callers: "0", risk: "none", suggested: "N0" });
  });

  it("counts importers as callers and leaves N0 above 3 of them", () => {
    const size = planSize(root, [`${SRC}/hub.ts`], { dbPath });
    assert.ok(size.includes("callers: 4"), size.join("\n"));
    assert.ok(size.includes("suggested: N1"));
  });

  it("does not count a changed file as a caller of another changed file", () => {
    const size = planSize(root, [`${SRC}/hub.ts`, `${SRC}/user1.ts`], { dbPath });
    assert.ok(size.includes("callers: 3"), size.join("\n"));
  });

  it("N1: up to 3 files in one package; N2 from 4 files or a second package", () => {
    assert.equal(sizeOf(`${SRC}/user1.ts`, `${SRC}/user2.ts`, `${SRC}/user3.ts`).suggested, "N1");
    assert.equal(sizeOf(`${SRC}/user1.ts`, `${SRC}/user2.ts`, `${SRC}/user3.ts`, `${SRC}/user4.ts`).suggested, "N2");
    assert.equal(sizeOf(`${SRC}/lone.ts`, "packages/vscode/src/view.ts").suggested, "N2");
  });

  it("a risk path makes even one file N2 and is listed", () => {
    const size = sizeOf(`${SRC}/sync/engine.ts`);
    assert.equal(size.suggested, "N2");
    assert.equal(size.risk, `${SRC}/sync/engine.ts`);
  });

  it("accepts absolute paths under the root", () => {
    assert.equal(sizeOf(join(root, SRC, "lone.ts")).files, "1");
  });
});

describe("planSize beyond N2 and without callers", () => {
  it("N3: more than 15 files, or more than 2 packages", () => {
    const many = Array.from({ length: 16 }, (_, i) => `scripts/f${i}.mjs`);
    assert.equal(sizeOf(...many).suggested, "N3");
    assert.equal(sizeOf("packages/core/src/a.ts", "packages/vscode/src/b.ts", "packages/browser/src/c.ts").suggested, "N3");
    assert.equal(sizeOf(...many.slice(0, 15)).suggested, "N2");
  });

  it("an unindexed path prints callers: ? and still suggests a level", () => {
    const size = sizeOf("scripts/plans/plan.mjs");
    assert.deepEqual(size, { files: "1", packages: "1 (scripts)", callers: "?", risk: "none", suggested: "N0" });
    assert.equal(sizeOf(`${SRC}/lone.ts`, "scripts/x.mjs").callers, "?");
  });

  it("no database prints callers: ? and still suggests a level", () => {
    const lines = planSize(root, [`${SRC}/lone.ts`, `${SRC}/user1.ts`], { dbPath: join(root, "missing.db") });
    assert.deepEqual(lines, ["files: 2", "packages: 1 (core)", "callers: ?", "risk: none", "suggested: N1"]);
  });

  it("rejects an empty path list", () => {
    assert.throws(() => planSize(root, []), /at least one path/);
  });

  it("suggestLevel applies the thresholds directly", () => {
    assert.equal(suggestLevel({ files: 1, packages: 1, callers: 3, risk: false }), "N0");
    assert.equal(suggestLevel({ files: 1, packages: 1, callers: 4, risk: false }), "N1");
    assert.equal(suggestLevel({ files: 1, packages: 1, callers: 0, risk: true }), "N2");
    assert.equal(suggestLevel({ files: 16, packages: 1, callers: 0, risk: false }), "N3");
  });
});

describe("plan size command", () => {
  it("prints the report for paths given to the CLI", () => {
    const env = { ...process.env, LABSHELF_FACTS_DB: join(root, "missing.db") };
    const run = spawnSync(process.execPath, [CLI, "size", "scripts/plans/plan.mjs"], { env, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /^suggested: N\d$/m);
  });
});
