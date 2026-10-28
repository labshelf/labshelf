// `plan tests <session> <id>`: writes one failing skeleton per acceptance id into the spec's hidden test file.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, join, posix } from "node:path";
import { findSpec } from "./planFiles.mjs";
import { parseSeam } from "./planStubs.mjs";

/** Where each hidden test of a spec lives: `[{ from, to }]` with `from` the hidden path and `to` the in-repo path `plan start` copies it to. */
export function hiddenTargets(spec) {
  if (!spec.tests || !Array.isArray(spec.tests.hidden)) throw new Error(`spec ${spec.id} has no hidden tests (tests: none)`);
  const prefix = `documents/plans/${spec.plan}/tests/${spec.id}/`;
  return spec.tests.hidden.map((from) => {
    if (!from.startsWith(prefix)) throw new Error(`spec ${spec.id}: hidden test ${from} is not under ${prefix}`);
    return { from, to: from.slice(prefix.length) };
  });
}

const importPath = (testFile, seamFile, ts) => {
  const relative = posix.relative(posix.dirname(testFile), seamFile);
  const target = ts ? relative.replace(/\.tsx?$/, "") : relative;
  return target.startsWith(".") ? target : `./${target}`;
};

/** Source of the skeleton for the test that will live at `testFile`: names `A<n> <check>`, body fails with a TODO assertion. */
export function skeletonSource(spec, testFile) {
  const ts = [".ts", ".tsx"].includes(extname(testFile));
  if (!ts && ![".mjs", ".js"].includes(extname(testFile))) throw new Error(`spec ${spec.id}: cannot write a skeleton for ${testFile}`);
  const byFile = new Map();
  for (const seam of spec.seams ?? []) {
    const { kind, name } = parseSeam(seam);
    if (kind === "type" || kind === "interface") continue;
    byFile.set(seam.path, [...(byFile.get(seam.path) ?? []), name]);
  }
  const imports = [...byFile].map(([file, names]) => `import { ${names.join(", ")} } from ${JSON.stringify(importPath(testFile, file, ts))};`);
  const cases = spec.acceptance.map((item) => {
    const title = JSON.stringify(`${item.id} ${item.check}`);
    return ts
      ? `  it(${title}, () => {\n    throw new Error("TODO: " + ${title});\n  });`
      : `  it(${title}, () => {\n    assert.fail("TODO: " + ${title});\n  });`;
  });
  const head = ts ? [] : ['import assert from "node:assert/strict";', 'import { describe, it } from "node:test";'];
  return `${[...head, ...imports].join("\n")}\n\ndescribe(${JSON.stringify(`${spec.id} ${spec.goal}`)}, () => {\n${cases.join("\n\n")}\n});\n`;
}

/** Writes the skeleton into the first hidden test path of the spec; returns that path. Throws when the file exists. */
export function planTests(root, { planDir, sessionId, specId }) {
  const spec = findSpec(planDir, sessionId, specId);
  const [target] = hiddenTargets(spec);
  if (!target) throw new Error(`spec ${specId}: tests.hidden is empty`);
  const file = join(root, target.from);
  if (existsSync(file)) throw new Error(`plan tests: ${target.from} already exists`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, skeletonSource(spec, target.to));
  return target.from;
}
