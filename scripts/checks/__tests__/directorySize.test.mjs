import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { findProblems } from "../directorySize.mjs";

function project(folders) {
  const root = mkdtempSync(join(tmpdir(), "dirsize-"));
  for (const [folder, names] of Object.entries(folders)) {
    mkdirSync(join(root, folder), { recursive: true });
    for (const name of names) {
      mkdirSync(dirname(join(root, folder, name)), { recursive: true });
      writeFileSync(join(root, folder, name), "");
    }
  }
  return root;
}

const files = (count) => Array.from({ length: count }, (_, i) => `file${i}.ts`);

test("a folder with more than 25 source files fails, 25 passes", () => {
  assert.equal(findProblems(project({ "packages/core/src/big": files(26) })).length, 1);
  assert.deepEqual(findProblems(project({ "packages/core/src/ok": files(25) })), []);
});

test("index.ts, declaration files and tests do not count as source files", () => {
  const root = project({ "packages/core/src/ok": [...files(25), "index.ts", "types.d.ts"] });
  assert.deepEqual(findProblems(root), []);
});

test("a non-runtime subfolder with fewer than 2 source files fails", () => {
  const root = project({ "packages/core/src/hash": ["index.ts", "contentHash.ts"], "packages/core/src/full": files(2) });
  const problems = findProblems(root);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /packages\/core\/src\/hash holds 1 source files/);
});

test("runtime folders, the src root and folders that only group subfolders are exempt", () => {
  const root = project({
    "packages/core/src/library/node": ["only.ts"],
    "packages/core/src/library": [...files(2)],
    "packages/core/src/writing/typst": files(3),
    "packages/core/src/writing/latex": files(3),
    "packages/core/src": ["index.ts"],
  });
  assert.deepEqual(findProblems(root), []);
});
