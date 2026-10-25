import { resolveReferences, type PaperRecord } from "@labshelf/core";

describe("resolvePaperRefs", () => {
  it("returns found papers in id order and a failure for each unknown id", async () => {
    const record = { id: "a", path: "/lib/papers/a" } as PaperRecord;
    const index = new Map([["a", { path: "/lib/papers/a", record }], ["b", { path: "/lib/papers/ML/b" }]]);

    const outcome = await resolveReferences(["b", "ghost", "a"], async (id) => index.get(id));

    expect(outcome.refs).toEqual([{ id: "b", path: "/lib/papers/ML/b" }, { id: "a", path: "/lib/papers/a", record }]);
    expect(outcome.failed).toEqual([{ id: "ghost", error: "Paper not found" }]);
  });

  it("asks the lookup once per id, in order", async () => {
    const lookup = jest.fn(async (id: string) => (id === "x" ? undefined : { path: `/p/${id}` }));
    await resolveReferences(["x", "y"], lookup);
    expect(lookup.mock.calls.map(([id]) => id)).toEqual(["x", "y"]);
  });
});
