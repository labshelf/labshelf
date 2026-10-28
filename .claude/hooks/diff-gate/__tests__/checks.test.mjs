import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, describe, it } from "node:test";
import { cli, hook, lines, makeClone } from "./helpers.mjs";

const VIEW = "packages/vscode/src/spaces/view.ts";
const FOLDERS = "packages/core/src/library/folders.ts";
let clone;

// A copy of the 18-line createConcurrencyLimit function under another name (syntactically complete, so jscpd can tokenize it).
function copyOfLimit(name) {
  const body = lines(clone.dir, FOLDERS, 35, 52).replace("createConcurrencyLimit", `create${name}`).replace(/Limiter/g, `${name}Limiter`);
  return `type ${name}Limiter = <T>(task: () => Promise<T>) => Promise<T>;\n${body}`;
}

before(() => {
  clone = makeClone("checks");
  // Problems that already exist in the baseline commit: an unused file with an eslint-disable and an unused export.
  clone.write("packages/vscode/src/spaces/legacyOrphan.ts", "// eslint-disable-next-line no-console\nexport const legacyOrphan = 1;\n");
  clone.append(VIEW, "\nexport const legacyDeadExport = 1;\n");
  clone.commit("pre-existing problems");
});
after(() => clone.dispose());
afterEach(() => clone.reset());

describe("diff checks through the CLI", () => {
  it("a clean (empty) diff reports nothing", () => {
    const result = cli(clone);
    assert.equal(result.status, 0);
    assert.deepEqual(result.kinds, []);
  });

  it("blocks a new unused export on an added line", () => {
    clone.append(VIEW, "\nexport const freshDeadExport = 2;\n");
    const result = cli(clone, { checks: "knip" });
    assert.equal(result.status, 1);
    const hit = result.json.violations.find((v) => v.kind === "unused-export");
    assert.ok(hit, JSON.stringify(result.json));
    assert.match(hit.message, /freshDeadExport/);
    assert.equal(result.json.violations.length, 1, "the pre-existing legacyDeadExport must not be reported");
  });

  it("blocks a new file that nothing imports", () => {
    clone.write("packages/vscode/src/spaces/orphanFresh.ts", "export const orphanFresh = 3;\n");
    const result = cli(clone, { checks: "knip" });
    assert.ok(result.kinds.includes("unused-file"), JSON.stringify(result.json));
  });

  it("blocks a copy of an 18-line function", () => {
    clone.write("packages/core/src/library/copyLimit.ts", copyOfLimit("Other"));
    const result = cli(clone, { checks: "jscpd" });
    assert.equal(result.status, 1);
    const hit = result.json.violations.find((v) => v.kind === "clone");
    assert.ok(hit, JSON.stringify(result.json));
    assert.equal(hit.file, "packages/core/src/library/copyLimit.ts");
    assert.match(hit.message, /folders\.ts:35-52/);
  });

  it("blocks an added eslint-disable", () => {
    clone.append(VIEW, "\n// eslint-disable-next-line no-console\nconsole.log('x');\n");
    const result = cli(clone, { checks: "rules" });
    assert.equal(result.status, 1);
    assert.ok(result.kinds.includes("source-rule"), JSON.stringify(result.json));
  });

  it("blocks an edit of .claude/settings.json", () => {
    clone.write(".claude/settings.json", "{}\n");
    const result = cli(clone, { checks: "forbidden" });
    assert.deepEqual(result.kinds, ["forbidden-path"]);
    assert.match(result.json.violations[0].fix, /revert it; do not edit lint, hook or tooling config/);
  });

  it("blocks a package.json scripts edit but not another package.json edit", () => {
    const pkg = JSON.parse(lines(clone.dir, "package.json", 1, 100000));
    clone.write("package.json", `${JSON.stringify({ ...pkg, description: "changed" }, null, 2)}\n`);
    assert.deepEqual(cli(clone, { checks: "forbidden" }).kinds, []);
    clone.write("package.json", `${JSON.stringify({ ...pkg, scripts: { ...pkg.scripts, lint: "true" } }, null, 2)}\n`);
    assert.deepEqual(cli(clone, { checks: "forbidden" }).kinds, ["forbidden-script"]);
  });

  it("passes pre-existing problems the diff does not touch", () => {
    clone.append("README.md", "\nunrelated line\n");
    const result = cli(clone);
    assert.equal(result.status, 0, JSON.stringify(result.json?.violations));
    assert.deepEqual(result.kinds, []);
  });

  it("one tool crash drops that tool only; the other checks still report", () => {
    const tools = mkdtempSync(join(tmpdir(), "diff-gate-tools-"));
    mkdirSync(join(tools, "node_modules/.bin"), { recursive: true });
    writeFileSync(join(tools, "node_modules/.bin/knip"), "#!/bin/sh\necho 'boom: not json'\nexit 3\n");
    chmodSync(join(tools, "node_modules/.bin/knip"), 0o755);
    symlinkSync(join(clone.dir, "node_modules/.bin/jscpd"), join(tools, "node_modules/.bin/jscpd"));
    clone.write(".claude/settings.json", "{}\n");
    clone.write("packages/core/src/library/crashCopy.ts", copyOfLimit("Crash"));
    const result = cli(clone, { env: { DIFF_GATE_TOOLS_ROOT: tools } });
    assert.ok(result.json.errors.some((e) => e.startsWith("knip:")), JSON.stringify(result.json.errors));
    assert.ok(!result.kinds.includes("unused-file") && !result.kinds.includes("unused-export"));
    assert.ok(result.kinds.includes("forbidden-path"));
    assert.ok(result.kinds.includes("clone"));
  });

  it("an internal error of the whole hook process is silent and exits 0", () => {
    const runs = [hook(clone, { raw: "not json at all" }), hook(clone, { input: { cwd: "/nonexistent/dir/for/diff-gate" } })];
    for (const run of runs) {
      assert.equal(run.status, 0);
      assert.equal(run.stdout, "");
    }
  });
});
