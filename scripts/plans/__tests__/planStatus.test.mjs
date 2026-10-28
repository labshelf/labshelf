import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { saveSession } from "../planFiles.mjs";
import { planNew } from "../planNew.mjs";
import { planStatus } from "../planStatus.mjs";

const cli = fileURLToPath(new URL("../plan.mjs", import.meta.url));

let root;
let counter = 0;
before(() => {
  root = mkdtempSync(join(tmpdir(), "plan-status-"));
});
after(() => rmSync(root, { recursive: true, force: true }));

const write = (base, rel, text) => {
  mkdirSync(dirname(join(base, rel)), { recursive: true });
  writeFileSync(join(base, rel), text);
};
const fresh = () => join(root, `case-${counter++}`);

describe("planStatus for .md plans", () => {
  it("counts checklist lines and picks the next row from the numerically first open session", () => {
    const base = fresh();
    write(base, "documents/plans/old/plan.md", "# Plan\n\nStatus: in progress\n");
    write(base, "documents/plans/old/sessions/10.md", "| 10.1 | Late step | [ ] |\n");
    write(base, "documents/plans/old/sessions/2.md", "| 2.1 | Done step | [x] |\n| 2.2 | Early step | [ ] |\n");
    assert.deepEqual(planStatus(base), ["  - documents/plans/old: 2/3 open · status: in progress · next: 2.2 Early step"]);
  });

  it("skips sessions without an open row", () => {
    const base = fresh();
    write(base, "documents/plans/p/plan.md", "Status: approved\n");
    write(base, "documents/plans/p/sessions/1.md", "| 1.1 | Done | [x] |\n");
    write(base, "documents/plans/p/sessions/2.md", "| 2.1 | Open | [ ] |\n");
    assert.deepEqual(planStatus(base), ["  - documents/plans/p: 1/2 open · status: approved · next: 2.1 Open"]);
  });

  it("omits status and next when there are none, and cuts next at 90 characters", () => {
    const base = fresh();
    write(base, "documents/plans/a/plan.md", "# Plan\n");
    write(base, "documents/plans/b/plan.md", "Status: draft\n");
    write(base, "documents/plans/b/sessions/1.md", `| 1.1 | ${"x".repeat(200)} | [ ] |\n`);
    const [a, b] = planStatus(base);
    assert.equal(a, "  - documents/plans/a: 0/0 open");
    assert.equal(b, `  - documents/plans/b: 1/1 open · status: draft · next: ${`1.1 ${"x".repeat(200)}`.slice(0, 90)}`);
  });

  it("ignores TEMPLATE and folders without a plan", () => {
    const base = fresh();
    write(base, "documents/plans/TEMPLATE/plan.md", "Status: draft\n");
    write(base, "documents/plans/empty/log.md", "x\n");
    assert.deepEqual(planStatus(base), []);
  });

  it("is empty without a documents/plans folder", () => {
    assert.deepEqual(planStatus(fresh()), []);
  });
});

describe("planStatus for YAML plans", () => {
  it("counts sessions by status and names the first runnable one", () => {
    const base = fresh();
    const dir = planNew(base, { slug: "demo", level: "N2", title: "Demo" });
    saveSession(dir, { id: "1", goal: "First", depends_on: [], owns: [], status: "done", packages: [] });
    saveSession(dir, { id: "2", goal: "Second", depends_on: ["1"], owns: [], status: "pending", packages: [] });
    saveSession(dir, { id: "10", goal: "Tenth", depends_on: ["2"], owns: [], status: "pending", packages: [] });
    assert.deepEqual(planStatus(base), ["  - documents/plans/demo: 2/3 open · status: draft · next: 2 Second"]);
  });

  it("has no next when every session is done", () => {
    const base = fresh();
    const dir = planNew(base, { slug: "demo", level: "N2" });
    saveSession(dir, { id: "1", goal: "g", depends_on: [], owns: [], status: "done", packages: [] });
    assert.deepEqual(planStatus(base), ["  - documents/plans/demo: 0/1 open · status: draft"]);
  });

  it("reports an unreadable plan on its own line instead of throwing", () => {
    const base = fresh();
    const dir = planNew(base, { slug: "demo", level: "N2" });
    writeFileSync(join(dir, "sessions", "1.yaml"), "schema: session/v1\n");
    const [line] = planStatus(base);
    assert.match(line, /^ {2}- documents\/plans\/demo: unreadable \(/);
  });
});

describe("plan status command", () => {
  it("prints the lines of the current repository", () => {
    const result = spawnSync("node", [cli, "status"], { encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /^ {2}- documents\/plans\/.+: \d+\/\d+ open/m);
  });
});
