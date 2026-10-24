/**
 * @jest-environment jsdom
 */
import { DEFAULT_COLUMNS } from "../../../../src/libraryUi/store";
import { ALL_CAPABILITIES, mountForTest, paper } from "../mountHarness";

const now = new Date();
const hoursAgo = (h: number): string => new Date(now.getTime() - h * 3600_000).toISOString();

describe("row marks", () => {
  it("keeps the title cell to the title, and says when the paper was last read", () => {
    const t = mountForTest({ columns: [...DEFAULT_COLUMNS, "lastRead"] });
    t.snapshot([paper("a", "papers", { note: "check eq. 3" })], ["papers/a"], [], { a: { annotations: 4, lastPage: 7, lastRead: hoursAgo(3) } });
    const title = t.container.querySelector<HTMLElement>(".paper-row .title-cell")!;
    expect(title.children).toHaveLength(1);
    expect(title.querySelector("svg")).toBeNull();
    const read = t.container.querySelector<HTMLElement>(".paper-row .col-read")!;
    expect(read.textContent).toBe("3 h");
    expect(read.title).toMatch(/^Last read .*, page 7$/);
  });

  it("draws a state icon after the title for no text layer and for OCR in progress", () => {
    const t = mountForTest({}, ALL_CAPABILITIES);
    const scan = { state: "missing" as const, checkedAt: "" };
    t.snapshot([paper("a", "papers", { textLayer: scan }), paper("b", "papers", { textLayer: scan })], ["papers/a", "papers/b"]);
    t.host.post({ type: "jobs", jobs: [{ paperId: "b", phase: "reading", page: 2, total: 9 }] });
    const icons = [...t.container.querySelectorAll<HTMLElement>(".paper-row-main .title-cell .title-state")];
    expect(icons[0]!.classList.contains("tl-missing")).toBe(true);
    expect(icons[1]!.classList.contains("tl-busy")).toBe(true);
    expect(icons[1]!.title).toBe("Making searchable — reading page 2 of 9…");
  });

  it("sorts by Last read newest first on the first click", () => {
    const t = mountForTest({ columns: [...DEFAULT_COLUMNS, "lastRead"] });
    t.snapshot([paper("a", "papers"), paper("b", "papers"), paper("c", "papers")], [], [], {
      a: { annotations: 0, lastRead: hoursAgo(30) }, c: { annotations: 0, lastRead: hoursAgo(1) },
    });
    t.click('[data-sort="lastRead"]');
    expect(t.rowIds()).toEqual(["c", "a", "b"]);
  });
});
