/**
 * @jest-environment jsdom
 */
// Tests the paper list: its rows and column heads, the Last read, Status, tag and mark cells, the columns menu, and the empty, loading, failed and narrow states.
import { mountForTest, paper, ALL_CAPABILITIES, menuLabels } from "../mountHarness";
import { DEFAULT_COLUMNS } from "../../../../src/libraryUi/store";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

const WITH_READ = { columns: [...DEFAULT_COLUMNS, "lastRead" as const] };

const DAY = 86_400_000;
const daysAgo = (d: number): string => new Date(Date.now() - d * DAY).toISOString();

describe("Last read cell", () => {
  it("shows the compact time, and the full date, time and page as its title", () => {
    const t = mountForTest(WITH_READ);
    const lastRead = daysAgo(3);
    t.snapshot([paper("a", "papers")], [], [], { a: { annotations: 0, lastPage: 2, lastRead } });
    const cell = t.container.querySelector<HTMLElement>(".paper-row .col-read")!;
    expect(cell.textContent).toBe("3 d");
    expect(cell.title).toBe(`Last read ${new Date(lastRead).toLocaleString()}, page 2`);
  });

  it("shows a dash and no title for a paper never read", () => {
    const t = mountForTest(WITH_READ);
    t.snapshot([paper("a", "papers")]);
    const cell = t.container.querySelector<HTMLElement>(".paper-row .col-read")!;
    expect(cell.textContent).toBe("—");
    expect(cell.hasAttribute("title")).toBe(false);
  });
});

describe("Status cell", () => {
  const markOf = (status: "unread" | "reading" | "done"): HTMLElement => {
    const t = mountForTest(WITH_READ);
    t.snapshot([paper("a", "papers", { status })]);
    const main = t.container.querySelector<HTMLElement>(".paper-row-main")!;
    expect(main.querySelector("[class*='ls-badge']")).toBeNull();
    return main.querySelector<HTMLElement>(".status-mark [role='img']")!;
  };

  it("draws a dot for an unread paper", () => {
    const mark = markOf("unread");
    expect(mark.classList.contains("ls-status-dot") || mark.querySelector(".ls-status-dot") !== null).toBe(true);
    expect(mark.getAttribute("aria-label")).toBe("Unread");
  });

  it.each([["reading", "Reading"], ["done", "Done"]] as const)("draws an arc mark for a %s paper", (status, label) => {
    const mark = markOf(status);
    expect(mark.querySelector("svg") ?? mark.closest("svg")).not.toBeNull();
    expect(mark.getAttribute("aria-label")).toBe(label);
  });
});

const now = new Date();
const hoursAgo = (h: number): string => new Date(now.getTime() - h * 3600_000).toISOString();

