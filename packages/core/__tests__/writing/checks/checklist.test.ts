/** Verifies the checklist.json parser and edits, TODO scanning, section placement and the grouped checklist. */
import {
  addManualItem, buildChecklist, createSectionPlacer, deriveCitationSections, listManualItems, parseChecklistFile, removeManualItem,
  serializeChecklistFile, setManualItemDone, type ChecklistSection,
} from "../../../src/writing/checks/checklist";
import { scanTodos } from "../../../src/writing/checks/todoMarkers";

describe("checklistFile", () => {
  const T0 = "2026-10-16T09:12:00.000Z";
  const T1 = "2026-10-17T10:00:00.000Z";
  const item = { id: "a", text: "Ask Ana", done: false, createdAt: T0 };

  function parsed(value: unknown) {
    const doc = parseChecklistFile(JSON.stringify(value));
    if (doc === undefined) { throw new Error("expected a document"); }
    return doc;
  }

  describe("parseChecklistFile", () => {
    it("parses a valid file", () => {
      expect(listManualItems(parsed({ items: [item] }))).toEqual([item]);
    });

    it("reads malformed files as undefined", () => {
      expect(parseChecklistFile("not json")).toBeUndefined();
      expect(parseChecklistFile("[]")).toBeUndefined();
      expect(parseChecklistFile("null")).toBeUndefined();
      expect(parseChecklistFile('"x"')).toBeUndefined();
      expect(parseChecklistFile("{}")).toBeUndefined();
      expect(parseChecklistFile('{"items":{}}')).toBeUndefined();
    });
  });

  describe("listManualItems", () => {
    it("returns only valid items", () => {
      const done = { id: "d", text: "Done one", done: true, createdAt: T0, doneAt: T1 };
      const doc = parsed({
        items: [
          item, done,
          { ...item, id: "" }, { ...item, text: "" }, { ...item, id: 3 }, { ...item, done: "no" },
          { ...item, createdAt: "yesterday" }, { id: "x", text: "t", done: false },
          { ...item, id: "e", doneAt: "garbage" }, { ...done, id: "f", doneAt: "garbage" },
          null, "str", 4,
        ],
      });
      expect(listManualItems(doc).map((entry) => entry.id)).toEqual(["a", "d"]);
    });

    it("hides a done item that has no doneAt and an open item that has one", () => {
      const doc = parsed({ items: [{ ...item, done: true }, { ...item, id: "b", doneAt: T1 }] });
      expect(listManualItems(doc)).toEqual([]);
    });
  });

  describe("edits", () => {
    it("adds an item without mutating the input", () => {
      const doc = parsed({ items: [item] });
      const before = JSON.stringify(doc);
      const next = addManualItem(doc, { id: "b", text: "Shorten", now: T1 });
      expect(listManualItems(next)).toEqual([item, { id: "b", text: "Shorten", done: false, createdAt: T1 }]);
      expect(JSON.stringify(doc)).toBe(before);
    });

    it("marks an item done with doneAt and reopens it clearing doneAt", () => {
      const doc = parsed({ items: [item] });
      const before = JSON.stringify(doc);
      const done = setManualItemDone(doc, "a", true, T1);
      expect(listManualItems(done)).toEqual([{ ...item, done: true, doneAt: T1 }]);
      const reopened = setManualItemDone(done, "a", false, "2026-10-18T00:00:00.000Z");
      expect(listManualItems(reopened)).toEqual([item]);
      expect("doneAt" in listManualItems(reopened)[0]!).toBe(false);
      expect(JSON.stringify(doc)).toBe(before);
    });

    it("removes an item and leaves the others", () => {
      const doc = parsed({ items: [item, { ...item, id: "b" }] });
      const before = JSON.stringify(doc);
      expect(listManualItems(removeManualItem(doc, "a")).map((entry) => entry.id)).toEqual(["b"]);
      expect(JSON.stringify(doc)).toBe(before);
    });

    it("ignores an unknown id", () => {
      const doc = parsed({ items: [item] });
      expect(listManualItems(setManualItemDone(doc, "zzz", true, T1))).toEqual([item]);
      expect(listManualItems(removeManualItem(doc, "zzz"))).toEqual([item]);
    });

    it("keeps invalid items and unknown keys at the top level and in items", () => {
      const bad = { id: "bad", done: "maybe" };
      const doc = parsed({ extra: 1, items: [{ ...item, note: "keep" }, bad] });
      const next = removeManualItem(setManualItemDone(addManualItem(doc, { id: "n", text: "New", now: T1 }), "a", true, T1), "n");
      const out = JSON.parse(serializeChecklistFile(next));
      expect(out.extra).toBe(1);
      expect(out.items).toEqual([{ ...item, note: "keep", done: true, doneAt: T1 }, bad]);
    });
  });

  describe("group", () => {
    it("writes the group an item is added to and reads it back", () => {
      const doc = addManualItem(parsed({ items: [] }), { id: "g", text: "Fix fig 2", now: T0, group: "figure" });
      expect(listManualItems(parsed(JSON.parse(serializeChecklistFile(doc))))).toEqual([{ id: "g", text: "Fix fig 2", done: false, createdAt: T0, group: "figure" }]);
    });

    it("reads an unknown or malformed group as My items and keeps it on disk", () => {
      const doc = parsed({ items: [{ ...item, group: "someday" }, { ...item, id: "b", group: 3 }] });
      expect(listManualItems(doc)).toEqual([item, { ...item, id: "b" }]);
      expect(setManualItemDone(doc, "a", true, T1).items[0]).toMatchObject({ group: "someday" });
    });

    it("adds an item without a group as My items", () => {
      expect(addManualItem(parsed({ items: [] }), { id: "a", text: "Ask Ana", now: T0 }).items).toEqual([item]);
    });
  });

  describe("section", () => {
    it("writes the section an item is added to and reads it back", () => {
      const doc = addManualItem(parsed({ items: [] }), { id: "s", text: "Cut intro", now: T0, section: "main.tex#Intro" });
      expect(listManualItems(parsed(JSON.parse(serializeChecklistFile(doc))))).toEqual([{ id: "s", text: "Cut intro", done: false, createdAt: T0, section: "main.tex#Intro" }]);
    });

    it("reads an empty, non-string or over-long section as absent and keeps it on disk", () => {
      const doc = parsed({ items: [{ ...item, section: "" }, { ...item, id: "b", section: 3 }, { ...item, id: "c", section: "x".repeat(201) }] });
      expect(listManualItems(doc)).toEqual([item, { ...item, id: "b" }, { ...item, id: "c" }]);
      expect(setManualItemDone(doc, "a", true, T1).items[0]).toMatchObject({ section: "" });
    });
  });

  describe("serializeChecklistFile", () => {
    it("round-trips through parse", () => {
      const doc = addManualItem(parsed({ extra: true, items: [item] }), { id: "b", text: "Two", now: T1 });
      const text = serializeChecklistFile(doc);
      expect(JSON.parse(text)).toEqual({ extra: true, items: [item, { id: "b", text: "Two", done: false, createdAt: T1 }] });
      expect(serializeChecklistFile(parsed(JSON.parse(text)))).toBe(text);
    });
  });
});

