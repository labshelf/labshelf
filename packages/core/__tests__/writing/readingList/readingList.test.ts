/** Verifies that the reading list joins cited and added papers with the library and tells which cited ones were never opened. */
import type { PaperRecord } from "../../../src/model";
import type { Backlink } from "../../../src/writing/backlinks/index";
import { buildReadingList } from "../../../src/writing/readingList/index";

const paper = (id: string, citeKey: string): PaperRecord => ({ id, title: `T ${id}`, path: id, citeKey, status: "unread" }) as PaperRecord;
const link = (project: string): Backlink => ({ project, file: "main.tex", line: 0, section: undefined });

const library = new Map([["a", paper("pa", "a")], ["b", paper("pb", "b")], ["c", paper("pc", "c")]]);
const backlinks = new Map([["a", [link("thesis")]], ["b", [link("other")]], ["ghost", [link("thesis"), link("other")]]]);

describe("buildReadingList", () => {
  it("lists the project's cited keys, then added keys it does not cite, keeping keys the library lacks", async () => {
    const { entries } = await buildReadingList({
      project: "thesis", backlinks, listed: [{ key: "c" }, { key: "a" }, { key: "gone" }],
      papersByKey: library, isOpened: async () => true,
    });
    expect(entries.map((e) => [e.key, e.cited, e.listed, e.paper?.id])).toEqual([
      ["a", true, true, "pa"], ["ghost", true, false, undefined], ["c", false, true, "pc"], ["gone", false, true, undefined],
    ]);
  });

  it("counts cited library papers that were never opened, not added ones or unknown keys", async () => {
    const asked: string[] = [];
    const list = await buildReadingList({
      project: "thesis", backlinks, listed: [{ key: "c" }], papersByKey: library,
      isOpened: async (id) => { asked.push(id); return false; },
    });
    expect(list.neverOpened).toBe(1);
    expect(list.entries.map((e) => e.opened)).toEqual([false, false, false]);
    expect(asked.sort()).toEqual(["pa", "pc"]);
  });

  it("does not count a cited paper that was opened", async () => {
    const list = await buildReadingList({
      project: "thesis", backlinks, listed: [], papersByKey: library, isOpened: async (id) => id === "pa",
    });
    expect(list.neverOpened).toBe(0);
    expect(list.entries[0]).toMatchObject({ key: "a", opened: true });
  });
});
