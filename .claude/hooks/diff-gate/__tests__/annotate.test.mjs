import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { codeLines, configReferences, describeExport, ruleClass } from "../annotate.mjs";

let dir;
const put = (rel, text) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
const pick = ({ declKind, selfRefs }) => ({ declKind, selfRefs });

before(() => {
  dir = mkdtempSync(join(tmpdir(), "diff-gate-annotate-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  put(
    "src/mod.ts",
    [
      "export function used(a: number): number {", // 1
      "  return a + 1;",
      "}",
      "export const helper = () => used(1);", // 4
      "export interface Shape { size: number }", // 5
      "export const unusedHere = 3;", // 6
      "// used in a comment only: unusedHere",
      'const text = "unusedHere in a string";',
      "export type Alias = Shape;", // 9
      "export default function main() {}", // 10
      "export { helper as other };", // 11
      "const x: Shape = { size: helper() };",
      "",
    ].join("\n"),
  );
  put("src/entry/worker.ts", "export const run = 1;\n");
  put("src/plain/lonely.ts", "export const lonely = 1;\n");
  put("vite.config.ts", 'export default { build: { rollupOptions: { input: "src/entry/worker.ts" } } };\n');
  put("scripts/build.mjs", 'import "./src/plain/other.js";\n');
  put("docs.md", "mentions lonely and worker\n");
});
after(() => rmSync(dir, { recursive: true, force: true }));

describe("describeExport", () => {
  it("counts references inside the file outside the declaration, ignoring comments and strings", () => {
    assert.deepEqual(pick(describeExport(dir, "src/mod.ts", 1, "used")), { declKind: "function", selfRefs: 1 });
    assert.deepEqual(pick(describeExport(dir, "src/mod.ts", 6, "unusedHere")), { declKind: "const", selfRefs: 0 });
  });
  it("sees uses in later code and type positions", () => {
    assert.deepEqual(pick(describeExport(dir, "src/mod.ts", 5, "Shape")), { declKind: "interface", selfRefs: 2 });
    assert.deepEqual(pick(describeExport(dir, "src/mod.ts", 4, "helper")), { declKind: "const", selfRefs: 2 });
  });
  it("classifies type aliases, default exports and export lists", () => {
    assert.equal(describeExport(dir, "src/mod.ts", 9, "Alias").declKind, "type");
    assert.equal(describeExport(dir, "src/mod.ts", 10, "main").simpleDecl, false);
    assert.equal(describeExport(dir, "src/mod.ts", 11, "other").declKind, "list");
  });
  it("returns an empty object for a missing file", () => {
    assert.deepEqual(describeExport(dir, "nope.ts", 1, "x"), {});
  });
});

describe("configReferences", () => {
  it("finds a config naming the file by its stem", async () => {
    const hits = await configReferences(dir, "src/entry/worker.ts");
    assert.ok(hits.includes("vite.config.ts"), hits.join());
    assert.ok(!hits.includes("docs.md"));
  });
  it("finds nothing when only markdown mentions the file", async () => {
    assert.deepEqual(await configReferences(dir, "src/plain/lonely.ts"), []);
  });
  it("finds a script naming the file", async () => {
    assert.deepEqual(await configReferences(dir, "src/plain/other.ts"), ["scripts/build.mjs"]);
  });
});

describe("ruleClass", () => {
  it("maps sourceRules messages to a class", () => {
    assert.equal(ruleClass("adds an eslint-disable comment. Fix the lint issue instead of suppressing it."), "eslint-disable");
    assert.equal(ruleClass("adds a @ts-ignore or @ts-expect-error with no reason. Add a reason"), "ts-ignore");
    assert.equal(ruleClass("skips a test (.skip( or xit(). Fix or delete the test"), "test-skip");
    assert.equal(ruleClass("adds commented-out code. Delete it; git keeps the history."), "commented-code");
    assert.equal(ruleClass("uses a banned word"), "other");
  });
});

describe("codeLines", () => {
  it("blanks string contents but keeps template-literal expressions", () => {
    const [plain, template, mixed] = codeLines("const a = 'fmt(1)';\nconst b = `Library: ${fmt(2)} and fmt`;\nconst c = \"x\" + `${a}${b}`;");
    assert.doesNotMatch(plain, /fmt/);
    assert.match(template, /\$\{fmt\(2\)\}/);
    assert.doesNotMatch(template.replace(/\$\{fmt\(2\)\}/, ""), /fmt/);
    assert.match(mixed, /\$\{a\}\$\{b\}/);
    assert.equal(template.length, "const b = `Library: ${fmt(2)} and fmt`;".length);
  });
});
