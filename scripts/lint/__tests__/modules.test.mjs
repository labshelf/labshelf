// Pins the package rules of scripts/lint/modules.mjs on small in-memory file graphs, and its baseline behaviour.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkBaseline, findViolations } from "../modules.mjs";

const S = "packages/core/src";

// files: path -> lines (or a file record); edges: "from -> to" pairs written with paths relative to S.
function graph(files, edges = []) {
  const record = (value) => (typeof value === "number" ? { lines: value } : value);
  return {
    files: Object.fromEntries(Object.entries(files).map(([path, value]) => [`${S}/${path}`, { lines: 100, barrel: path.endsWith("index.ts"), ...record(value) }])),
    edges: edges.map((edge) => edge.split(" -> ").map((path) => `${S}/${path}`)),
  };
}
const keys = (g, rule) => findViolations(g).violations.filter((v) => v.rule === rule).map((v) => v.path.replace(`${S}/`, ""));

test("no-index: a module folder without index.ts fails", () => {
  const g = graph({ "lib/a/x.ts": 100, "lib/a/y.ts": 100, "lib/b/index.ts": 1, "lib/b/x.ts": 100 }, ["lib/a/x.ts -> lib/a/y.ts"]);
  assert.deepEqual(keys(g, "no-index"), ["lib/a"]);
});

test("no-index: domains and runtime folders need no index.ts", () => {
  const g = graph({ "lib/x.ts": 100, "lib/node/y.ts": 100 }, ["lib/node/y.ts -> lib/x.ts"]);
  assert.deepEqual(keys(g, "no-index"), []);
});

test("hides-nothing: every member file used from outside fails, one internal file passes", () => {
  const files = { "lib/a/index.ts": 1, "lib/a/x.ts": 100, "lib/a/y.ts": 100, "lib/user.ts": 100 };
  const label = graph(files, ["lib/user.ts -> lib/a/x.ts", "lib/user.ts -> lib/a/y.ts", "lib/a/x.ts -> lib/a/y.ts"]);
  assert.deepEqual(keys(label, "hides-nothing"), ["lib/a"]);
  const hidden = graph(files, ["lib/user.ts -> lib/a/x.ts", "lib/a/x.ts -> lib/a/y.ts"]);
  assert.deepEqual(keys(hidden, "hides-nothing"), []);
});

test("hides-nothing: a file used only from a nested module counts as hidden", () => {
  const g = graph(
    { "lib/a/index.ts": 1, "lib/a/x.ts": 100, "lib/a/b/index.ts": 1, "lib/a/b/y.ts": 100, "lib/a/b/z.ts": 100, "lib/user.ts": 100 },
    ["lib/user.ts -> lib/a/x.ts", "lib/a/b/y.ts -> lib/a/b/z.ts", "lib/a/x.ts -> lib/a/b/y.ts"],
  );
  assert.deepEqual(keys(g, "hides-nothing"), []);
});

test("orphan-file: a member with no edge to another member fails; runtime subfolders are members", () => {
  const g = graph(
    { "lib/a/index.ts": 1, "lib/a/x.ts": 100, "lib/a/node/y.ts": 100, "lib/a/lonely.ts": 100, "lib/user.ts": 100 },
    ["lib/a/node/y.ts -> lib/a/x.ts", "lib/user.ts -> lib/a/lonely.ts", "lib/user.ts -> lib/a/x.ts"],
  );
  assert.deepEqual(keys(g, "orphan-file"), ["lib/a/lonely.ts"]);
});

test("orphan-file: a module with one file is not checked", () => {
  const g = graph({ "lib/a/index.ts": 1, "lib/a/x.ts": 100, "lib/user.ts": 100 }, ["lib/user.ts -> lib/a/x.ts"]);
  assert.deepEqual(keys(g, "orphan-file"), []);
});

test("misplaced: users above the parent fail with the folder to move to", () => {
  const files = { "lib/p/a/index.ts": 1, "lib/p/a/x.ts": 100, "lib/p/a/y.ts": 100, "lib/p/z.ts": 100, "lib/q/w.ts": 100, "lib/node/v.ts": 100 };
  const inside = ["lib/p/a/x.ts -> lib/p/a/y.ts"];
  const above = findViolations(graph(files, [...inside, "lib/q/w.ts -> lib/p/a/x.ts", "lib/p/z.ts -> lib/p/a/x.ts"])).violations;
  const misplaced = above.find((v) => v.rule === "misplaced");
  assert.equal(misplaced.path, `${S}/lib/p/a`);
  assert.match(misplaced.message, new RegExp(`up to ${S}/lib\\.$`));
  assert.deepEqual(keys(graph(files, [...inside, "lib/p/z.ts -> lib/p/a/x.ts"]), "misplaced"), []);
  // Runtime segments are stripped: lib/node/v.ts sits in lib, above lib/p.
  assert.deepEqual(keys(graph(files, [...inside, "lib/node/v.ts -> lib/p/a/x.ts"]), "misplaced"), ["lib/p/a"]);
});