describe("scanTodos latex", () => {
  it("finds \\todo commands, with and without options", () => {
    const text = "Intro\n\\todo{fix x}\nmore \\todo[inline]{cite y} text";
    expect(scanTodos("latex", "main.tex", text)).toEqual([
      { file: "main.tex", line: 1, text: "fix x" },
      { file: "main.tex", line: 2, text: "cite y" },
    ]);
  });

  it("finds TODO and FIXME comments, trimmed", () => {
    const text = "a\n% TODO   write this \n% FIXME broken";
    expect(scanTodos("latex", "a.tex", text)).toEqual([
      { file: "a.tex", line: 1, text: "write this" },
      { file: "a.tex", line: 2, text: "broken" },
    ]);
  });

  it("finds a marker comment that follows code", () => {
    expect(scanTodos("latex", "a.tex", "Some text. % TODO later")).toEqual([{ file: "a.tex", line: 0, text: "later" }]);
  });

  it("does not treat an escaped percent as a comment", () => {
    expect(scanTodos("latex", "a.tex", "50\\% TODO not a comment")).toEqual([]);
  });

  it("is case-sensitive", () => {
    expect(scanTodos("latex", "a.tex", "% todo x\n% Fixme y")).toEqual([]);
  });

  it("keeps an empty text", () => {
    expect(scanTodos("latex", "a.tex", "% TODO")).toEqual([{ file: "a.tex", line: 0, text: "" }]);
  });

  it("returns nothing for empty input", () => {
    expect(scanTodos("latex", "a.tex", "")).toEqual([]);
  });
});

describe("scanTodos typst", () => {
  it("finds TODO and FIXME comments", () => {
    const text = "= Intro\n// TODO write\ntext // FIXME fix";
    expect(scanTodos("typst", "main.typ", text)).toEqual([
      { file: "main.typ", line: 1, text: "write" },
      { file: "main.typ", line: 2, text: "fix" },
    ]);
  });

  it("ignores lowercase markers and LaTeX syntax", () => {
    expect(scanTodos("typst", "main.typ", "// todo x\n% TODO y\n\\todo{z}")).toEqual([]);
  });
});

