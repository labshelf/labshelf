import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { after, before, describe, it } from "node:test";
import { cli, makeClone } from "./helpers.mjs";

const VIEW = "packages/vscode/src/spaces/view.ts";
let clone;
let bad;
let snapshotsBefore;
const snapshots = () => readdirSync(tmpdir()).filter((name) => name.startsWith("diff-gate-snap-")).length;

before(() => {
  clone = makeClone("range");
  clone.append(VIEW, "\n// eslint-disable-next-line no-console\nconsole.log('committed');\n");
  clone.write(".claude/settings.json", "{}\n");
  bad = clone.commit("introduce problems");
  // An uncommitted change that --head mode must ignore.
  clone.append("README.md", "\nuncommitted\n");
  snapshotsBefore = snapshots();
});
after(() => clone.dispose());

describe("--base / --head mode (snapshot of a commit)", () => {
  it("reports the problems the commit range introduced", () => {
    const result = cli(clone, { args: ["--base", clone.baseline, "--head", bad] });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.json.head, bad);
    assert.ok(result.kinds.includes("forbidden-path"), JSON.stringify(result.json.violations));
    assert.ok(result.kinds.includes("source-rule"), JSON.stringify(result.json.violations));
    assert.deepEqual(result.json.errors, []);
  });

  it("an empty range (same commit on both sides) is clean", () => {
    const result = cli(clone, { args: ["--base", bad, "--head", bad] });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.json.changedFiles, 0);
  });

  it("fails with exit 2 on an unknown revision", () => {
    assert.equal(cli(clone, { args: ["--base", "no-such-rev", "--head", bad] }).status, 2);
  });

  it("removes its temporary snapshots", () => {
    assert.equal(snapshots(), snapshotsBefore);
  });
});