describe("row marks", () => {
  it("keeps the title cell to the title, and says when the paper was last read", () => {
    const t = mountForTest({ columns: [...DEFAULT_COLUMNS, "lastRead"] });
    t.snapshot([paper("a", "papers")], ["papers/a"], [], { a: { annotations: 4, lastPage: 7, lastRead: hoursAgo(3) } });
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

const libraryRowTags = [
  paper("a", "papers", { title: "Alpha", tags: ["ai", "deep learning"] }),
  paper("b", "papers", { title: "Beta" }),
];

describe("row tags", () => {
  it("renders a button per tag after the title, and none for an untagged paper", () => {
    const t = mountForTest();
    t.snapshot(libraryRowTags);
    const [a, b] = t.rows();
    expect([...a!.querySelectorAll<HTMLElement>(".title-cell .row-tag")].map((e) => [e.dataset["tag"], e.textContent])).toEqual([
      ["ai", "#ai"], ["deep learning", "#deep learning"],
    ]);
    expect(b!.querySelector(".row-tag")).toBeNull();
  });

  it("searches the exact tag on click without selecting or opening the row", () => {
    const t = mountForTest();
    t.snapshot(libraryRowTags);
    const before = t.lib.store.get();
    t.rows()[0]!.querySelectorAll<HTMLElement>(".row-tag")[1]!.click();
    const s = t.lib.store.get();
    expect(s.query).toBe('tag:"deep learning"');
    expect(s.selected).toEqual(before.selected);
    expect(s.open).toBe(before.open);
  });

  it("re-renders the tags when a paper's tags change", () => {
    const t = mountForTest();
    t.snapshot(libraryRowTags);
    t.snapshot([{ ...libraryRowTags[0]!, tags: ["nlp"] }, libraryRowTags[1]!]);
    expect([...t.rows()[0]!.querySelectorAll<HTMLElement>(".row-tag")].map((e) => e.dataset["tag"])).toEqual(["nlp"]);
  });
});

const libraryColumns = [paper("a", "papers", { title: "Alpha", journal: "Nature" })];
const item = (label: string): HTMLButtonElement =>
  [...document.querySelectorAll<HTMLButtonElement>(".ls-menu-item")].find((b) => b.querySelector(".ls-menu-label")?.textContent === label)!;
const headsMenu = (t: ReturnType<typeof mountForTest>): void => {
  t.container.querySelector(".col-heads")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
};

describe("columns menu", () => {
  it("lists the five optional columns, checked when shown, on a right-click of the heads", () => {
    const t = mountForTest();
    t.snapshot(libraryColumns);
    headsMenu(t);
    expect(menuLabels()).toEqual(["Authors", "Venue", "Year", "Last read", "Status"]);
    expect(item("Authors").classList.contains("checked")).toBe(true);
    expect(item("Venue").classList.contains("checked")).toBe(false);
    expect(item("Last read").classList.contains("checked")).toBe(false);
  });

  it("opens from the Columns button too", () => {
    const t = mountForTest();
    t.snapshot(libraryColumns);
    t.click(".col-menu button");
    expect(menuLabels()).toHaveLength(5);
  });

  it("adds the Venue head and cells, saves the columns, and removes them when toggled again", () => {
    const t = mountForTest();
    t.snapshot(libraryColumns);
    expect(t.container.querySelector(".col-venue")).toBeNull();
    headsMenu(t);
    item("Venue").click();
    expect(t.saved.at(-1)).toEqual({ columns: ["creator", "venue", "year", "status"] });
    expect(t.container.querySelector(".col-head.col-venue")).not.toBeNull();
    expect(t.container.querySelector(".paper-row-main .col-venue")?.textContent).toBe("Nature");
    headsMenu(t);
    item("Venue").click();
    expect(t.saved.at(-1)).toEqual({ columns: ["creator", "year", "status"] });
    expect(t.container.querySelector(".col-venue")).toBeNull();
  });

  it("sets the hidden track to zero and clears it when the column returns", () => {
    const t = mountForTest();
    t.snapshot(libraryColumns);
    const list = t.container.querySelector<HTMLElement>(".paper-list")!;
    expect(list.style.getPropertyValue("--w-venue")).toBe("0px");
    headsMenu(t);
    item("Venue").click();
    expect(list.style.getPropertyValue("--w-venue")).toBe("");
  });

  it("sorts by Title again when the sorted column is hidden", () => {
    const t = mountForTest({ sortKey: "year", sortDir: -1 });
    t.snapshot(libraryColumns);
    headsMenu(t);
    item("Year").click();
    expect(t.saved.at(-1)).toEqual({ columns: ["creator", "status"], sortKey: "title", sortDir: 1 });
    expect(t.lib.store.get().sortKey).toBe("title");
  });

  it("keeps sorting by the heads after they are rebuilt", () => {
    const t = mountForTest();
    t.snapshot(libraryColumns);
    headsMenu(t);
    item("Venue").click();
    t.click(".col-head.col-venue");
    expect(t.lib.store.get().sortKey).toBe("venue");
  });
});

const SUB = { name: "Sub", path: "papers/Sub", children: [] as [] };
const libraryListStates = [paper("a", "papers", { title: "Alpha" })];
const text = (t: ReturnType<typeof mountForTest>): string => t.container.querySelector(".ls-empty-text")?.textContent ?? "";

describe("empty states", () => {
  it("says the library has no papers when nothing has been added", () => {
    const t = mountForTest();
    t.snapshot([]);
    expect(text(t)).toBe("Your library has no papers yet");
    expect(t.container.querySelector(".ls-empty-hint")).not.toBeNull();
  });

  it("says the folder has no papers when other folders do", () => {
    const t = mountForTest();
    t.snapshot(libraryListStates, [], [SUB]);
    t.lib.store.openFolder("papers/Sub");
    expect(text(t)).toBe("No papers in Sub yet");
  });

  it("says nothing matches when a search finds no paper", () => {
    const t = mountForTest();
    t.snapshot(libraryListStates);
    t.lib.store.set({ query: "zzz" });
    expect(text(t)).toBe("No papers match “zzz” in All papers");
    expect(t.container.querySelector(".ls-empty button")?.textContent).toBe("Clear filters");
  });

  it("keeps the three messages distinct", () => {
    const t = mountForTest();
    t.snapshot([]);
    const library0 = text(t);
    t.snapshot(libraryListStates, [], [SUB]);
    t.lib.store.openFolder("papers/Sub");
    const folder = text(t);
    t.lib.store.openFolder("papers");
    t.lib.store.set({ query: "zzz" });
    expect(new Set([library0, folder, text(t)]).size).toBe(3);
  });
});

describe("loading and failure", () => {
  it("shows a loading state with a status role until the first snapshot", () => {
    const t = mountForTest();
    const loading = t.container.querySelector(".list-loading");
    expect(loading?.getAttribute("role")).toBe("status");
    expect(loading?.textContent).toContain("Loading papers…");
    t.snapshot(libraryListStates);
    expect(t.container.querySelector(".list-loading")).toBeNull();
  });

  it("shows Loading files… in the tray until the listing arrives", () => {
    const t = mountForTest();
    t.snapshot(libraryListStates, ["papers/a"]);
    t.click(".expand-btn");
    expect(t.container.querySelector(".paper-children .file-state")?.textContent).toContain("Loading files…");
  });

  it("logs a failed listing with the paper, shows the failed row and raises a toast", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const t = mountForTest();
    t.snapshot(libraryListStates, ["papers/a"]);
    t.click(".expand-btn");
    t.files("a", { status: "failed", message: "disk gone" });
    expect(t.container.querySelector(".paper-children .file-state.failed")?.textContent).toContain("disk gone");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("LabShelf library"), { id: "a", title: "Alpha", message: "disk gone" });
    const toast = document.querySelector(".ls-toast.error");
    expect(toast?.textContent).toContain("Alpha");
    expect(toast?.textContent).toContain("disk gone");
    warn.mockRestore();
  });
});

describe("long text and layout", () => {
  it("carries the full title as a tooltip on the ellipsized title cell", () => {
    const long = "A very long title ".repeat(12).trim();
    const t = mountForTest();
    t.snapshot([paper("a", "papers", { title: long })]);
    expect(t.container.querySelector(".title-cell")?.getAttribute("title")).toBe(long);
    expect(readFileSync(join(__dirname, "../../../../src/libraryUi/dom/styles/library-list.css"), "utf8"))
      .toMatch(/\.title-cell > \.title-text \{[^}]*text-overflow: ellipsis/);
  });

  it("marks the Year cell and head so the narrow layout can hide them", () => {
    const t = mountForTest();
    t.snapshot([paper("a", "papers", { year: 2020 })]);
    expect(t.container.querySelector(".col-head.col-year")).not.toBeNull();
    expect(t.container.querySelector(".paper-row-main .col-year")?.textContent).toBe("2020");
  });

  it("keeps --heads-h in step with the column heads when they resize", () => {
    let notify: () => void = () => undefined;
    const disconnect = jest.fn();
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { constructor(cb: () => void) { notify = cb; } observe(): void {} disconnect = disconnect; };
    const t = mountForTest();
    t.snapshot(libraryListStates);
    const heads = t.container.querySelector<HTMLElement>(".col-heads")!;
    Object.defineProperty(heads, "offsetHeight", { configurable: true, value: 41 });
    notify();
    expect(t.container.querySelector<HTMLElement>(".paper-list")!.style.getPropertyValue("--heads-h")).toBe("41px");
    t.lib.dispose();
    expect(disconnect).toHaveBeenCalled();
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  });
});

describe("narrow list pane", () => {
  const css = readFileSync(join(__dirname, "../../../../src/libraryUi/dom/styles/library-list.css"), "utf8");
  const block = (width: number): string => css.match(new RegExp(`@container list-pane \\(max-width: ${width}px\\) \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";

  it("scrolls sideways instead of hiding a column when the pane is narrow", () => {
    expect(css).not.toMatch(/display: none !important/);
    expect(css).toMatch(/flex: 1; overflow: auto; outline: none;/);
  });

  it("moves the tray fact under the name instead of squeezing it into a hidden column", () => {
    expect(block(470)).toMatch(/\.file-row \{[^}]*flex-wrap: wrap/);
    expect(block(470)).toMatch(/\.file-fact \{[^}]*flex-basis/);
  });
});
