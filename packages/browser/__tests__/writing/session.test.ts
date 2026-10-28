import type { ILogger, ProjectEntry, SidebarOpenProject, SidebarProjectTree, SidebarTreeNode } from "@labshelf/core";
import { createOpenProjectSnapshot, createProjectSession, registerOpenEditor, showInOpenEditor } from "../../src/writing/session";
import { memoryFs } from "../support/memoryFs";

const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };

// The open-editor registry reveals a line in a mounted editor and holds a reveal asked for before the editor mounted.
describe("open editors", () => {
  it("reveals the line in the editor registered for the file", () => {
    const revealLine = jest.fn();
    const off = registerOpenEditor("p1", "main.tex", { revealLine, flush: async () => true, reload: async () => undefined });
    showInOpenEditor("p1", "main.tex", 4);
    expect(revealLine).toHaveBeenCalledWith(4);
    off();
  });

  it("applies a reveal asked for while the editor was still loading", () => {
    showInOpenEditor("p2", "a:b.tex", 9);
    const revealLine = jest.fn();
    registerOpenEditor("p2", "a:b.tex", { revealLine, flush: async () => true, reload: async () => undefined })();
    expect(revealLine).toHaveBeenCalledWith(9);
  });

  it("forgets a disposed editor", () => {
    const revealLine = jest.fn();
    registerOpenEditor("p3", "main.tex", { revealLine, flush: async () => true, reload: async () => undefined })();
    showInOpenEditor("p3", "main.tex", 1);
    expect(revealLine).not.toHaveBeenCalled();
  });
});

// The open project's Files, Outline and Checklist trees are built from the project folder through core's builders.

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

// The project session opens and closes a project's tabs, folds the library away and keeps the sidebar's open project in step.

const project = (id: string, main: string | null = "main.tex"): ProjectEntry => ({
  kind: "ready", folder: `/projects/${id}`, location: "library", main: main ?? undefined, settings: { id, format: "latex" },
});
const snap = (id: string): SidebarOpenProject => ({ id, name: id, trees: [] });

function setup(snapshot: (entry: ProjectEntry, grouping: "kind" | "section") => Promise<SidebarOpenProject> = async (e) => snap(e.kind === "ready" ? e.settings.id : "")) {
  const events: string[] = [];
  const closeResults: boolean[] = [];
  const workspace = {
    openTab: jest.fn((kind: string, params?: Record<string, string>, group?: number) => { events.push(`open ${kind} ${JSON.stringify(params)} g${group}`); }),
    closeTabs: jest.fn(async (predicate: (id: string) => boolean) => {
      const ids = ["library", "source:a:main.tex", "preview:a", "source:b:main.tex", "preview:b", "templates"].filter(predicate);
      events.push(`close ${ids.join(",")}`);
      return closeResults.shift() ?? true;
    }),
  };
  const sidebar = {
    setOpenProject: jest.fn((s: SidebarOpenProject | undefined) => { events.push(`sidebar ${s?.id ?? "none"}`); }),
    collapseLibrary: jest.fn(() => { events.push("collapse"); }),
  };
  const onReveal = jest.fn();
  const session = createProjectSession({ workspace, snapshot, logger, onReveal });
  session.attachSidebar(sidebar);
  return { session, workspace, sidebar, events, closeResults, onReveal };
}

