import type { PaperEntry } from "@labshelf/core";

import { PaperSearchIndex } from "../../src/library/paperSearchIndex";

function entry(id: string, title: string): PaperEntry {
  return { record: { id, title, path: `/lib/papers/${id}`, citeKey: id, status: "unread" }, collection: "", modifiedMs: 0 };
}

describe("PaperSearchIndex.matcher", () => {
  it("matches papers by the query language, annotation text included", () => {
    const index = new PaperSearchIndex();
    const plain = entry("p1", "Plain title");
    expect(index.matcher("entanglement")(plain)).toBe(false);
    index.setAnnotationText(new Map([["p1", "A highlight about quantum entanglement"]]));
    expect(index.matcher("entanglement")(plain)).toBe(true);
    expect(index.matcher("is:done")(plain)).toBe(false);
  });

  it("matches every paper when the query has no conditions", () => {
    const index = new PaperSearchIndex();
    expect(index.matcher("")(entry("p1", "Plain"))).toBe(true);
    expect(index.matcher("author:")(entry("p1", "Plain"))).toBe(true);
  });
});
