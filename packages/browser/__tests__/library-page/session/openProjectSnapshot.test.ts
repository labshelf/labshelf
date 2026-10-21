// The open project's Files, Outline and Checklist trees are built from the project folder through core's builders.
import type { ILogger, ProjectEntry, SidebarProjectTree, SidebarTreeNode } from "@labshelf/core";
import { createOpenProjectSnapshot } from "../../../src/library-page/session/openProjectSnapshot";
import { memoryFs } from "./memoryFs";

const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };

const MAIN = ["\\section{Intro}", "text % TODO: cite more", "\\subsection{Aim}", "\\section{Method}"].join("\n");

const entry = (main: string | undefined): ProjectEntry => ({
  kind: "ready", folder: "/projects/thesis", location: "library", main,
  settings: { id: "thesis", format: "latex" },
});

const files = {
  "/projects/thesis/main.tex": MAIN,
  "/projects/thesis/b.tex": "",
  "/projects/thesis/Zed/inner.tex": "",
  "/projects/thesis/.git/config": "",
  "/projects/thesis/.labshelf/checklist.json": "{}",
};

const tree = (trees: SidebarProjectTree[], view: SidebarProjectTree["view"]): SidebarProjectTree => trees.find((t) => t.view === view)!;
const labels = (nodes: SidebarTreeNode[]): string[] => nodes.map((n) => n.label);

describe("createOpenProjectSnapshot", () => {
  it("lists files folders first, hides .git and .labshelf, and marks the main file", async () => {
    const snapshot = await createOpenProjectSnapshot({ fs: memoryFs(files), logger })(entry("main.tex"), "kind");
    const filesTree = tree(snapshot.trees, "files");
    expect(snapshot).toMatchObject({ id: "/projects/thesis", name: "thesis", format: "latex" });
    expect(filesTree).toMatchObject({ title: "Files", empty: "No files." });
    expect(labels(filesTree.nodes)).toEqual(["Zed", "b.tex", "main.tex"]);
    expect(filesTree.nodes[0]!.children!.map((n) => n.key)).toEqual(["Zed/inner.tex"]);
    expect(filesTree.nodes[2]).toMatchObject({ key: "main.tex", description: "main", clickable: true });
  });

  it("nests the main file's headings into the outline", async () => {
    const snapshot = await createOpenProjectSnapshot({ fs: memoryFs(files), logger })(entry("main.tex"), "kind");
    const outline = tree(snapshot.trees, "outline");
    expect(outline).toMatchObject({ title: "Outline", empty: "Open a source file to see its outline." });
    expect(labels(outline.nodes)).toEqual(["Intro", "Method"]);
    expect(labels(outline.nodes[0]!.children!)).toEqual(["Aim"]);
    expect(outline.nodes[0]).toMatchObject({ key: "main.tex:0", clickable: true });
  });

  it("builds the checklist in the asked grouping with its toggle", async () => {
    const build = createOpenProjectSnapshot({ fs: memoryFs(files), logger });
    const byKind = tree((await build(entry("main.tex"), "kind")).trees, "checklist");
    expect(byKind).toMatchObject({ title: "Checklist", empty: "Nothing to do.", toggle: { selected: "byKind" } });
    expect(byKind.toggle!.options.map((o) => o.action)).toEqual(["byKind", "bySection"]);
    expect(labels(byKind.nodes)).toContain("TODOs");
    const bySection = tree((await build(entry("main.tex"), "section")).trees, "checklist");
    expect(bySection.toggle!.selected).toBe("bySection");
    expect(labels(bySection.nodes)).toContain("Intro");
  });

  it("yields an empty outline and checklist when the project has no main file", async () => {
    const snapshot = await createOpenProjectSnapshot({ fs: memoryFs(files), logger })(entry(undefined), "kind");
    expect(tree(snapshot.trees, "outline").nodes).toEqual([]);
    expect(tree(snapshot.trees, "checklist").nodes).toEqual([]);
  });
});
