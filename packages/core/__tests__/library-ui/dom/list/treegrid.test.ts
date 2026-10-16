/**
 * @jest-environment jsdom
 */
// Tests the list as an ARIA treegrid: column heads, row roles, selection, expansion and keyboard navigation.
import { mountForTest, paper } from "../mountHarness";

const library = [
  paper("a", "papers", { title: "Alpha", year: 1999, tags: ["nlp"] }),
  paper("b", "papers", { title: "Beta", year: 2020 }),
  paper("c", "papers", { title: "Gamma", year: 2010 }),
];
const PDFS = ["papers/a", "papers/b", "papers/c"];

type T = ReturnType<typeof mountForTest>;
const mounted = (): T => { const t = mountForTest(); t.snapshot(library, PDFS); return t; };
const heads = (t: T): HTMLElement[] => [...t.container.querySelectorAll<HTMLElement>('[role="columnheader"]')];
const mains = (t: T): HTMLElement[] => [...t.container.querySelectorAll<HTMLElement>('[role="row"][aria-level="1"]')];
const childRows = (t: T): HTMLElement[] => [...t.container.querySelectorAll<HTMLElement>('[role="row"][aria-level="2"]')];
const head = (t: T, name: string): HTMLElement => heads(t).find((h) => h.textContent?.trim() === name)!;
const tabStops = (t: T): HTMLElement[] => [...t.container.querySelectorAll<HTMLElement>('[role="row"][tabindex="0"]')];

describe("A1 column heads", () => {
  it("are Title, Authors, Year, Last read, Status and no Publication", () => {
    const t = mounted();
    expect(heads(t).map((h) => h.textContent?.trim())).toEqual(["Title", "Authors", "Year", "Last read", "Status"]);
  });

  it("sets aria-sort on the clicked head, none on the others, and flips on a second click", () => {
    const t = mounted();
    head(t, "Year").click();
    expect(head(t, "Year").getAttribute("aria-sort")).toBe("descending");
    for (const name of ["Title", "Authors", "Last read", "Status"]) expect(head(t, name).getAttribute("aria-sort")).toBe("none");
    head(t, "Year").click();
    expect(head(t, "Year").getAttribute("aria-sort")).toBe("ascending");
  });

  it("puts no tag chip, location chip or version chip in a row", () => {
    const t = mounted();
    expect(t.container.querySelector(".row-tag, .loc-chip, .version-chip")).toBeNull();
    expect(t.rows()[0]!.textContent).not.toContain("nlp");
  });
});

describe("A11 roles", () => {
  it("makes the list a treegrid of rows with gridcells", () => {
    const t = mounted();
    expect(t.container.querySelector('[role="treegrid"]')).not.toBeNull();
    expect(mains(t)).toHaveLength(3);
    expect(mains(t)[0]!.querySelector('[role="gridcell"]')).not.toBeNull();
  });

  it("reflects the selection in aria-selected", () => {
    const t = mounted();
    t.lib.store.set({ selected: new Set(["b"]), anchor: "b", cursor: "b" });
    expect(mains(t).map((r) => r.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
  });

  it("reflects expansion in aria-expanded and shows child rows at level 2", () => {
    const t = mounted();
    expect(mains(t)[0]!.getAttribute("aria-expanded")).toBe("false");
    t.key("ArrowDown");
    t.key("ArrowRight");
    expect(mains(t)[0]!.getAttribute("aria-expanded")).toBe("true");
    expect(childRows(t).length).toBeGreaterThan(0);
    expect(childRows(t)[0]!.querySelector('[role="gridcell"]')).not.toBeNull();
  });

  it("gives a paper without a PDF aria-expanded and a tray with its Note row", () => {
    const t = mountForTest();
    t.snapshot(library);
    expect(mains(t)[0]!.getAttribute("aria-expanded")).toBe("false");
    t.click(".expand-btn");
    expect(mains(t)[0]!.getAttribute("aria-expanded")).toBe("true");
    t.files(mains(t)[0]!.closest<HTMLElement>(".paper-row")!.dataset["id"]!, { status: "ready", files: [] });
    expect(childRows(t).map((r) => r.getAttribute("data-kind"))).toEqual(["note"]);
  });
});

describe("A10 keyboard", () => {
  it("keeps exactly one tab stop and moves it with the cursor", () => {
    const t = mounted();
    expect(tabStops(t)).toHaveLength(1);
    t.key("ArrowDown");
    t.key("ArrowDown");
    expect(tabStops(t)).toEqual([mains(t)[1]]);
  });

  it("ArrowRight expands a collapsed paper row, then steps into its first child row", () => {
    const t = mounted();
    t.key("ArrowDown");
    t.key("ArrowRight");
    expect(mains(t)[0]!.getAttribute("aria-expanded")).toBe("true");
    t.key("ArrowRight");
    expect(document.activeElement).toBe(childRows(t)[0]);
  });

  it("ArrowDown from an expanded paper row moves focus to its first child row", () => {
    const t = mounted();
    t.key("ArrowDown");
    t.key("ArrowRight");
    t.key("ArrowDown");
    expect(document.activeElement).toBe(childRows(t)[0]);
  });

  it("ArrowLeft on a child row returns to its paper row, and on an expanded paper row collapses it", () => {
    const t = mounted();
    t.key("ArrowDown");
    t.key("ArrowRight");
    t.key("ArrowRight");
    t.key("ArrowLeft");
    expect(document.activeElement).toBe(mains(t)[0]);
    expect(mains(t)[0]!.getAttribute("aria-expanded")).toBe("true");
    t.key("ArrowLeft");
    expect(mains(t)[0]!.getAttribute("aria-expanded")).toBe("false");
  });

  it("Shift+F10 opens the row menu", () => {
    const t = mounted();
    t.key("ArrowDown");
    t.key("F10", { shiftKey: true });
    expect(document.querySelector(".ls-menu")).not.toBeNull();
  });
});
