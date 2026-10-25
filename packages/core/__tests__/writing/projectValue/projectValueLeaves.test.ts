/** Verifies how parsed JSON flattens into keyed leaves: nesting, arrays, null and unusable keys. */
import { deriveProjectValueLeaves } from "../../../src/writing/projectValue/index";
import { deriveProjectValueMembers } from "../../../src/writing/projectValue/projectValueMembers";

describe("deriveProjectValueLeaves", () => {
  it("keys nested leaves by file name without .json and the dotted path, in document order", () => {
    const { leaves } = deriveProjectValueLeaves("data/results.json", { acc: 0.91, model: { name: "bert", frozen: true } });
    expect(leaves).toEqual([
      { key: "results.acc", value: 0.91, file: "data/results.json", path: "acc" },
      { key: "results.model.name", value: "bert", file: "data/results.json", path: "model.name" },
      { key: "results.model.frozen", value: true, file: "data/results.json", path: "model.frozen" },
    ]);
  });

  it("numbers array items from 0 and skips null", () => {
    const { leaves } = deriveProjectValueLeaves("r.json", { runs: [{ loss: 1 }, null, 3], gone: null });
    expect(leaves.map((leaf) => leaf.key)).toEqual(["r.runs.0.loss", "r.runs.2"]);
  });

  it("skips and reports keys with characters outside letters, digits, '.', '-' and '_'", () => {
    const { leaves, skipped } = deriveProjectValueLeaves("r.json", { "top 1": 1, "a}b": 2, "ok-key_2": 3, "é": 4 });
    expect(leaves.map((leaf) => leaf.key)).toEqual(["r.ok-key_2"]);
    expect(skipped).toEqual(["r.top 1", "r.a}b", "r.é"]);
  });

  it("skips every key of a file whose name has an unusable character", () => {
    expect(deriveProjectValueLeaves("my results.json", { a: 1 })).toEqual({ leaves: [], skipped: ["my results.a"] });
  });

  it("gives a scalar or empty root no leaves", () => {
    expect(deriveProjectValueLeaves("r.json", 5).leaves).toEqual([]);
    expect(deriveProjectValueLeaves("r.json", null).leaves).toEqual([]);
    expect(deriveProjectValueLeaves("r.json", {}).leaves).toEqual([]);
  });
});

describe("deriveProjectValueMembers", () => {
  const leaves = deriveProjectValueLeaves("r.json", { acc: 1, model: { name: "x", sizes: [1, 2] } }).leaves
    .concat(deriveProjectValueLeaves("other.json", { z: 1 }).leaves);

  it("lists the names under a path with the leaf for values and none for objects", () => {
    expect(deriveProjectValueMembers(leaves, "r.json", "").map((member) => [member.name, member.leaf?.key])).toEqual([["acc", "r.acc"], ["model", undefined]]);
    expect(deriveProjectValueMembers(leaves, "r.json", "model").map((member) => member.name)).toEqual(["name", "sizes"]);
  });

  it("leaves out array indexes, which Typst reads with .at()", () => {
    expect(deriveProjectValueMembers(leaves, "r.json", "model.sizes")).toEqual([]);
  });

  it("lists nothing for an unknown file or path", () => {
    expect(deriveProjectValueMembers(leaves, "none.json", "")).toEqual([]);
    expect(deriveProjectValueMembers(leaves, "r.json", "nope")).toEqual([]);
  });
});