describe("createProjectSession", () => {
  it("opens main in group 0 and the preview in group 1, folds the library and sets the snapshot", async () => {
    const { session, events } = setup();
    expect(await session.openProject(project("a"))).toBe(true);
    expect(events).toEqual([
      'open source {"projectId":"a","path":"main.tex"} g0',
      'open preview {"projectId":"a"} g1',
      "collapse",
      "sidebar a",
    ]);
    expect(session.current()).toEqual(project("a"));
  });

  it("opens only the preview when the project has no main file", async () => {
    const { session, events } = setup();
    await session.openProject(project("a", null));
    expect(events.slice(0, 2)).toEqual(['open preview {"projectId":"a"} g1', "collapse"]);
  });

  it("closes the previous project's tabs first and keeps other tabs", async () => {
    const { session, events } = setup();
    await session.openProject(project("a"));
    events.length = 0;
    await session.openProject(project("b"));
    expect(events[0]).toBe("close source:a:main.tex,preview:a");
    expect(events.slice(1)).toEqual(["sidebar none", 'open source {"projectId":"b","path":"main.tex"} g0', 'open preview {"projectId":"b"} g1', "collapse", "sidebar b"]);
  });

  it("aborts opening when a tab of the previous project stays open", async () => {
    const { session, events, closeResults } = setup();
    await session.openProject(project("a"));
    events.length = 0;
    closeResults.push(false);
    expect(await session.openProject(project("b"))).toBe(false);
    expect(events).toEqual(["close source:a:main.tex,preview:a"]);
    expect(session.current()).toEqual(project("a"));
  });

  it("closes only the project's tabs and clears the sidebar", async () => {
    const { session, events } = setup();
    await session.openProject(project("a"));
    events.length = 0;
    expect(await session.closeProject()).toBe(true);
    expect(events).toEqual(["close source:a:main.tex,preview:a", "sidebar none"]);
    expect(session.current()).toBeUndefined();
  });

  it("keeps the project open when a tab refuses to close", async () => {
    const { session, sidebar, closeResults } = setup();
    await session.openProject(project("a"));
    sidebar.setOpenProject.mockClear();
    closeResults.push(false);
    expect(await session.closeProject()).toBe(false);
    expect(sidebar.setOpenProject).not.toHaveBeenCalled();
    expect(session.current()).toEqual(project("a"));
  });

  it("drops a snapshot that finishes after the project changed", async () => {
    const pending = new Map<string, (s: SidebarOpenProject) => void>();
    const { session, sidebar } = setup((entry) => new Promise((resolve) => { pending.set(entry.kind === "ready" ? entry.settings.id : "", resolve); }));
    const first = session.openProject(project("a"));
    await Promise.resolve();
    const closing = session.closeProject();
    pending.get("a")!(snap("a"));
    await first;
    await closing;
    expect(sidebar.setOpenProject.mock.calls.map(([s]) => s?.id)).toEqual([undefined]);
  });

  it("opens a clicked file in group 0 and routes outline clicks to onReveal", async () => {
    const { session, events, onReveal } = setup();
    await session.openProject(project("a"));
    events.length = 0;
    session.treeClick("files", "chapters/one.tex");
    expect(events).toEqual(['open source {"projectId":"a","path":"chapters/one.tex"} g0']);
    session.treeClick("outline", "main.tex:12");
    expect(onReveal).toHaveBeenCalledWith("main.tex", 12);
  });

  it("rebuilds the snapshot in the chosen checklist grouping", async () => {
    const snapshot = jest.fn(async (e: ProjectEntry, g: "kind" | "section") => snap(`${e.kind === "ready" ? e.settings.id : ""}-${g}`));
    const { session, sidebar } = setup(snapshot);
    await session.openProject(project("a"));
    await session.treeAction("bySection");
    expect(snapshot).toHaveBeenLastCalledWith(project("a"), "section");
    expect(sidebar.setOpenProject).toHaveBeenLastCalledWith(snap("a-section"));
    await session.treeAction("byKind");
    expect(snapshot).toHaveBeenLastCalledWith(project("a"), "kind");
  });

  it("opens the comments tab of the open project on the comments action and closes it with the project", async () => {
    const { session, events } = setup();
    await session.treeAction("comments");
    expect(events).toEqual([]);
    await session.openProject(project("a"));
    events.length = 0;
    await session.treeAction("comments");
    expect(events).toEqual(['open comments {"projectId":"a"} g1']);
  });

  it("opens the history tab of the open project on the history action", async () => {
    const { session, events } = setup();
    await session.openProject(project("a"));
    events.length = 0;
    await session.treeAction("history");
    expect(events).toEqual(['open history {"projectId":"a"} g1']);
  });
});
