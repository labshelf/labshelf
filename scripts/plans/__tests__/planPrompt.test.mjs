import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parseBlocks, validate } from "../../agents/schemas.mjs";
import { loadSession, saveSession } from "../planFiles.mjs";
import { planNew } from "../planNew.mjs";
import { planPrompt } from "../planPrompt.mjs";

const cli = fileURLToPath(new URL("../plan.mjs", import.meta.url));

const SPEC = {
  id: "1.1",
  plan: "demo",
  goal: "Add the thing",
  level: "behaviour",
  runner: { agent: "implementer", model: "sonnet" },
  sha: "abc1234",
  edit: [{ path: "src/a.mjs", lines: "1-10", why: "change a" }],
  create: ["src/__tests__/"],
  decided: ["name it thing"],
  acceptance: [{ id: "A1", check: "it works" }],
  tests: { hidden: ["t/a.test.mjs"], command: "run t" },
};

const setup = () => {
  const root = mkdtempSync(join(tmpdir(), "plan-prompt-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  const dir = planNew(root, { slug: "demo", level: "N2" });
  saveSession(dir, { ...loadSession(dir, "1"), packages: [SPEC] });
  return { root, dir };
};

describe("planPrompt", () => {
  it("prints a 3-line header, the spec block and the closing line", () => {
    const { root, dir } = setup();
    const text = planPrompt(root, { planDir: dir, sessionId: "1", specId: "1.1" });
    const lines = text.split("\n");
    assert.match(lines[0], /demo/);
    assert.match(lines[0], /session 1/);
    assert.match(lines[1], /1\.1/);
    assert.match(lines[1], /Add the thing/);
    assert.equal(lines[2], "Edit only spec paths; tests are hidden.");
    assert.equal(lines.at(-1), "Return report/v1.");
    assert.ok(text.includes("```yaml spec/v1\nschema: spec/v1\n"));
  });

  it("the block parses back to the spec and passes validate", () => {
    const { root, dir } = setup();
    const { spec } = parseBlocks(planPrompt(root, { planDir: dir, sessionId: "1", specId: "1.1" }));
    assert.deepEqual(validate("spec", spec), []);
    const { schema, ...rest } = spec;
    assert.equal(schema, "spec/v1");
    assert.deepEqual(rest, SPEC);
  });

  it("throws for an unknown spec id", () => {
    const { root, dir } = setup();
    assert.throws(() => planPrompt(root, { planDir: dir, sessionId: "1", specId: "9.9" }), /9\.9/);
  });
});

describe("plan.mjs prompt", () => {
  const run = (cwd, ...args) => spawnSync("node", [cli, ...args], { cwd, encoding: "utf8" });

  it("prints the prompt from the repo with the only plan, exit 0", () => {
    const { root } = setup();
    const result = run(root, "prompt", "1", "1.1");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^.*demo.*\n/);
    assert.match(result.stdout, /Return report\/v1\.\n$/);
    assert.deepEqual(validate("spec", parseBlocks(result.stdout).spec), []);
  });

  it("unknown spec: stderr and exit 1", () => {
    const { root } = setup();
    const result = run(root, "prompt", "1", "7.7");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /7\.7/);
    assert.equal(result.stdout, "");
  });
});
