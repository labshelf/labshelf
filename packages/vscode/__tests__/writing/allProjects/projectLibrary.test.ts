// Tests the All projects adapter: where each project is listed, its build, cites and detail, and what trashing writes to labshelf.yaml.
import * as vscode from "vscode";
import { readProjectCites, readProjectDetail } from "@labshelf/core/node";
import { createProjectLibrary } from "../../../src/writing/allProjects/projectLibrary";
import { fakeHost, fakeLogger, fakeProjects, readyEntry } from "../../support/writingFixtures";

jest.mock("@labshelf/core/node", () => ({
  ...jest.requireActual("@labshelf/core/node"),
  readProjectCites: jest.fn(async () => ({ cites: 5, unresolved: 2 })),
  readProjectDetail: jest.fn(async (request: { id: string }) => ({ id: request.id, citations: [] })),
}));

function setup() {
  (vscode.workspace.fs.stat as jest.Mock).mockRejectedValue(new Error("missing"));
  const entries = [
    readyEntry("/lib/projects/a", { settings: { id: "a", format: "latex", target: { venue: "NeurIPS", deadline: "2027-05-01" } } }),
    readyEntry("/lib/projects/b", { settings: { id: "b", format: "typst", archived: true, title: "Bee" } }),
    readyEntry("/lib/projects/c", { settings: { id: "c", format: "latex", trashed: "2026-01-01T00:00:00.000Z" } }),
  ];
  const projects = fakeProjects(entries);
  const sourceListeners: Array<() => void> = [];
  const source = {
    list: () => entries,
    find: (id: string) => entries.find((entry) => entry.folder === id),
    update: jest.fn(async () => {}),
    onDidChange: jest.fn((listener: () => void) => { sourceListeners.push(listener); return { dispose() {} }; }),
  };
  const outcomes = { last: jest.fn((folder: string) => (folder === "/lib/projects/a" ? { ok: true, at: new Date(7000) } : undefined)), onDidChange: jest.fn(() => ({ dispose() {} })) };
  const builds = { builtRoots: () => [], problemsOf: () => undefined, stateOf: () => undefined };
  const papers = [{ id: "p1" }];
  const library = createProjectLibrary({
    host: fakeHost(), projects: projects as never, session: { project: undefined }, source: source as never,
    outcomes: outcomes as never, builds, onDidChangeRootBuild: jest.fn(() => ({ dispose() {} })) as never,
    listPapers: async () => papers as never, logger: fakeLogger(), pdfjs: {} as never, recompile: jest.fn(async () => undefined),
  });
  return { library, source, projects, sourceListeners, outcomes, papers };
}

describe("createProjectLibrary", () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it("lists each project in its place with its title, cites, build and target", async () => {
    const rows = await setup().library.list();
    expect(rows.map((row) => [row.title, row.place, row.cites, row.unresolvedCites, row.build?.state])).toEqual([
      ["a", "projects", 5, 2, "ok"], ["Bee", "archived", 5, 2, "never"], ["c", "trash", 5, 2, "never"],
    ]);
    expect(rows[0]).toMatchObject({ build: { state: "ok", at: 7000 }, target: { venue: "NeurIPS", deadline: "2027-05-01" } });
    expect(rows[1]).not.toHaveProperty("target");
  });

  it("reads cites with the main file filled into the settings", async () => {
    await setup().library.list();
    expect(readProjectCites).toHaveBeenCalledWith("/lib/projects/a", expect.objectContaining({ id: "a", main: "main.tex" }), expect.anything());
  });

  it("reuses the cites of a project until its modified time changes", async () => {
    const { library, projects, sourceListeners } = setup();
    projects.data.lastModified.mockResolvedValue(100);
    await library.list();
    library.onDidChange(() => {});
    sourceListeners.forEach((listener) => listener());
    await library.list();
    expect(readProjectCites).toHaveBeenCalledTimes(3);
    projects.data.lastModified.mockResolvedValue(200);
    sourceListeners.forEach((listener) => listener());
    await library.list();
    expect(readProjectCites).toHaveBeenCalledTimes(6);
  });

  it("serves the detail of a project from the core reader with the library papers and the build summary", async () => {
    const { library, papers } = setup();
    const detail = await library.detail("/lib/projects/a");
    expect(detail.id).toBe("/lib/projects/a");
    expect(readProjectDetail).toHaveBeenCalledWith(
      expect.objectContaining({ id: "/lib/projects/a", folder: "/lib/projects/a", papers, build: expect.objectContaining({ state: "ok", at: 7000 }), settings: expect.objectContaining({ main: "main.tex" }) }),
      expect.anything(),
    );
  });

  it("writes the trash time to the project's yaml and reloads the list", async () => {
    const { library, source, projects } = setup();
    await library.setTrashed("/lib/projects/a", true);
    expect(source.update).toHaveBeenCalledWith("/lib/projects/a", { trashed: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) });
    expect(projects.reload).toHaveBeenCalled();
  });

  it("rejects an id that is not in the library", async () => {
    await expect(setup().library.setTrashed("/nope", true)).rejects.toThrow("project /nope is not in the library");
  });
});
