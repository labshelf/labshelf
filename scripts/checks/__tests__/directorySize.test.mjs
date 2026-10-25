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

test("index.ts and declaration files do not count as source files", () => {
  const root = project({ "packages/core/src/ok": [...files(25), "index.ts", "types.d.ts"] });
  assert.deepEqual(findProblems(root), []);
});

const VOCABULARY = "features:\n  readingStatus: { def: x, home: [\"library/readingStatus/**\"] }\n  space: { def: x, home: [\"**/spaces/**\"] }\n";

test("a nested subfolder with fewer than 2 source files fails", () => {
  const root = project({ "packages/core/src/library/small": ["index.ts", "one.ts"], "packages/core/src/library/full": files(2) });
  const problems = findProblems(root);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /packages\/core\/src\/library\/small holds 1 source files/);
});

test("a domain folder (top level under src) with 1 source file passes", () => {
  assert.deepEqual(findProblems(project({ "packages/core/src/hash": ["index.ts", "contentHash.ts"] })), []);
});

test("a feature home folder declared in vocabulary.yaml passes with 1 source file, other siblings still fail", () => {
  const root = project({
    "scripts/checks": ["vocabulary.yaml"],
    "packages/core/src/library/readingStatus": ["index.ts", "readingStatus.ts"],
    "packages/core/src/library/other": ["index.ts", "one.ts"],
    "packages/vscode/src/library/spaces/overview": ["index.ts", "one.ts"],
    "packages/vscode/src/spaces": ["one.ts"],
  });
  writeFileSync(join(root, "scripts/checks/vocabulary.yaml"), VOCABULARY);
  const problems = findProblems(root);
  assert.equal(problems.length, 2);
  assert.match(problems.join("\n"), /library\/other holds 1/);
  assert.match(problems.join("\n"), /spaces\/overview holds 1/);
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
