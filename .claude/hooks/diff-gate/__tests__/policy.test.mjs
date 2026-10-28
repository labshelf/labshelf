import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyPolicy, decide, normalizeVariant } from "../policy.mjs";

const exp = (localRefs) => ({ kind: "unused-export", file: "a.ts", line: 1, symbol: "x", annotation: { kind: "const", localRefs } });
const file = (configRefs) => ({ kind: "unused-file", file: "a.ts", line: 1, annotation: { configRefs } });
const rule = (ruleClass) => ({ kind: "source-rule", file: "a.ts", annotation: { ruleClass } });
const plain = (kind) => ({ kind, file: "a.ts" });

const cases = [
  ["clone", plain("clone"), "block", "block", "block", "block"],
  ["forbidden-path", plain("forbidden-path"), "block", "block", "block", "block"],
  ["forbidden-script", plain("forbidden-script"), "block", "block", "block", "block"],
  ["unused-file configRefs 0", file(0), "block", "block", "block", "silent"],
  ["unused-file configRefs 2", file(2), "block", "silent", "silent", "silent"],
  ["unused-export localRefs 0", exp(0), "block", "block", "block", "silent"],
  ["unused-export localRefs 3", exp(3), "block", "block", "autofix", "autofix"],
  ["rule eslint-disable", rule("eslint-disable"), "block", "block", "block", "block"],
  ["rule ts-ignore", rule("ts-ignore"), "block", "block", "block", "block"],
  ["rule test-skip", rule("test-skip"), "block", "block", "block", "block"],
  ["rule commented-code", rule("commented-code"), "block", "block", "block", "silent"],
  ["rule other", rule("other"), "block", "silent", "silent", "silent"],
];

describe("decide", () => {
  for (const [name, violation, ...expected] of cases) {
    it(`${name}: ${expected.join("/")} under a/b/c/d`, () => {
      assert.deepEqual(["a", "b", "c", "d"].map((variant) => decide(violation, variant)), expected);
    });
  }
  it("treats a missing annotation as zero references", () => {
    assert.equal(decide({ kind: "unused-export" }, "d"), "silent");
    assert.equal(decide({ kind: "unused-file" }, "b"), "block");
    assert.equal(decide({ kind: "source-rule" }, "d"), "silent");
  });
});

describe("applyPolicy and normalizeVariant", () => {
  it("splits a list by action and keeps order", () => {
    const list = [exp(1), plain("clone"), file(1), exp(0), rule("ts-ignore")];
    const out = applyPolicy(list, "d");
    assert.deepEqual(out.block, [list[1], list[4]]);
    assert.deepEqual(out.autofix, [list[0]]);
    assert.deepEqual(out.silent, [list[2], list[3]]);
  });
  it("defaults to f and ignores case and junk", () => {
    assert.equal(normalizeVariant(undefined), "f");
    assert.equal(normalizeVariant("C"), "c");
    assert.equal(normalizeVariant("zzz"), "f");
  });
});
