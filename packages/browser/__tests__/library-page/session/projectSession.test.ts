// The project session opens and closes a project's tabs, folds the library away and keeps the sidebar's open project in step.
import type { ILogger, ProjectEntry, SidebarOpenProject } from "@labshelf/core";
import { createProjectSession } from "../../../src/library-page/session/projectSession";

const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };

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
});
