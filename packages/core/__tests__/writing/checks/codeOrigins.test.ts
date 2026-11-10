/** Verifies the checklist lists stale, diverged, both and missing code listings in References, and not fresh or unreadable ones. */
import { posixPathOps } from "../../../src/path/index";
import { buildChecklist, type ChecklistInput, type ChecklistSection } from "../../../src/writing/checks/checklist";
import { deriveChecklistSidebarNodes } from "../../../src/writing/checks/checklistSidebar";
import { createLibraryCodeSource, readCodeOrigins, type CodeOrigin } from "../../../src/writing/checks/codeOrigins";
import { buildCodeInsert, readCodeExcerpt, type CodeLinkSource } from "../../../src/writing/codeLinks/index";

const FIT = "def fit_model(x, y):\n    return x + y\n";
const PLOT = "def plot(x):\n    return x\n";

async function listing(path: string, fileText: string, name: string): Promise<string> {
  return buildCodeInsert("latex", "minted", readCodeExcerpt(path, fileText, { kind: "symbol", name })!);
}

function sourceOf(files: Record<string, string | Error>): CodeLinkSource {
  return {
    read: async (path) => {
      const file = files[path];
      if (file instanceof Error) { throw file; }
      return file;
    },
  };
}

describe("readCodeOrigins", () => {
  it("lists a stale and a missing listing with file, line, path, anchor and state, and skips fresh ones", async () => {
    const text = [
      "Intro", await listing("fit.py", FIT, "fit_model"), "", await listing("plot.py", PLOT, "plot"), "", await listing("gone.py", FIT, "fit_model"),
    ].join("\n");
    const files = { "fit.py": FIT.replace("x + y", "x * y"), "plot.py": PLOT };
    const origins = await readCodeOrigins([{ path: "main.tex", format: "latex", text }], sourceOf(files));
    expect(origins).toEqual([
      { file: "main.tex", line: 1, path: "fit.py", anchor: "fit_model in fit.py", state: "stale" },
      { file: "main.tex", line: 15, path: "gone.py", anchor: "fit_model in gone.py", state: "missing" },
    ]);
  });

  it("lists a listing edited in the manuscript as diverged", async () => {
    const text = (await listing("fit.py", FIT, "fit_model")).replace("x + y", "x - y");
    const origins = await readCodeOrigins([{ path: "a.tex", format: "latex", text }], sourceOf({ "fit.py": FIT }));
    expect(origins.map((origin) => origin.state)).toEqual(["diverged"]);
  });

  it("leaves out a listing whose file cannot be read", async () => {
    const text = await listing("../outside.py", FIT, "fit_model");
    const origins = await readCodeOrigins([{ path: "a.tex", format: "latex", text }], sourceOf({ "../outside.py": new Error("outside") }));
    expect(origins).toEqual([]);
  });
});

const section: ChecklistSection = { id: "main.tex", title: "main.tex", file: "main.tex" };
const stale: CodeOrigin = { file: "main.tex", line: 4, path: "analysis/fit.py", anchor: "fit_model in fit.py", state: "stale" };

function input(codeOrigins: readonly CodeOrigin[]): ChecklistInput {
  return {
    todos: [], brokenRefs: [], staleFigures: [], pageOverflow: undefined, manual: [], reading: [],
    noteTasks: [], noteOrigins: [], codeOrigins, noteTitles: new Map(),
    placeSection: () => section, citeSections: new Map(),
  };
}

describe("code origins in the checklist", () => {
  it("lists them in References as open codeOrigin items", () => {
    const list = buildChecklist(input([stale]), "kind");
    const group = list.groups.find((each) => each.id === "ref");
    expect(group?.title).toBe("References");
    expect(group?.items).toEqual([{ kind: "codeOrigin", done: false, origin: stale }]);
    expect(list.openCount).toBe(1);
  });

  it("places them in their section when grouped by section", () => {
    const list = buildChecklist(input([stale]), "section");
    expect(list.groups.find((each) => each.id === "main.tex")?.items).toEqual([{ kind: "codeOrigin", done: false, origin: stale }]);
  });

  it("renders a row with the file, the line, the state and the code it copies", () => {
    const checklist = buildChecklist(input([stale]), "kind");
    const tree = deriveChecklistSidebarNodes({
      paths: posixPathOps, checklist, grouping: "kind", pageCount: undefined, reading: new Map(), noteTitles: new Map(), isExpanded: (_id, byDefault) => byDefault,
    });
    const row = tree.nodes.find((node) => node.label === "References")?.children?.[0];
    expect(row).toMatchObject({ label: "main.tex:5 — stale", description: "main:5", tooltip: "fit_model in fit.py (analysis/fit.py) is stale", clickable: true });
  });
});

describe("createLibraryCodeSource", () => {
  const files = new Map([["projects/paper/fit.py", FIT], ["code/shared.py", PLOT]]);
  const fs = {
    stat: async (file: string) => (files.has(file) ? { isFile: true, isDirectory: false } : undefined),
    readText: async (file: string) => files.get(file)!,
  } as unknown as Parameters<typeof createLibraryCodeSource>[0]["fs"];
  const source = createLibraryCodeSource({ fs, paths: posixPathOps }, "projects/paper");

  it("reads a file of the project and one beside it in the library", async () => {
    expect(await source.read("fit.py")).toBe(FIT);
    expect(await source.read("../../code/shared.py")).toBe(PLOT);
  });

  it("reads a missing file as undefined and throws for one outside the library folder", async () => {
    expect(await source.read("gone.py")).toBeUndefined();
    await expect(source.read("../../../outside.py")).rejects.toThrow("outside the library folder");
  });
});
