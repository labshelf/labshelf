import assert from "node:assert/strict";
import { test } from "node:test";
import { renameSymbol } from "../renameSymbol.mjs";
import { createProject } from "./fixture.mjs";

test("a symbol rename updates the declaration, barrels and importers", () => {
  const project = createProject({
    "packages/core/src/hash/contentHash.ts": "export function sha(text: string): string {\n  return text;\n}\nexport const table = { sha };\n",
    "packages/core/src/hash/index.ts": 'export { sha } from "./contentHash.js";\n',
    "packages/core/src/library/store.ts": 'import { sha } from "../hash/index.js";\nexport const id = sha("a");\n',
    "packages/core/__tests__/hash/contentHash.test.ts": 'import { sha } from "../../src/hash/contentHash";\nexport const check = sha("b");\n',
    "packages/core/src/other.ts": "export const sha = 1;\n",
  });
  const logs = [];
  renameSymbol({ root: project.root, file: "packages/core/src/hash/contentHash.ts", oldName: "sha", newName: "sha256Hex", log: (line) => logs.push(line) });

  assert.match(project.read("packages/core/src/hash/contentHash.ts"), /export function sha256Hex\(/);
  assert.match(project.read("packages/core/src/hash/contentHash.ts"), /table = \{ sha: sha256Hex \}/, "shorthand property keeps its key");
  assert.equal(project.read("packages/core/src/hash/index.ts"), 'export { sha256Hex } from "./contentHash.js";\n');
  assert.equal(project.read("packages/core/src/library/store.ts"), 'import { sha256Hex } from "../hash/index.js";\nexport const id = sha256Hex("a");\n');
  assert.match(project.read("packages/core/__tests__/hash/contentHash.test.ts"), /import \{ sha256Hex \}[^;]*;\nexport const check = sha256Hex\("b"\)/);
  assert.equal(project.read("packages/core/src/other.ts"), "export const sha = 1;\n", "an unrelated symbol of the same name is untouched");
});

test("renaming a symbol the file does not export fails", () => {
  const project = createProject({ "packages/core/src/a.ts": "const hidden = 1;\nexport const shown = hidden;\n" });
  assert.throws(() => renameSymbol({ root: project.root, file: "packages/core/src/a.ts", oldName: "hidden", newName: "x", log: () => {} }), /does not export/);
});
