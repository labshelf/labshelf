// Tests the All projects library: where each project is listed, its build, cites and detail, and what its mutations write.
import { readProjectCites } from "../../../../src/writing/allProjects/library/readProjectCitationCounts";
import { readProjectDetail } from "../../../../src/writing/allProjects/library/readProjectDetailPane";
import { libraryHarness, readyEntry } from "../../../support/projectLibraryHarness";

jest.mock("../../../../src/writing/allProjects/library/readProjectCitationCounts", () => ({
  readProjectCites: jest.fn(async () => ({ cites: 5, unresolved: 2 })),
}));
jest.mock("../../../../src/writing/allProjects/library/readProjectDetailPane", () => ({
  readProjectDetail: jest.fn(async (_context: unknown, request: { id: string }) => ({ id: request.id, citations: [] })),
}));

const A = "/lib/projects/a";

function setup() {
  const entries = [
    readyEntry(A, { settings: { id: "a", format: "latex", target: { venue: "NeurIPS", deadline: "2027-05-01" } } }),
    readyEntry("/lib/projects/b", { settings: { id: "b", format: "typst", archived: true, title: "Bee" } }),
    readyEntry("/lib/projects/c", { settings: { id: "c", format: "latex", trashed: "2026-01-01T00:00:00.000Z" } }),
    { kind: "broken" as const, folder: "/lib/projects/d", location: "library" as const, reason: "no labshelf.yaml" },
  ];
  const harness = libraryHarness(entries);
  harness.outcomes.last.mockImplementation((folder) => (folder === A ? { ok: true, at: new Date(7000) } : undefined));
  return harness;
}

describe("createProjectLibrary", () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it("lists each project in its place with its title, cites, build and target", async () => {
    const rows = await setup().library.list();
    expect(rows.map((row) => [row.title, row.place, row.cites, row.unresolvedCites, row.build?.state])).toEqual([
      ["a", "projects", 5, 2, "ok"], ["Bee", "archived", 5, 2, "never"], ["c", "trash", 5, 2, "never"], ["d", "projects", undefined, undefined, undefined],
    ]);
    expect(rows[0]).toMatchObject({ build: { state: "ok", at: 7000 }, target: { venue: "NeurIPS", deadline: "2027-05-01" } });
    expect(rows[1]).not.toHaveProperty("target");
    expect(rows[3]).toMatchObject({ broken: "no labshelf.yaml" });
  });

  it("dates a project without an outcome by its built PDF", async () => {
    const { library, locate, fs } = setup();
    locate.pdf.mockImplementation(async (project) => (project.folder === "/lib/projects/b" ? "/cache/b/main.pdf" : undefined));
    fs.files.set("/cache/b/main.pdf", new Uint8Array());
    fs.mtimes.set("/cache/b/main.pdf", 900);
    const rows = await library.list();
    expect(rows[1]?.build).toMatchObject({ state: "earlier", at: 900 });
  });

  it("reads cites with the main file filled into the settings", async () => {
    await setup().library.list();
    expect(readProjectCites).toHaveBeenCalledWith(expect.anything(), A, expect.objectContaining({ id: "a", main: "main.tex" }), expect.anything());
  });

  it("reuses the cites of a project until its modified time changes", async () => {
    const { library, data, listeners } = setup();
    data.lastModified.mockResolvedValue(100);
    await library.list();
    library.onDidChange(() => {});
    listeners.forEach((listener) => listener());
    await library.list();
    expect(readProjectCites).toHaveBeenCalledTimes(3);
    data.lastModified.mockResolvedValue(200);
    listeners.forEach((listener) => listener());
    await library.list();
    expect(readProjectCites).toHaveBeenCalledTimes(6);
  });

  it("serves the detail of a project from the core reader with the library papers and the build summary", async () => {
    const { library, papers } = setup();
    const detail = await library.detail(A);
    expect(detail.id).toBe(A);
    expect(readProjectDetail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: A, folder: A, papers, build: expect.objectContaining({ state: "ok", at: 7000 }), settings: expect.objectContaining({ main: "main.tex" }) }),
    );
  });

  it("returns the host's unsubscribe function from onDidChange", () => {
    const { library, unsubscribe } = setup();
    library.onDidChange(() => {})();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("writes the trash time to the project's yaml and reloads the list", async () => {
    const { library, projects } = setup();
    await library.setTrashed(A, true);
    expect(projects.update).toHaveBeenCalledWith(A, { trashed: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) });
    expect(projects.reload).toHaveBeenCalled();
  });

  it("clears the title when it renames back to the id", async () => {
    const { library, projects } = setup();
    await library.rename(A, "a");
    expect(projects.update).toHaveBeenCalledWith(A, { title: undefined });
  });

  it("rejects an id that is not in the library", async () => {
    await expect(setup().library.setTrashed("/nope", true)).rejects.toThrow("project /nope is not in the library");
  });

  it("rejects a mutation on a project that cannot be read", async () => {
    await expect(setup().library.setArchived("/lib/projects/d", true)).rejects.toThrow("cannot be read: no labshelf.yaml");
  });

  describe("deleteForever", () => {
    it("deletes the folder through the data port, logs it and reloads", async () => {
      const { library, data, projects, logger } = setup();
      await library.deleteForever("/lib/projects/b");
      expect(data.deleteProjectForever).toHaveBeenCalledWith("/lib", "/lib/projects/b");
      expect(logger.logs.map((log) => log.message)).toContain("project deleted forever");
      expect(projects.reload).toHaveBeenCalled();
    });

    it("refuses the project open in the host", async () => {
      const { library, data, host } = setup();
      host.isOpen.mockReturnValue(true);
      await expect(library.deleteForever(A)).rejects.toThrow("close the project before deleting it");
      expect(data.deleteProjectForever).not.toHaveBeenCalled();
    });

    it("refuses when no library is open", async () => {
      const { library, data } = libraryHarness([readyEntry(A)], { session: () => undefined });
      await expect(library.deleteForever(A)).rejects.toThrow("open a library");
      expect(data.deleteProjectForever).not.toHaveBeenCalled();
    });
  });

  describe("openFile", () => {
    it("opens the project first when another one is open", async () => {
      const { library, host } = setup();
      await library.openFile(A, "main.tex");
      expect(host.openProject).toHaveBeenCalledTimes(1);
      expect(host.openFile).toHaveBeenCalledWith(expect.objectContaining({ folder: A }), "main.tex");
    });

    it("skips opening the project when it is the open one", async () => {
      const { library, host } = setup();
      host.isOpen.mockReturnValue(true);
      await library.openFile(A, "main.tex");
      expect(host.openProject).not.toHaveBeenCalled();
    });
  });
});
