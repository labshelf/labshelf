// Pins the automatic arbiter round of run.mjs: a stalled spec runs a fake headless `claude` on PATH as the arbiter (and the tester).
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { main } from "../run.mjs";

const TEST_FILE = "scripts/__tests__/thing.test.mjs";
const HIDDEN = `documents/plans/demo/tests/1.1/${TEST_FILE}`;
const QUOTE = "expect the parser to return exactly three nested sections";

// A stand-in for `claude`: logs its role and environment, then prints the FAKE_<ROLE> file as the JSON result's text.
const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const role = args[args.indexOf("--agent") + 1];
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ role, envRole: process.env.LABSHELF_ROLE, session: process.env.LABSHELF_PLAN_SESSION ?? null, prompt: args[args.indexOf("-p") + 1] }) + "\\n");
if (process.env.FAKE_SLEEP) { const end = Date.now() + Number(process.env.FAKE_SLEEP); while (Date.now() < end); }
const file = process.env["FAKE_" + role.toUpperCase()];
console.log(JSON.stringify({ type: "result", is_error: false, result: file ? fs.readFileSync(file, "utf8") : "nothing" }));
`;

const saved = { ...process.env };
let dir;
let repo;
let runs;

const session = `schema: session/v1
id: "1"
goal: g
depends_on: []
owns: [scripts/thing.mjs]
milestone: false
status: pending
blocked_reason: null
packages:
  - id: "1.1"
    goal: thing
    level: behaviour
    runner: {agent: implementer, model: sonnet}
    edit:
      - {path: scripts/thing.mjs, lines: "1-9", why: "the thing"}
    acceptance:
      - {id: A1, check: "parses sections"}
    tests:
      hidden: [${HIDDEN}]
      command: node scripts/agents/run.mjs test tooling --spec 1.1 -- ${TEST_FILE}
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "run-arbiter-"));
  repo = join(dir, "repo");
  runs = join(dir, "runs");
  mkdirSync(join(repo, "documents/plans/demo/sessions"), { recursive: true });
  writeFileSync(join(repo, "documents/plans/demo/sessions/1.yaml"), session);
  mkdirSync(join(repo, "documents/plans/demo/tests/1.1/scripts/__tests__"), { recursive: true });
  writeFileSync(join(repo, HIDDEN), `test("A1 parses", () => {\n  // ${QUOTE}\n});\n`);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "claude"), FAKE_CLAUDE);
  chmodSync(join(dir, "bin", "claude"), 0o755);
  Object.assign(process.env, {
    LABSHELF_LOGS_DIR: join(dir, "logs"), LABSHELF_RUNS_DIR: runs, LABSHELF_TELEMETRY_SPOOL: join(dir, "spool"),
    PATH: `${join(dir, "bin")}:${saved.PATH}`, FAKE_LOG: join(dir, "fake.log"), LABSHELF_PLAN_SESSION: "1", LABSHELF_AGENT_TIMEOUT_MS: "20000",
  });
  for (const key of ["LABSHELF_AUTO_ARBITER", "LABSHELF_TELEMETRY", "LABSHELF_PLAN", "LABSHELF_ROLE", "FAKE_SLEEP", "FAKE_ARBITER", "FAKE_TESTER"]) delete process.env[key];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});