describe("sectionPlacement", () => {
  const main = {
    path: "main.tex",
    format: "latex" as const,
    text: ["% preamble", "\\section{Intro}", "see \\cite{a}", "\\section{Methods}", "use \\cite{a,b}", "again \\cite{a}", "\\input{extra}"].join("\n"),
  };
  const extra = {
    path: "extra.tex",
    format: "latex" as const,
    text: ["\\section{Extra heading}", "cites \\cite{b}", "and \\cite{c}"].join("\n"),
  };
  const sources = [main, extra];

  describe("createSectionPlacer", () => {
    const place = createSectionPlacer(sources, "main.tex");

    it("places a main-file item under the nearest heading at or above it", () => {
      expect(place("main.tex", 2)).toMatchObject({ title: "Intro", file: "main.tex", line: 1 });
      expect(place("main.tex", 1)).toMatchObject({ title: "Intro" });
      expect(place("main.tex", 5)).toMatchObject({ title: "Methods", line: 3 });
    });

    it("places an item before the first heading under the file's own node", () => {
      const section = place("main.tex", 0);
      expect(section.title).toBe("main.tex");
      expect(section.file).toBe("main.tex");
      expect(section.line).toBeUndefined();
    });

    it("places any item of an included file under that file's node, ignoring its headings", () => {
      for (const line of [0, 1, 2]) {
        const section = place("extra.tex", line);
        expect(section.title).toBe("extra.tex");
        expect(section.file).toBe("extra.tex");
        expect(section.line).toBeUndefined();
      }
    });

    it("gives stable ids, equal within a section and distinct across sections", () => {
      expect(place("main.tex", 2).id).toBe(place("main.tex", 2).id);
      expect(place("main.tex", 2).id).toBe(place("main.tex", 1).id);
      expect(place("main.tex", 2).id).not.toBe(place("main.tex", 4).id);
      expect(place("extra.tex", 0).id).not.toBe(place("main.tex", 0).id);
    });
  });

  describe("deriveCitationSections", () => {
    const cites = deriveCitationSections(sources, "main.tex");

    it("lists each distinct citing section once, in source order", () => {
      expect(cites.get("a")!.map((s) => s.title)).toEqual(["Intro", "Methods"]);
      expect(cites.get("b")!.map((s) => s.title)).toEqual(["Methods", "extra.tex"]);
      expect(cites.get("c")!.map((s) => s.title)).toEqual(["extra.tex"]);
    });

    it("has no entry for an uncited key", () => {
      expect(cites.get("zzz")).toBeUndefined();
    });

    it("uses the same sections as the placer", () => {
      expect(cites.get("a")![0]).toEqual(createSectionPlacer(sources, "main.tex")("main.tex", 2));
    });
  });
});

