import { relocatePapersUnder, removePapersUnder, type IPaperRecordIndex, type PaperRecord } from "@labshelf/core";

function indexOf(paths: Record<string, string>): { index: IPaperRecordIndex; records: Map<string, PaperRecord> } {
  const records = new Map(Object.entries(paths).map(([id, path]) => [id, { id, path } as PaperRecord]));
  const index: IPaperRecordIndex = {
    listPapers: async () => [...records.values()],
    upsertPaper: async (paper) => { records.set(paper.id, paper); },
    deletePaper: async (id) => { records.delete(id); },
  };
  return { index, records };
}

describe("relocatePapersUnder", () => {
  it("re-roots papers under the old folder and leaves a sibling with the same prefix alone", async () => {
    const { index, records } = indexOf({ a: "papers/ml/a", b: "papers/ml/deep/b", c: "papers/ml2/c" });
    await relocatePapersUnder(index, "papers/ml", "papers/ai");
    expect(records.get("a")?.path).toBe("papers/ai/a");
    expect(records.get("b")?.path).toBe("papers/ai/deep/b");
    expect(records.get("c")?.path).toBe("papers/ml2/c");
  });
});

describe("removePapersUnder", () => {
  it("deletes only the records beneath the folder", async () => {
    const { index, records } = indexOf({ a: "papers/ml/a", b: "papers/ml/deep/b", c: "papers/ml2/c" });
    await removePapersUnder(index, "papers/ml");
    expect([...records.keys()]).toEqual(["c"]);
  });
});
