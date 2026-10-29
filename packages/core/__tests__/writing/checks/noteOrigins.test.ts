/** Verifies the checklist lists stale, diverged, both and missing note origins in References, and not fresh ones. */
import { posixPathOps } from "../../../src/path/index";
import { buildChecklist, type Checklist, type ChecklistInput, type ChecklistSection } from "../../../src/writing/checks/checklist";
import { deriveChecklistSidebarNodes } from "../../../src/writing/checks/checklistSidebar";

type Origin = { file: string; line: number; notePath: string; label: string; state: "stale" | "diverged" | "both" | "missing" };

const section: ChecklistSection = { id: "main.tex", title: "main.tex", file: "main.tex" };

const stale: Origin = { file: "main.tex", line: 3, notePath: "notes/a.qmd", label: "fig-a", state: "stale" };
const diverged: Origin = { file: "main.tex", line: 9, notePath: "notes/b.qmd", label: "tbl-b", state: "diverged" };
const both: Origin = { file: "sections/intro.tex", line: 1, notePath: "notes/c.qmd", label: "fig-c", state: "both" };
const missing: Origin = { file: "main.tex", line: 14, notePath: "notes/d.qmd", label: "fig-d", state: "missing" };

function input(noteOrigins: readonly Origin[]): ChecklistInput {
  return {
    todos: [], brokenRefs: [], staleFigures: [], pageOverflow: undefined, manual: [], reading: [],
    noteTasks: [], noteOrigins, noteTitles: new Map(),
    placeSection: () => section, citeSections: new Map(),
  } as ChecklistInput;
}

const refGroup = (list: Checklist) => list.groups.find((group) => group.id === "ref");
const originsOf = (list: Checklist) =>
  (refGroup(list)?.items ?? []).flatMap((item) => (item as { kind: string; origin?: Origin }).kind === "noteOrigin" ? [(item as unknown as { origin: Origin }).origin] : []);

describe("noteOrigins in the checklist", () => {
  it("13.3a lists a stale and a diverged origin in the References group", () => {
    const list = buildChecklist(input([stale, diverged]), "kind");
    expect(refGroup(list)?.title).toBe("References");
    expect(originsOf(list)).toEqual([stale, diverged]);
  });

  it("13.3a gives each origin item the noteOrigin kind and not done", () => {
    const list = buildChecklist(input([stale]), "kind");
    expect(refGroup(list)?.items).toEqual([{ kind: "noteOrigin", done: false, origin: stale }]);
  });

  it("13.3a lists both and missing origins as well", () => {
    const list = buildChecklist(input([both, missing]), "kind");
    expect(originsOf(list)).toEqual([both, missing]);
  });

  it("13.3a does not list fresh origins, which are absent from the input", () => {
    expect(buildChecklist(input([]), "kind")).toEqual({ groups: [], openCount: 0 });
  });

  it("13.3a counts each listed origin as one open item", () => {
    const list = buildChecklist(input([stale, diverged]), "kind");
    expect(list.openCount).toBe(2);
    expect(refGroup(list)?.open).toBe(2);
  });

  it("13.3a keeps broken references in the same group beside the origins", () => {
    const withRef = { ...input([stale]), brokenRefs: [{ file: "main.tex", line: 2, ref: "fig:x" }] } as ChecklistInput;
    const list = buildChecklist(withRef, "kind");
    expect(refGroup(list)?.items.map((item) => item.kind).sort()).toEqual(["noteOrigin", "ref"]);
    expect(list.openCount).toBe(2);
  });

  it("13.3a renders a row with the file, the line and the state in the sidebar", () => {
    const checklist = buildChecklist(input([stale, diverged]), "kind");
    const tree = deriveChecklistSidebarNodes({
      paths: posixPathOps, checklist, grouping: "kind", pageCount: undefined, reading: new Map(), noteTitles: new Map(), isExpanded: (_id, byDefault) => byDefault,
    });
    const group = tree.nodes.find((node) => node.label === "References");
    const rows = group?.children ?? [];
    expect(rows).toHaveLength(2);
    const text = (row: (typeof rows)[number]) => JSON.stringify(row);
    expect(text(rows[0]!)).toContain("main");
    expect(text(rows[0]!)).toContain("stale");
    expect(text(rows[0]!)).toMatch(/\b[34]\b/);
    expect(text(rows[1]!)).toContain("diverged");
    expect(text(rows[1]!)).toMatch(/\b(9|10)\b/);
  });
});