describe("buildChecklist", () => {
  const section = (title: string, file = "main.tex", line?: number): ChecklistSection => ({ id: `${file}#${title}`, title, file, ...(line === undefined ? {} : { line }) });
  const intro = section("Intro", "main.tex", 1);
  const methods = section("Methods", "main.tex", 5);
  const extra = section("extra.tex", "extra.tex");

  const placeSection = (file: string, line: number): ChecklistSection => (file === "extra.tex" ? extra : line >= 5 ? methods : intro);

  const base = {
    todos: [{ file: "main.tex", line: 2, text: "fix x" }, { file: "extra.tex", line: 0, text: "fill" }, { file: "main.tex", line: 6, text: "later" }],
    brokenRefs: [{ file: "main.tex", line: 3, ref: "fig:gone" }],
    staleFigures: [{ name: "plot.pdf" }],
    pageOverflow: { pages: 12, limit: 10 },
    manual: [
      { id: "m1", text: "Ask Ana", done: false, createdAt: "2026-10-16T09:00:00.000Z" },
      { id: "m2", text: "Send", done: true, createdAt: "2026-10-16T09:00:00.000Z", doneAt: "2026-10-17T09:00:00.000Z" },
    ],
    reading: [
      { key: "a", title: "Paper A", status: "unread" as const },
      { key: "b", title: "Paper B", status: "reading" as const },
      { key: "c", title: "Paper C", status: "done" as const, statusChangedAt: "2026-10-10T00:00:00.000Z" },
    ],
    placeSection,
    citeSections: new Map<string, ChecklistSection[]>([["a", [intro, methods]], ["b", [methods]]]),
    noteTasks: [],
    noteTitles: new Map<string, string>(),
  };

  const empty = { ...base, todos: [], brokenRefs: [], staleFigures: [], pageOverflow: undefined, manual: [], reading: [] };

  describe("buildChecklist by kind", () => {
    const list = buildChecklist(base, "kind");

    it("orders groups TODOs, References, Figures, Pages, Manual, Reading", () => {
      expect(list.groups.map((g) => g.items[0]!.kind)).toEqual(["todo", "ref", "figure", "pages", "manual", "reading"]);
    });

    it("holds every item of the kind in its group", () => {
      expect(list.groups.map((g) => g.items.length)).toEqual([3, 1, 1, 1, 2, 3]);
    });

    it("counts open items per group; only manual and reading can be done", () => {
      expect(list.groups.map((g) => g.open)).toEqual([3, 1, 1, 1, 1, 2]);
      for (const g of list.groups) {
        for (const item of g.items) {
          if (item.kind !== "manual" && item.kind !== "reading") { expect(item.done).toBe(false); }
        }
      }
      const manual = list.groups[4]!.items;
      expect(manual.map((i) => i.done)).toEqual([false, true]);
      expect(list.groups[5]!.items.map((i) => i.done)).toEqual([false, false, true]);
    });

    it("excludes reading items and done manual items from openCount", () => {
      expect(list.openCount).toBe(3 + 1 + 1 + 1 + 1);
    });

    it("omits empty groups", () => {
      const only = buildChecklist({ ...empty, staleFigures: [{ name: "plot.pdf" }] }, "kind");
      expect(only.groups).toHaveLength(1);
      expect(only.groups[0]!.items[0]!.kind).toBe("figure");
      expect(only.openCount).toBe(1);
    });

    it("returns no groups for an empty project", () => {
      expect(buildChecklist(empty, "kind")).toEqual({ groups: [], openCount: 0 });
    });

    it("omits the pages item when there is no overflow", () => {
      const list2 = buildChecklist({ ...base, pageOverflow: undefined }, "kind");
      expect(list2.groups.some((g) => g.items.some((i) => i.kind === "pages"))).toBe(false);
    });
  });

  describe("buildChecklist by section", () => {
    const list = buildChecklist(base, "section");
    const titles = list.groups.map((g) => g.title);

    it("orders section groups by first appearance, then Whole project, then Reading", () => {
      expect(titles.slice(-2)).toEqual(["Whole project", "Reading"]);
      expect(titles.slice(0, -2)).toEqual(["Intro", "Methods", "extra.tex"]);
    });

    it("places todos and broken refs under their section", () => {
      const intro1 = list.groups[0]!.items.map((i) => i.kind);
      expect(intro1).toContain("todo");
      expect(intro1).toContain("ref");
      expect(list.groups[1]!.items.map((i) => i.kind)).toContain("todo");
      expect(list.groups[2]!.items.map((i) => i.kind)).toEqual(expect.arrayContaining(["todo"]));
    });

    it("puts stale figures, page overflow and manual items under Whole project", () => {
      const whole = list.groups.find((g) => g.title === "Whole project")!;
      expect(whole.items.map((i) => i.kind).sort()).toEqual(["figure", "manual", "manual", "pages"]);
      expect(whole.open).toBe(3);
    });

    it("puts a cited paper under each section citing it and uncited papers under Reading", () => {
      const readingIn = (title: string) => list.groups.find((g) => g.title === title)!.items.filter((i) => i.kind === "reading");
      expect(readingIn("Intro")).toHaveLength(1);
      expect(readingIn("Methods")).toHaveLength(2);
      expect(readingIn("Reading")).toHaveLength(1);
    });

    it("places a manual item under its section after the section's own rows, and a vanished section under Whole project", () => {
      const manual = [
        { id: "s1", text: "Cut intro", done: false, createdAt: "2026-10-16T09:00:00.000Z", section: intro.id },
        { id: "s2", text: "Lost", done: false, createdAt: "2026-10-16T09:00:00.000Z", section: "gone.tex#Gone" },
      ];
      const placed = buildChecklist({ ...base, manual }, "section");
      const introKinds = placed.groups.find((g) => g.title === "Intro")!.items.map((i) => i.kind);
      expect(introKinds[introKinds.length - 1]).toBe("manual");
      expect(placed.groups.find((g) => g.title === "Whole project")!.items.filter((i) => i.kind === "manual")).toHaveLength(1);
      expect(buildChecklist({ ...base, manual }, "kind").groups.find((g) => g.id === "manual")!.items).toHaveLength(2);
    });

    it("counts each item once and excludes reading", () => {
      expect(list.openCount).toBe(3 + 1 + 1 + 1 + 1);
      expect(list.openCount).toBe(buildChecklist(base, "kind").openCount);
    });

    it("omits empty groups", () => {
      const only = buildChecklist({ ...empty, todos: [{ file: "extra.tex", line: 0, text: "fill" }] }, "section");
      expect(only.groups.map((g) => g.title)).toEqual(["extra.tex"]);
      expect(only.openCount).toBe(1);
    });

    it("lists only Reading when only uncited papers exist", () => {
      const only = buildChecklist({ ...empty, reading: base.reading, citeSections: new Map() }, "section");
      expect(only.groups.map((g) => g.title)).toEqual(["Reading"]);
      expect(only.openCount).toBe(0);
    });
  });
});
