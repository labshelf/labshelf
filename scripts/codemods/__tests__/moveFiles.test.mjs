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

test("a moved file that imports a file that stays gets its outward paths rewritten", () => {
  const project = createProject({
    "packages/core/src/library/store.ts": 'import { sha } from "../hash/contentHash";\nimport { shared } from "./shared";\nexport const use = [sha, shared];\n',
    "packages/core/src/library/shared.ts": "export const shared = 1;\n",
    "packages/core/src/hash/contentHash.ts": "export const sha = 1;\n",
  });
  moveFiles({ root: project.root, moves: [["packages/core/src/library/store.ts", "packages/core/src/library/papers/store.ts"]], log: quiet });

  const store = project.read("packages/core/src/library/papers/store.ts");
  assert.match(store, /from "\.\.\/\.\.\/hash\/contentHash";/);
  assert.match(store, /from "\.\.\/shared";/);
});

test("jest.mock in a test that stays follows the moved source", () => {
  const project = createProject({
    "packages/core/src/hash/contentHash.ts": "export const sha = 1;\n",
    "packages/core/__tests__/other/uses.test.ts": 'jest.mock("../../src/hash/contentHash", () => ({}));\nconst actual = jest.requireActual("../../src/hash/contentHash");\nexport { actual };\n',
  });
  moveFiles({ root: project.root, moves: [["packages/core/src/hash/contentHash.ts", "packages/core/src/digest/digest.ts"]], log: quiet });

  const test = project.read("packages/core/__tests__/other/uses.test.ts");
  assert.match(test, /jest\.mock\("\.\.\/\.\.\/src\/digest\/digest"/);
  assert.match(test, /requireActual\("\.\.\/\.\.\/src\/digest\/digest"\)/);
});

test("tsx files and CSS imports are rewritten", () => {
  const project = createProject({
    "packages/core/src/ui/panel/Panel.tsx": 'import "./panel.css";\nimport { sha } from "../../hash/contentHash";\nexport const Panel = () => <div>{sha}</div>;\n',
    "packages/core/src/ui/panel/panel.css": '@import "../base.css";\n.panel { background: url("../icons/icon.svg"); }\n',
    "packages/core/src/ui/base.css": ".base {}\n",
    "packages/core/src/ui/icons/icon.svg": "<svg/>\n",
    "packages/core/src/hash/contentHash.ts": "export const sha = 1;\n",
    "packages/core/src/ui/index.tsx": 'export { Panel } from "./panel/Panel";\n',
  });
  moveFiles({ root: project.root, moves: [["packages/core/src/ui/panel", "packages/core/src/ui/layout/panel"]], log: quiet });

  const panel = project.read("packages/core/src/ui/layout/panel/Panel.tsx");
  assert.match(panel, /import "\.\/panel\.css";/);
  assert.match(panel, /from "\.\.\/\.\.\/\.\.\/hash\/contentHash";/);
  const css = project.read("packages/core/src/ui/layout/panel/panel.css");
  assert.match(css, /@import "\.\.\/\.\.\/base\.css";/);
  assert.match(css, /url\("\.\.\/\.\.\/icons\/icon\.svg"\)/);
  assert.equal(project.read("packages/core/src/ui/index.tsx"), 'export { Panel } from "./layout/panel/Panel";\n');
});

const leftoverProject = () =>
  createProject({
    "packages/core/src/reader/index.ts": "export const core = 1;\n",
    "packages/core/package.json": '{ "exports": { "./reader": "./src/reader/index.ts" } }\n',
    "packages/vscode/src/reader/main.ts": "export const main = 1;\n",
    "packages/vscode/src/reader/index.ts": 'export * from "./main.js";\n',
    "packages/vscode/src/extension.ts": 'export * from "./reader/index.js";\n',
    "packages/vscode/build/webviews.mjs": 'export const entries = { "reader/reader": "src/reader/main.ts" };\n',
    "packages/vscode/build/host.mjs": 'export const host = resolve(pkgRoot, "../core/src/reader/index.ts");\n',
    "packages/browser/jest.config.cjs": 'module.exports = { moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/reader/$1" } };\n',
    "knip.json": '{ "entry": ["packages/vscode/src/reader/main.ts"] }\n',
  });

test("a moved folder referenced as a string in a build script is reported", () => {
  const project = leftoverProject();
  const logs = [];
  moveFiles({ root: project.root, moves: [["packages/vscode/src/reader", "packages/vscode/src/readerView"]], log: (line) => logs.push(line) });

  const report = logs.join("\n");
  assert.match(report, /packages\/vscode\/build\/webviews\.mjs:1:/);
  assert.match(report, /knip\.json/);
  assert.equal(project.read("packages/vscode/src/extension.ts"), 'export * from "./readerView/index.js";\n');
});

test("a sibling-form path (../core/src/x) in another package's build script is reported", () => {
  const project = leftoverProject();
  const logs = [];
  moveFiles({ root: project.root, moves: [["packages/core/src/reader", "packages/core/src/readerView"]], log: (line) => logs.push(line) });

  assert.match(logs.join("\n"), /packages\/vscode\/build\/host\.mjs:1:/);
  assert.match(logs.join("\n"), /packages\/core\/package\.json/);
});

test("a same-named path in another package is not reported", () => {
  const project = leftoverProject();
  const logs = [];
  moveFiles({ root: project.root, moves: [["packages/vscode/src/reader", "packages/vscode/src/readerView"]], log: (line) => logs.push(line) });

  const report = logs.join("\n");
  assert.ok(!report.includes("packages/core/package.json"), "core's own src/reader is not vscode's");
  assert.ok(!report.includes("packages/browser/jest.config.cjs"), "browser's src/reader is not vscode's");
  assert.ok(!report.includes("packages/vscode/build/host.mjs"), "core/src/reader is not vscode/src/reader");
});
