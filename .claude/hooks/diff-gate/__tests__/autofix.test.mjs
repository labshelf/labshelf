import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { applyAutofixes, stripExport } from "../autofix.mjs";

describe("stripExport", () => {
  const cases = [
    ["export function foo(a: number) {", "foo", "function foo(a: number) {"],
    ["export async function foo() {", "foo", "async function foo() {"],
    ["  export const foo = 1;", "foo", "  const foo = 1;"],
    ["export let foo = 1;", "foo", "let foo = 1;"],
    ["export class Foo extends Bar {", "Foo", "class Foo extends Bar {"],
    ["export interface Foo {", "Foo", "interface Foo {"],
    ["export type Foo<T> = T[];", "Foo", "type Foo<T> = T[];"],
    ["export enum Foo {", "Foo", "enum Foo {"],
    ["export const enum Foo {", "Foo", "const enum Foo {"],
  ];
  for (const [line, name, expected] of cases) {
    it(`edits '${line}'`, () => assert.equal(stripExport(line, name), expected));
  }
  it("never touches export default, lists, re-exports, other symbols or multi-declarator lines", () => {
    assert.equal(stripExport("export default function foo() {}", "foo"), null);
    assert.equal(stripExport("export default foo;", "foo"), null);
    assert.equal(stripExport("export { foo };", "foo"), null);
    assert.equal(stripExport("export type { foo } from './x';", "foo"), null);
    assert.equal(stripExport("export function foobar() {}", "foo"), null);
    assert.equal(stripExport("export const a = 1, foo = 2;", "foo"), null);
    assert.equal(stripExport("const foo = 1;", "foo"), null);
  });
});

describe("applyAutofixes", () => {
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "diff-gate-autofix-"));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("removes only the export keyword on flagged lines and leaves the rest byte-identical", () => {
    const original = [
      "import { x } from './x';", // 1
      "export function keep() { return helper() + other; }", // 2 (not flagged)
      "export function helper() {", // 3
      "  return 1;",
      "}",
      "export const other = 2;", // 6
      "export default function main() {}", // 7 (flagged but default)
      "export interface Shape { a: number }", // 8
      "export { helper as renamed };", // 9 (flagged, a list)
      "",
    ].join("\n");
    writeFileSync(join(dir, "m.ts"), original);
    const violations = [
      { kind: "unused-export", file: "m.ts", line: 3, symbol: "helper" },
      { kind: "unused-export", file: "m.ts", line: 6, symbol: "other" },
      { kind: "unused-export", file: "m.ts", line: 7, symbol: "main" },
      { kind: "unused-export", file: "m.ts", line: 8, symbol: "Shape" },
      { kind: "unused-export", file: "m.ts", line: 9, symbol: "renamed" },
      { kind: "unused-export", file: "gone.ts", line: 1, symbol: "z" },
      { kind: "unused-export", file: "m.ts", line: 4 },
    ];
    const { applied, failed } = applyAutofixes(dir, violations);
    assert.deepEqual(applied, ["m.ts:3:helper", "m.ts:6:other", "m.ts:8:Shape"]);
    assert.equal(failed.length, 4);
    const after = readFileSync(join(dir, "m.ts"), "utf8");
    assert.equal(
      after,
      original.replace("export function helper", "function helper").replace("export const other", "const other").replace("export interface Shape", "interface Shape"),
    );
    assert.equal(after.split("\n").length, original.split("\n").length);
    assert.match(after, /export default function main/);
    assert.match(after, /export function keep/);
  });
});
