/**
 * @jest-environment jsdom
 */
import { mountForTest, paper } from "../mountHarness";

const library = [
  paper("a", "papers", { title: "Alpha", year: 1999 }),
  paper("b", "papers", { title: "Beta", year: 2020 }),
  paper("c", "papers", { title: "Gamma", year: 2010 }),
];

describe("paper list rows", () => {
  it("shows Loading until the first snapshot, then one row per paper", () => {
    const t = mountForTest();
    expect(t.container.querySelector(".list-loading")).not.toBeNull();
    t.snapshot(library);
    expect(t.rowIds()).toEqual(["a", "b", "c"]);
  });

  it("keeps every row node when a refresh brings the same library", () => {
    const t = mountForTest();
    t.snapshot(library);
    const before = t.rows();
    t.snapshot(library);
    expect(t.rows()).toEqual(before);
    t.rows().forEach((row, i) => expect(row).toBe(before[i]));
  });

  it("rebuilds only the row whose paper changed", () => {
    const t = mountForTest();
    t.snapshot(library);
    const [a, b, c] = t.rows();
    t.snapshot([library[0]!, { ...library[1]!, status: "done" }, library[2]!]);
    const [a2, b2, c2] = t.rows();
    expect(a2).toBe(a);
    expect(b2).not.toBe(b);
    expect(c2).toBe(c);
  });

  it("reorders the same nodes when the sort changes", () => {
    const t = mountForTest();
    t.snapshot(library);
    const byId = new Map(t.rows().map((r) => [r.dataset["id"], r]));
    t.container.querySelector<HTMLElement>('[data-sort="year"]')!.click();
    expect(t.rowIds()).toEqual(["b", "c", "a"]);
    t.rows().forEach((row) => expect(row).toBe(byId.get(row.dataset["id"])));
  });
});

describe("column heads", () => {
  it("sort the year newest first on the first click and flip on the second", () => {
    const t = mountForTest();
    t.snapshot(library);
    const year = t.container.querySelector<HTMLElement>('[data-sort="year"]')!;
    year.click();
    expect(t.rowIds()).toEqual(["b", "c", "a"]);
    expect(t.saved.at(-1)).toEqual({ sortKey: "year", sortDir: -1 });
    year.click();
    expect(t.rowIds()).toEqual(["a", "c", "b"]);
  });

  it("sort text columns A to Z on the first click", () => {
    const t = mountForTest({ sortKey: "year", sortDir: -1 });
    t.snapshot(library);
    t.container.querySelector<HTMLElement>('[data-sort="title"]')!.click();
    expect(t.rowIds()).toEqual(["a", "b", "c"]);
  });
});
