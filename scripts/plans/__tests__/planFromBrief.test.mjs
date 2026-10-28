import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import { validate } from "../../agents/schemas.mjs";
import { loadSession, saveSession } from "../planFiles.mjs";
import { planFromBrief } from "../planFromBrief.mjs";
import { planNew } from "../planNew.mjs";

const cli = fileURLToPath(new URL("../plan.mjs", import.meta.url));

const setup = () => {
  const root = mkdtempSync(join(tmpdir(), "plan-from-brief-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  const dir = planNew(root, { slug: "demo", level: "N2" });
  return { root, dir };
};

const BRIEF = {
  schema: "brief/v1",
  area: "demo area",
  question: "what?",
  sha: "abc1234",
  edit: [{ path: "src/a.mjs", lines: "1-10", why: "change a" }],
  read: [{ path: "src/b.mjs", lines: "5-9", why: "context" }],
  callers: [{ symbol: "fa", path: "src/c.mjs", lines: "3-4" }],
  commands: ["node scripts/agents/run.mjs test tooling -- src/a.test.mjs"],
  risks: ["not copied"],
};

const writeBrief = (dir, brief = BRIEF, name = "brief.yaml") => {
  mkdirSync(join(dir, "research"), { recursive: true });
  const file = join(dir, "research", name);
  writeFileSync(file, stringify(brief));
  return file;
};

describe("planFromBrief", () => {
  it("adds a draft spec to the session that passes the spec validator", () => {
    const { root, dir } = setup();
    const spec = planFromBrief(root, { briefFile: writeBrief(dir), specId: "1.1", sessionId: "1", planDir: dir });
    const stored = loadSession(dir, "1").packages;
    assert.equal(stored.length, 1);
    assert.deepEqual(stored[0], spec);
    assert.equal(spec.id, "1.1");
    assert.equal(spec.plan, "demo");
    assert.equal(spec.sha, "abc1234");
    assert.deepEqual(spec.edit, BRIEF.edit);
    assert.deepEqual(spec.read, BRIEF.read);
    assert.deepEqual(spec.callers, BRIEF.callers);
    assert.deepEqual(spec.commands, BRIEF.commands);
    assert.deepEqual(spec.acceptance, []);
    assert.deepEqual(spec.tests, { hidden: [], command: "" });
    assert.deepEqual(validate("spec", { schema: "spec/v1", ...spec }), []);
  });

  it("merges into an existing spec: union of lists, scalars kept, sha updated", () => {
    const { root, dir } = setup();
    const session = loadSession(dir, "1");
    saveSession(dir, {
      ...session,
      packages: [
        {
          id: "1.1",
          plan: "demo",
          goal: "keep this goal",
          level: "contract",
          runner: { agent: "implementer", model: "opus" },
          sha: "old0000",
          edit: [{ path: "src/old.mjs", lines: "1-2", why: "old" }, BRIEF.edit[0]],
          acceptance: [{ id: "A1", check: "kept" }],
          tests: { hidden: ["t.mjs"], command: "run t" },
          commands: ["existing command"],
          decided: ["kept decision"],
        },
      ],
    });
    planFromBrief(root, { briefFile: writeBrief(dir), specId: "1.1", sessionId: "1", planDir: dir });
    const [spec] = loadSession(dir, "1").packages;
    assert.equal(spec.goal, "keep this goal");
    assert.equal(spec.level, "contract");
    assert.deepEqual(spec.runner, { agent: "implementer", model: "opus" });
    assert.equal(spec.sha, "abc1234");
    assert.deepEqual(spec.edit.map((e) => e.path), ["src/old.mjs", "src/a.mjs"]);
    assert.deepEqual(spec.read, BRIEF.read);
    assert.deepEqual(spec.callers, BRIEF.callers);
    assert.deepEqual(spec.commands, ["existing command", BRIEF.commands[0]]);
    assert.deepEqual(spec.acceptance, [{ id: "A1", check: "kept" }]);
    assert.deepEqual(spec.tests, { hidden: ["t.mjs"], command: "run t" });
    assert.deepEqual(spec.decided, ["kept decision"]);
  });

  it("merging twice does not duplicate entries and keeps other specs", () => {
    const { root, dir } = setup();
    const briefFile = writeBrief(dir);
    planFromBrief(root, { briefFile, specId: "1.1", sessionId: "1", planDir: dir });
    planFromBrief(root, { briefFile, specId: "1.2", sessionId: "1", planDir: dir });
    planFromBrief(root, { briefFile, specId: "1.1", sessionId: "1", planDir: dir });
    const packages = loadSession(dir, "1").packages;
    assert.deepEqual(packages.map((p) => p.id), ["1.1", "1.2"]);
    assert.equal(packages[0].edit.length, 1);
    assert.equal(packages[0].commands.length, 1);
  });

  it("rejects an invalid brief and a missing session without writing", () => {
    const { root, dir } = setup();
    const bad = writeBrief(dir, { schema: "brief/v1", area: "x" }, "bad.yaml");
    assert.throws(() => planFromBrief(root, { briefFile: bad, specId: "1.1", sessionId: "1", planDir: dir }), /question/);
    assert.throws(() => planFromBrief(root, { briefFile: writeBrief(dir), specId: "9.1", sessionId: "9", planDir: dir }), /9\.yaml/);
    assert.deepEqual(loadSession(dir, "1").packages, []);
  });
});

describe("plan.mjs from-brief", () => {
  const run = (cwd, ...args) => spawnSync("node", [cli, ...args], { cwd, encoding: "utf8" });

  it("derives the plan from the brief location and the session from the spec id", () => {
    const { root, dir } = setup();
    const briefFile = writeBrief(dir);
    const result = run(root, "from-brief", briefFile, "--spec", "1.3");
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(loadSession(dir, "1").packages.map((p) => p.id), ["1.3"]);
  });

  it("accepts --session and --plan, and fails with exit 1 without --spec", () => {
    const { root, dir } = setup();
    const briefFile = writeBrief(dir);
    const ok = run(root, "from-brief", briefFile, "--spec", "x", "--session", "1", "--plan", "demo");
    assert.equal(ok.status, 0, ok.stderr);
    const bad = run(root, "from-brief", briefFile);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /--spec/);
  });
});
