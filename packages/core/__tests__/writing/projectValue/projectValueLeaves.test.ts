/** Verifies how parsed JSON flattens into keyed leaves: nesting, arrays, null and unusable keys. */
import { flattenValues } from "../../../src/writing/projectValue/index";
import { valueMembers } from "../../../src/writing/projectValue/projectValueMembers";

describe("flattenValues", () => {
  it("keys nested leaves by file name without .json and the dotted path, in document order", () => {
    const { leaves } = flattenValues("data/results.json", { acc: 0.91, model: { name: "bert", frozen: true } });
    expect(leaves).toEqual([
      { key: "results.acc", value: 0.91, file: "data/results.json", path: "acc" },
      { key: "results.model.name", value: "bert", file: "data/results.json", path: "model.name" },
      { key: "results.model.frozen", value: true, file: "data/results.json", path: "model.frozen" },
    ]);
  });

  it("numbers array items from 0 and skips null", () => {
    const { leaves } = flattenValues("r.json", { runs: [{ loss: 1 }, null, 3], gone: null });
    expect(leaves.map((leaf) => leaf.key)).toEqual(["r.runs.0.loss", "r.runs.2"]);
  });

  it("skips and reports keys with characters outside letters, digits, '.', '-' and '_'", () => {
    const { leaves, skipped } = flattenValues("r.json", { "top 1": 1, "a}b": 2, "ok-key_2": 3, "é": 4 });
    expect(leaves.map((leaf) => leaf.key)).toEqual(["r.ok-key_2"]);
    expect(skipped).toEqual(["r.top 1", "r.a}b", "r.é"]);
  });

  it("skips every key of a file whose name has an unusable character", () => {
    expect(flattenValues("my results.json", { a: 1 })).toEqual({ leaves: [], skipped: ["my results.a"] });
  });

  it("gives a scalar or empty root no leaves", () => {
    expect(flattenValues("r.json", 5).leaves).toEqual([]);
    expect(flattenValues("r.json", null).leaves).toEqual([]);
    expect(flattenValues("r.json", {}).leaves).toEqual([]);
  });
});

describe("valueMembers", () => {
  const leaves = flattenValues("r.json", { acc: 1, model: { name: "x", sizes: [1, 2] } }).leaves
    .concat(flattenValues("other.json", { z: 1 }).leaves);

  it("lists the names under a path with the leaf for values and none for objects", () => {
    expect(valueMembers(leaves, "r.json", "").map((member) => [member.name, member.leaf?.key])).toEqual([["acc", "r.acc"], ["model", undefined]]);
    expect(valueMembers(leaves, "r.json", "model").map((member) => member.name)).toEqual(["name", "sizes"]);
  });

  it("leaves out array indexes, which Typst reads with .at()", () => {
    expect(valueMembers(leaves, "r.json", "model.sizes")).toEqual([]);
  });

  it("lists nothing for an unknown file or path", () => {
    expect(valueMembers(leaves, "none.json", "")).toEqual([]);
    expect(valueMembers(leaves, "r.json", "nope")).toEqual([]);
  });
});
