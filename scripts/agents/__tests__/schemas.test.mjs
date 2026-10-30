import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { KINDS, parseBlocks, validate } from "../schemas.mjs";

const fixtures = fileURLToPath(new URL("./fixtures/schemas/", import.meta.url));
const load = (kind, name) => readFileSync(join(fixtures, kind, name), "utf8");
const files = (kind, prefix) => readdirSync(join(fixtures, kind)).filter((f) => f.startsWith(prefix) && f.endsWith(".yaml"));

describe("KINDS", () => {
  it("lists the seven handoff kinds", () => {
    assert.deepEqual([...KINDS].sort(), ["brief", "diagnosis", "plan", "report", "session", "spec", "verdict"]);
  });
});

describe("fixtures", () => {
  for (const kind of KINDS) {
    it(`${kind} has at least one valid and one invalid fixture`, () => {
      assert.ok(files(kind, "valid-").length >= 1);
      assert.ok(files(kind, "invalid-").length >= 1);
    });
    for (const name of files(kind, "valid-")) {
      it(`${kind}/${name} validates`, () => {
        assert.deepEqual(validate(kind, parse(load(kind, name))), []);
      });
    }
    for (const name of files(kind, "invalid-")) {
      it(`${kind}/${name} is rejected with the named field`, () => {
        const text = load(kind, name);
        const expected = /^# error: (.+)$/m.exec(text)?.[1];
        assert.ok(expected, "fixture needs a '# error: <field path>' line");
        const errors = validate(kind, parse(text));
        assert.ok(errors.length > 0, "expected errors");
        assert.ok(errors.some((e) => e.includes(expected)), `no error mentions ${expected}: ${errors.join(" | ")}`);
      });
    }
  }
});

describe("validate", () => {
  const spec = () => parse(load("spec", "valid-full.yaml"));

  it("names the full field path of a nested error", () => {
    const value = spec();
    value.edit.push({ path: 3, lines: "1-2", why: "w" });
    assert.deepEqual(validate("spec", value), ["edit[1].path: expected a string"]);
  });

  it("rejects unknown keys", () => {
    assert.deepEqual(validate("spec", { ...spec(), extra: 1 }), ["extra: unknown key"]);
  });

  it("reports every missing required key", () => {
    const { goal, level, ...rest } = spec();
    const errors = validate("spec", rest);
    assert.ok(errors.includes("goal: required key is missing"));
    assert.ok(errors.includes("level: required key is missing"));
  });

  it("rejects a wrong schema tag", () => {
    assert.ok(validate("spec", { ...spec(), schema: "plan/v1" }).some((e) => e.startsWith("schema:")));
  });

  it("accepts lines only as <from>-<to> digits", () => {
    for (const lines of ["1-2", "10-200"]) {
      const value = spec();
      value.edit[0].lines = lines;
      assert.deepEqual(validate("spec", value), []);
    }
    for (const lines of ["1", "a-b", "1-", "-2", "1-2-3", 12, " 1-2"]) {
      const value = spec();
      value.edit[0].lines = lines;
      assert.ok(validate("spec", value).some((e) => e.startsWith("edit[0].lines")), String(lines));
    }
  });

  it("rejects numeric ids", () => {
    assert.ok(validate("spec", { ...spec(), id: 3 }).some((e) => e.startsWith("id:")));
    assert.ok(validate("spec", { ...spec(), depends_on: [3] }).some((e) => e.startsWith("depends_on[0]")));
  });

  it("accepts tests as {hidden, command} or {none} and nothing else", () => {
    assert.deepEqual(validate("spec", { ...spec(), tests: { none: "css" } }), []);
    assert.ok(validate("spec", { ...spec(), tests: { hidden: ["a"] } }).some((e) => e.startsWith("tests.command")));
    assert.ok(validate("spec", { ...spec(), tests: { none: "x", hidden: ["a"], command: "c" } }).some((e) => e.startsWith("tests")));
    assert.ok(validate("spec", { ...spec(), tests: {} }).some((e) => e.startsWith("tests")));
    assert.ok(validate("spec", { ...spec(), tests: "none" }).some((e) => e.startsWith("tests")));
  });

  it("requires missing entries when a report has status missing", () => {
    const report = { schema: "report/v1", spec: "1", status: "missing", changes: [], acceptance: [] };
    assert.ok(validate("report", report).some((e) => e.startsWith("missing")));
    assert.deepEqual(validate("report", { ...report, missing: [{ need: "n", why: "w" }] }), []);
  });

  it("requires the field that the verdict routes on", () => {
    const base = { schema: "verdict/v1", spec: "1", evidence: [] };
    assert.ok(validate("verdict", { ...base, verdict: "test_wrong" }).some((e) => e.startsWith("fix")));
    assert.ok(validate("verdict", { ...base, verdict: "spec_ambiguous" }).some((e) => e.startsWith("question")));
    assert.deepEqual(validate("verdict", { ...base, verdict: "test_wrong", fix: "f" }), []);
  });

  it("takes verdict evidence in spec terms only: test, spec_ref, reason, no assertion", () => {
    const entry = { test: "A2 rejects unknown keys", spec_ref: "acceptance A2", reason: "A2 says unknown keys are errors at every depth; nested objects accept them" };
    const base = { schema: "verdict/v1", spec: "1", verdict: "code_wrong", hint: "check nested objects strictly too" };
    assert.deepEqual(validate("verdict", { ...base, evidence: [entry] }), []);
    assert.ok(validate("verdict", { ...base, evidence: [{ ...entry, assertion: "validate returned []" }] }).some((e) => e.includes("assertion")));
    assert.ok(validate("verdict", { ...base, evidence: [{ test: entry.test, reason: entry.reason }] }).some((e) => e.includes("spec_ref")));
  });

  it("rejects non-object values and unknown kinds without throwing", () => {
    assert.ok(validate("spec", null).length > 0);
    assert.ok(validate("spec", [1]).length > 0);
    assert.ok(validate("spec", "text").length > 0);
    assert.ok(validate("spec", undefined).length > 0);
    assert.deepEqual(validate("nope", {}), ['nope: unknown kind (expected one of ' + KINDS.join(", ") + ")"]);
  });
});

