import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { moveFiles } from "../moveFiles.mjs";
import { createProject } from "./fixture.mjs";

const quiet = () => {};

const baseFiles = () => ({
  "packages/core/src/hash/contentHash.ts": 'export const sha = (text: string) => text;\n',
  "packages/core/src/hash/index.ts": 'export { sha } from "./contentHash.js";\n',
  "packages/core/src/index.ts": 'export * from "./hash/index.js";\n',
  "packages/core/src/library/store.ts": 'import { sha } from "../hash";\nimport { sha as again } from "../hash/contentHash";\nexport const use = [sha, again];\nexport const lazy = () => import("../hash/contentHash.js");\n',
  "packages/core/__tests__/hash/contentHash.test.ts": 'import { sha } from "../../src/hash/contentHash";\njest.mock("../../src/hash/contentHash", () => ({}));\nexport { sha };\n',
  "packages/core/package.json": '{ "exports": { "./hash": "./src/hash/index.ts" } }\n',
  "website/src/page.ts": 'import { sha } from "../../packages/core/src/hash/contentHash";\nexport { sha };\n',
});

test("a file move updates importers, the barrel, jest.mock and website imports", () => {
  const project = createProject(baseFiles());
  moveFiles({ root: project.root, moves: [["packages/core/src/hash/contentHash.ts", "packages/core/src/hash/digest.ts"]], log: quiet });

  assert.ok(existsSync(join(project.root, "packages/core/src/hash/digest.ts")));
  assert.ok(!existsSync(join(project.root, "packages/core/src/hash/contentHash.ts")));
  assert.equal(project.read("packages/core/src/hash/index.ts"), 'export { sha } from "./digest.js";\n');
  const store = project.read("packages/core/src/library/store.ts");
  assert.match(store, /from "\.\.\/hash";/);
  assert.match(store, /from "\.\.\/hash\/digest";/);
  assert.match(store, /import\("\.\.\/hash\/digest\.js"\)/);
  assert.equal(project.read("website/src/page.ts"), 'import { sha } from "../../packages/core/src/hash/digest";\nexport { sha };\n');
});

test("a test file follows its source and keeps pointing at it", () => {
  const project = createProject(baseFiles());
  moveFiles({ root: project.root, moves: [["packages/core/src/hash/contentHash.ts", "packages/core/src/digest/digest.ts"]], log: quiet });

  const test = project.read("packages/core/__tests__/digest/digest.test.ts");
  assert.ok(!existsSync(join(project.root, "packages/core/__tests__/hash/contentHash.test.ts")));
  assert.match(test, /from "\.\.\/\.\.\/src\/digest\/digest";/);
  assert.match(test, /jest\.mock\("\.\.\/\.\.\/src\/digest\/digest"/);
  assert.equal(project.read("packages/core/src/hash/index.ts"), 'export { sha } from "../digest/digest.js";\n');
});

test("a folder move rewrites directory imports, the moved barrel and the mirrored tests", () => {
  const project = createProject(baseFiles());
  const logs = [];
  moveFiles({ root: project.root, moves: [["packages/core/src/hash", "packages/core/src/crypto/hash"]], log: (line) => logs.push(line) });

  assert.ok(existsSync(join(project.root, "packages/core/src/crypto/hash/index.ts")));
  assert.ok(!existsSync(join(project.root, "packages/core/src/hash")));
  assert.equal(project.read("packages/core/src/index.ts"), 'export * from "./crypto/hash/index.js";\n');
  const store = project.read("packages/core/src/library/store.ts");
  assert.match(store, /from "\.\.\/crypto\/hash";/);
  assert.match(store, /from "\.\.\/crypto\/hash\/contentHash";/);
  assert.match(project.read("packages/core/__tests__/crypto/hash/contentHash.test.ts"), /from "\.\.\/\.\.\/\.\.\/src\/crypto\/hash\/contentHash";/);
  assert.equal(project.read("packages/core/src/crypto/hash/index.ts"), 'export { sha } from "./contentHash.js";\n');
  assert.ok(logs.some((line) => line.includes("packages/core/package.json")), "reports the package.json exports entry it cannot rewrite");
});

test("a move onto an existing file fails before touching anything", () => {
  const project = createProject(baseFiles());
  assert.throws(
    () => moveFiles({ root: project.root, moves: [["packages/core/src/hash/contentHash.ts", "packages/core/src/hash/index.ts"]], log: quiet }),
    /already exists/,
  );
  assert.ok(existsSync(join(project.root, "packages/core/src/hash/contentHash.ts")));
});