test("misplaced: users in another domain or package are ignored", () => {
  const g = graph({ "lib/p/a/index.ts": 1, "lib/p/a/x.ts": 100, "other/u.ts": 100 }, ["other/u.ts -> lib/p/a/x.ts"]);
  assert.deepEqual(keys(g, "misplaced"), []);
});

test("cycle-with-parent: a module and a file of its parent using each other fails", () => {
  const files = { "lib/a/index.ts": 1, "lib/a/x.ts": 100, "lib/a/y.ts": 100, "lib/p.ts": 100 };
  const base = ["lib/a/x.ts -> lib/a/y.ts", "lib/p.ts -> lib/a/x.ts"];
  assert.deepEqual(keys(graph(files, [...base, "lib/a/y.ts -> lib/p.ts"]), "cycle-with-parent"), ["lib/a"]);
  assert.deepEqual(keys(graph(files, base), "cycle-with-parent"), []);
});

test("satellite: a short file used by one file in the same folder fails", () => {
  const files = { "lib/x.ts": 100, "lib/small.ts": 20, "lib/big.ts": 200, "lib/far.ts": 20, "lib/b/index.ts": 1, "lib/b/u.ts": 100 };
  const g = graph(files, ["lib/x.ts -> lib/small.ts", "lib/x.ts -> lib/big.ts", "lib/b/u.ts -> lib/far.ts"]);
  const satellites = findViolations(g).violations.filter((v) => v.rule === "satellite");
  assert.deepEqual(satellites.map((v) => v.path), [`${S}/lib/small.ts`]);
  assert.match(satellites[0].message, /lib\/x\.ts/);
});

test("shared-name: a private function named like a shared core export fails", () => {
  const g = graph({
    "hash/index.ts": { lines: 1, barrel: true, exports: ["deriveSha256Hex"] },
    "hash/contentHash.ts": { lines: 10, exports: ["deriveSha256Hex"] },
    "lib/x.ts": { lines: 100, privateFunctions: ["deriveSha256Hex", "other"] },
    "lib/y.ts": { lines: 100, privateFunctions: ["other"] },
  });
  assert.deepEqual(keys(g, "shared-name"), ["lib/x.ts"]);
});

test("latent-module: a cluster with one outside user warns, a fully connected folder does not", () => {
  const files = { "lib/a.ts": 100, "lib/b.ts": 100, "lib/c.ts": 100, "lib/d.ts": 100, "other/u.ts": 100 };
  const cluster = ["lib/a.ts -> lib/b.ts", "lib/b.ts -> lib/c.ts", "other/u.ts -> lib/a.ts"];
  const { warnings, violations } = findViolations(graph(files, cluster));
  assert.deepEqual(warnings.map((w) => [w.rule, w.path]), [["latent-module", `${S}/lib`]]);
  assert.ok(!violations.some((v) => v.rule === "latent-module"));
  const whole = findViolations(graph(files, [...cluster, "lib/c.ts -> lib/d.ts"])).warnings;
  assert.deepEqual(whole, []);
});

test("barrels are never edge endpoints", () => {
  const g = graph({ "lib/a/index.ts": 1, "lib/a/x.ts": 20, "lib/user.ts": 100 }, [
    "lib/a/index.ts -> lib/a/x.ts",
    "lib/user.ts -> lib/a/index.ts",
  ]);
  assert.deepEqual(keys(g, "satellite"), []);
  assert.deepEqual(keys(g, "hides-nothing"), []);
});

test("baseline: listed violations pass, new ones fail, entries that no longer fail are stale", () => {
  const violations = [
    { rule: "no-index", path: "packages/core/src/a/b", message: "" },
    { rule: "satellite", path: "packages/core/src/a/c.ts", message: "" },
  ];
  const result = checkBaseline(violations, ["no-index packages/core/src/a/b", "orphan-file packages/core/src/a/gone.ts"]);
  assert.deepEqual(result.failures.map((v) => v.path), ["packages/core/src/a/c.ts"]);
  assert.deepEqual(result.stale, ["orphan-file packages/core/src/a/gone.ts"]);
  assert.equal(result.baselined, 1);
});