describe("parseBlocks", () => {
  const brief = load("brief", "valid-minimal.yaml");
  const verdict = load("verdict", "valid-code-wrong.yaml");

  it("extracts one value per ```yaml <kind>/v1 block, ignoring prose and other fences", () => {
    const text = `Intro\n\n\`\`\`yaml brief/v1\n${brief}\`\`\`\n\ntext\n\n\`\`\`js\nconst x = 1;\n\`\`\`\n\n\`\`\`yaml\nplain: true\n\`\`\`\n\n\`\`\`yaml verdict/v1\n${verdict}\`\`\`\n`;
    const blocks = parseBlocks(text);
    assert.deepEqual(Object.keys(blocks).sort(), ["brief", "verdict"]);
    assert.deepEqual(blocks.brief, parse(brief));
    assert.deepEqual(validate("verdict", blocks.verdict), []);
  });

  it("returns {} when there is no block", () => {
    assert.deepEqual(parseBlocks("no blocks here"), {});
    assert.deepEqual(parseBlocks(""), {});
    assert.deepEqual(parseBlocks(undefined), {});
  });

  it("surfaces a YAML syntax error as a validate error, never a throw", () => {
    const blocks = parseBlocks("```yaml spec/v1\nid: [unclosed\n  goal: : :\n```\n");
    assert.deepEqual(Object.keys(blocks), ["spec"]);
    const errors = validate("spec", blocks.spec);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^yaml: /);
  });

  it("treats a second block of the same kind as an error", () => {
    const text = `\`\`\`yaml brief/v1\n${brief}\`\`\`\n\`\`\`yaml brief/v1\n${brief}\`\`\`\n`;
    const errors = validate("brief", parseBlocks(text).brief);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /duplicate/);
  });

  it("handles CRLF line endings", () => {
    const blocks = parseBlocks(`\`\`\`yaml brief/v1\r\n${brief.replace(/\n/g, "\r\n")}\`\`\`\r\n`);
    assert.deepEqual(validate("brief", blocks.brief), []);
  });

  it("keeps a block of an unknown version out of the result", () => {
    assert.deepEqual(parseBlocks("```yaml brief/v2\na: 1\n```\n"), {});
  });
});
