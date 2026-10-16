/**
 * @jest-environment jsdom
 */
import { ALL_CAPABILITIES, mountForTest, paper } from "../mountHarness";

const now = new Date();
const hoursAgo = (h: number): string => new Date(now.getTime() - h * 3600_000).toISOString();

describe("row marks", () => {
  it("shows up to three tag chips and a +N chip naming the rest, and a chip click searches its tag", () => {
    const t = mountForTest();
    t.snapshot([paper("a", "papers", { tags: ["nlp", "vision", "graphs", "rl", "Deep learning"] })]);
    const chips = [...t.container.querySelectorAll<HTMLElement>(".row-tag")];
    expect(chips.map((c) => c.textContent)).toEqual(["nlp", "vision", "graphs", "+2"]);
    expect(chips[3]!.title).toBe("rl, Deep learning");
    chips[1]!.click();
    expect(t.lib.store.get().query).toBe("tag:vision");
  });

  it("marks annotations and a note, and says when the paper was last read", () => {
    const t = mountForTest();
    t.snapshot([paper("a", "papers", { note: "check eq. 3" })], [], [], { a: { annotations: 4, lastPage: 7, lastRead: hoursAgo(3) } });
    const marks = [...t.container.querySelectorAll<HTMLElement>(".row-mark")];
    expect(marks.map((m) => m.title)).toEqual(["4 annotations", "Has a note"]);
    const read = t.container.querySelector<HTMLElement>(".paper-row .col-read")!;
    expect(read.textContent).toBe("3 h");
    expect(read.title).toMatch(/^Last read .*, page 7$/);
  });

  it("draws the type icon for no text layer and for OCR in progress", () => {
    const t = mountForTest({}, ALL_CAPABILITIES);
    const scan = { state: "missing" as const, checkedAt: "" };
    t.snapshot([paper("a", "papers", { textLayer: scan }), paper("b", "papers", { textLayer: scan })], ["papers/a", "papers/b"]);
    t.host.post({ type: "jobs", jobs: [{ paperId: "b", phase: "reading", page: 2, total: 9 }] });
    const icons = [...t.container.querySelectorAll<HTMLElement>(".paper-row-main .paper-type-icon")];
    expect(icons[0]!.classList.contains("tl-missing")).toBe(true);
    expect(icons[1]!.classList.contains("tl-busy")).toBe(true);
    expect(icons[1]!.title).toBe("Making searchable — reading page 2 of 9…");
  });

  it("sorts by Last read newest first on the first click", () => {
    const t = mountForTest();
    t.snapshot([paper("a", "papers"), paper("b", "papers"), paper("c", "papers")], [], [], {
      a: { annotations: 0, lastRead: hoursAgo(30) }, c: { annotations: 0, lastRead: hoursAgo(1) },
    });
    t.click('[data-sort="lastRead"]');
    expect(t.rowIds()).toEqual(["c", "a", "b"]);
  });
});
