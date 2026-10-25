/** Verifies how the papers list follows the cited keys: additions, DOI fill, removal of cited entries only, order. */
import type { PaperRecord } from "../../../src/model/index";
import { derivePapersByCiteKey, syncListedPapers } from "../../../src/writing/citations/index";

const paper = (id: string, doi?: string): PaperRecord => ({ id, citeKey: id, title: id, path: id, status: "unread", doi });
const library = derivePapersByCiteKey([paper("a", "10.1/a"), paper("b"), paper("c", "10.1/c")]);

describe("syncListedPapers", () => {
  it("adds each cited key as a cited entry in key order, with the library DOI when there is one", () => {
    expect(syncListedPapers([], ["c", "b", "zz", "a"], library)).toEqual([
      { key: "a", doi: "10.1/a", cited: true }, { key: "b", cited: true }, { key: "c", doi: "10.1/c", cited: true },
    ]);
  });

  it("does not add a cited key with no library paper but keeps a listed one while it is cited", () => {
    expect(syncListedPapers([], ["fig:one"], library)).toBeUndefined();
    const listed = [{ key: "zz", doi: "10.9/zz", cited: true as const }];
    expect(syncListedPapers(listed, ["zz"], library)).toBeUndefined();
  });

  it("fills a missing DOI of a manual or cited entry and never changes a DOI already listed", () => {
    const listed = [{ key: "a" }, { key: "c", doi: "10.9/mine", cited: true as const }];
    expect(syncListedPapers(listed, ["c"], library)).toEqual([{ key: "a", doi: "10.1/a" }, { key: "c", doi: "10.9/mine", cited: true }]);
  });

  it("removes a cited entry that is no longer cited and keeps manual entries", () => {
    const listed = [{ key: "a", cited: true as const }, { key: "b" }, { key: "c", doi: "10.1/c", cited: true as const }];
    expect(syncListedPapers(listed, ["c"], library)).toEqual([{ key: "b" }, { key: "c", doi: "10.1/c", cited: true }]);
  });

  it("keeps existing order and appends new entries after it", () => {
    const listed = [{ key: "c", doi: "10.1/c", cited: true as const }, { key: "a", doi: "10.1/a" }];
    expect(syncListedPapers(listed, ["c", "b"], library)).toEqual([...listed, { key: "b", cited: true }]);
  });

  it("returns undefined when the list is already in sync", () => {
    const listed = [{ key: "a", doi: "10.1/a", cited: true as const }, { key: "b" }, { key: "x" }];
    expect(syncListedPapers(listed, ["a"], library)).toBeUndefined();
    expect(syncListedPapers([], [], library)).toBeUndefined();
  });

  it("does not turn a manual entry into a cited one", () => {
    expect(syncListedPapers([{ key: "b" }], ["b"], library)).toBeUndefined();
  });
});