const fakeRole = (role, text) => {
  const file = join(dir, `${role}.txt`);
  writeFileSync(file, text);
  process.env[`FAKE_${role.toUpperCase()}`] = file;
};
const verdict = (body) => fakeRole("arbiter", `Judged.\n\n\`\`\`yaml verdict/v1\nschema: verdict/v1\nspec: "1.1"\n${body}\`\`\`\n`);
const calls = () => (existsSync(join(dir, "fake.log")) ? readFileSync(join(dir, "fake.log"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const events = () => {
  const spool = join(dir, "spool");
  return existsSync(spool) ? readdirSync(spool).flatMap((f) => readFileSync(join(spool, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))) : [];
};

// A fake node --test run that always fails the same test.
const failing = () => ({ status: 1, stdout: "not ok 1 - A1 parses\n# tests 1\n# pass 0\n# fail 1\n", stderr: "" });
const argv = ["test", "tooling", "--spec", "1.1", "--plan", "demo", "--", TEST_FILE];

async function call() {
  const lines = [];
  const code = await main(argv, { root: repo, out: (line) => lines.push(line), spawn: failing });
  return { code, lines, text: lines.join("\n") };
}

// Three runs that do not shrink the failing set; the next call is the stalled one.
async function stall() {
  for (let i = 0; i < 3; i += 1) assert.equal((await call()).code, 1);
}

describe("automatic arbiter", () => {
  it("code_wrong: prints spec refs, withholds a reason quoting the test, resets the budget and exits 4", async () => {
    verdict(`verdict: code_wrong
evidence:
  - {test: "A1 parses", spec_ref: "acceptance A1", reason: "the code returns sections flat; A1 asks for nesting"}
  - {test: "A1 nests", spec_ref: "decided[0]", reason: "it should ${QUOTE}"}
hint: "build the nesting from the heading levels"
`);
    await stall();
    const result = await call();
    assert.equal(result.code, 4);
    assert.match(result.text, /ARBITER: code_wrong/);
    assert.match(result.text, /A1 parses \[acceptance A1\]/);
    assert.match(result.text, /A1 nests \[decided\[0\]\]/);
    assert.match(result.text, /the code returns sections flat/);
    assert.match(result.text, /\(withheld: quoted the test\)/);
    assert.ok(!result.text.includes(QUOTE));
    assert.match(result.text, /hint: build the nesting from the heading levels/);
    assert.match(result.text, /same package/);
    assert.ok(result.lines.length <= 40);
    const [arbiter] = calls();
    assert.deepEqual([arbiter.role, arbiter.envRole, arbiter.session], ["arbiter", "arbiter", null]);
    assert.match(arbiter.prompt, /```yaml spec\/v1/);
    assert.match(arbiter.prompt, /git diff/);
    assert.match(arbiter.prompt, /Last test log: .*-test\.log/);
    assert.ok(existsSync(join(runs, "demo", "1.1.verdict-1.yaml")));
    assert.ok(existsSync(join(runs, "demo", "1.1.json.1")));
    assert.ok(!existsSync(join(runs, "demo", "1.1.json")));
    assert.equal(events().find((e) => e.kind === "arbiter_verdict").verdict, "code_wrong");
    // Fresh budget: the next call runs the tests again.
    assert.equal((await call()).code, 1);
  });

  it("test_wrong: runs the tester with the verdict, then prints the rerun line without the fix", async () => {
    verdict(`verdict: test_wrong
evidence:
  - {test: "A1 parses", spec_ref: "acceptance A1", reason: "A1 never fixes the count"}
fix: "SECRET-FIX drop the count assertion"
`);
    fakeRole("tester", "Done.\n\n```yaml report/v1\nschema: report/v1\nspec: \"1.1\"\nstatus: done\nchanges: []\nacceptance: []\n```\n");
    await stall();
    const result = await call();
    assert.equal(result.code, 4);
    assert.match(result.text, /ARBITER: test_wrong — the tests were corrected; run the same test command again/);
    assert.ok(!result.text.includes("SECRET-FIX"));
    const [, tester] = calls();
    assert.deepEqual([tester.role, tester.envRole, tester.session], ["tester", "tester", null]);
    assert.match(tester.prompt, /```yaml verdict\/v1[\s\S]*SECRET-FIX/);
    assert.match(tester.prompt, /```yaml spec\/v1/);
    assert.ok(existsSync(join(runs, "demo", "1.1.json.1")));
  });

  it("test_wrong with a failing tester falls back to BLOCKED", async () => {
    verdict(`verdict: test_wrong\nevidence:\n  - {test: "A1 parses", spec_ref: "acceptance A1", reason: "r"}\nfix: "f"\n`);
    fakeRole("tester", "no report");
    await stall();
    const result = await call();
    assert.equal(result.code, 3);
    assert.match(result.text, /BLOCKED: return report status blocked_tests/);
  });

  it("spec_ambiguous prints BLOCKED with the question lines", async () => {
    verdict(`verdict: spec_ambiguous\nevidence:\n  - {test: "A1 parses", spec_ref: "acceptance A1", reason: "r"}\nquestion: "flat sections?\\nnested sections?"\n`);
    await stall();
    const result = await call();
    assert.equal(result.code, 3);
    assert.match(result.text, /BLOCKED: return report status blocked_tests/);
    assert.match(result.text, /question: flat sections\?\n.*question: nested sections\?/);
    // The open verdict is not judged again.
    assert.equal((await call()).code, 3);
    assert.equal(calls().length, 1);
  });

  it("a third stall after two arbiter rounds prints BLOCKED without calling the arbiter", async () => {
    verdict(`verdict: code_wrong\nevidence:\n  - {test: "A1 parses", spec_ref: "acceptance A1", reason: "nesting is missing"}\nhint: "add nesting"\n`);
    for (let round = 0; round < 2; round += 1) {
      await stall();
      assert.equal((await call()).code, 4);
    }
    await stall();
    const result = await call();
    assert.equal(result.code, 3);
    assert.match(result.text, /BLOCKED/);
    assert.equal(calls().length, 2);
  });

  it("an invalid verdict falls back to BLOCKED", async () => {
    verdict("verdict: code_wrong\nevidence: []\n");
    await stall();
    const result = await call();
    assert.equal(result.code, 3);
    assert.match(result.text, /BLOCKED[\s\S]*automatic arbiter failed: invalid verdict/);
    assert.equal(events().find((e) => e.kind === "arbiter_failed").spec, "1.1");
  });

  it("a timed-out arbiter falls back to BLOCKED", async () => {
    verdict(`verdict: code_wrong\nevidence:\n  - {test: "A1 parses", spec_ref: "acceptance A1", reason: "r"}\nhint: "h"\n`);
    process.env.FAKE_SLEEP = "3000";
    process.env.LABSHELF_AGENT_TIMEOUT_MS = "300";
    await stall();
    const result = await call();
    assert.equal(result.code, 3);
    assert.match(result.text, /automatic arbiter failed: arbiter timed out/);
  });

  it("LABSHELF_AUTO_ARBITER=0 keeps today's BLOCKED without calling claude", async () => {
    process.env.LABSHELF_AUTO_ARBITER = "0";
    await stall();
    const result = await call();
    assert.equal(result.code, 3);
    assert.match(result.text, /BLOCKED: return report status blocked_tests/);
    assert.equal(calls().length, 0);
  });
});
