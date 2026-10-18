// Pins how the browser lists library projects and reads and writes their files through the folder file system.
import type { ILogger } from "@labshelf/core";
import { MemoryFolderFs } from "../move/memoryFolderFs";
import { createBrowserProjects } from "../../../src/storage/projects";

function makeLogger(): ILogger & { log: jest.Mock; error: jest.Mock } {
  return { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
}

function setup() {
  const fileSystem = new MemoryFolderFs();
  fileSystem.put("projects/thesis/labshelf.yaml", "id: thesis\nformat: latex\n");
  fileSystem.put("projects/thesis/main.tex", "\\documentclass{article}\n\\begin{document}\\end{document}\n");
  fileSystem.put("projects/thesis/chapters/intro.tex", "Intro");
  fileSystem.put("projects/notes/labshelf.yaml", "id: notes\nformat: typst\nmain: paper.typ\n");
  fileSystem.put("projects/notes/paper.typ", "= Notes");
  const logger = makeLogger();
  return { fileSystem, logger, projects: createBrowserProjects({ fileSystem, logger }) };
}

describe("listBrowserProjects", () => {
  it("returns ready library entries with the main file from labshelf.yaml or detected", async () => {
    const { fileSystem, projects } = setup();
    fileSystem.put("projects/.DS_Store", "");
    fileSystem.put("projects/stray.txt", "not a project");
    const entries = await projects.listBrowserProjects();
    const byFolder = Object.fromEntries(entries.map((entry) => [entry.folder, entry]));
    expect(Object.keys(byFolder).sort()).toEqual(["projects/notes", "projects/thesis"]);
    expect(byFolder["projects/thesis"]).toMatchObject({ kind: "ready", location: "library", main: "main.tex", settings: { id: "thesis" } });
    expect(byFolder["projects/notes"]).toMatchObject({ kind: "ready", location: "library", main: "paper.typ", settings: { id: "notes" } });
  });

  it("lists nothing when the projects folder is missing", async () => {
    const logger = makeLogger();
    const projects = createBrowserProjects({ fileSystem: new MemoryFolderFs(), logger });
    expect(await projects.listBrowserProjects()).toEqual([]);
  });

  it("gives broken entries for a missing or unparseable labshelf.yaml and logs a warning", async () => {
    const { fileSystem, logger, projects } = setup();
    fileSystem.put("projects/empty/main.tex", "x");
    fileSystem.put("projects/bad/labshelf.yaml", "format: nonsense\n");
    const entries = await projects.listBrowserProjects();
    const empty = entries.find((entry) => entry.folder === "projects/empty");
    const bad = entries.find((entry) => entry.folder === "projects/bad");
    expect(empty).toEqual({ kind: "broken", folder: "projects/empty", location: "library", reason: "labshelf.yaml is missing" });
    expect(bad).toMatchObject({ kind: "broken", location: "library" });
    expect(bad?.kind === "broken" && bad.reason.startsWith("labshelf.yaml: ")).toBe(true);
    const warned = logger.log.mock.calls.filter(([level]) => level === "WARN").map((call) => call[3]?.folder);
    expect(warned.sort()).toEqual(["projects/bad", "projects/empty"]);
  });
});

describe("readProjectFile and writeProjectFile", () => {
  it("read and write reach the file system under the project folder", async () => {
    const { fileSystem, projects } = setup();
    const read = jest.spyOn(fileSystem, "readFile");
    const write = jest.spyOn(fileSystem, "writeFile");
    const bytes = await projects.readProjectFile("thesis", "chapters/intro.tex");
    expect(new TextDecoder().decode(bytes)).toBe("Intro");
    expect(read).toHaveBeenLastCalledWith("projects/thesis/chapters/intro.tex");
    await projects.writeProjectFile("notes", "paper.typ", new TextEncoder().encode("= Changed"));
    expect(write).toHaveBeenLastCalledWith("projects/notes/paper.typ", expect.any(Uint8Array));
    expect(fileSystem.text("projects/notes/paper.typ")).toBe("= Changed");
  });

  it.each(["../other/x.tex", "/etc/passwd", "C:/x.tex", "a\\b.tex", "a//b.tex", "", "chapters/../../x", "./"])(
    "refuses the escaping path %p before any file system call",
    async (path) => {
      const { fileSystem, projects } = setup();
      const calls = (["listDir", "readFile", "writeFile", "stat"] as const).map((name) => jest.spyOn(fileSystem, name));
      await expect(projects.readProjectFile("thesis", path)).rejects.toThrow(/path/i);
      await expect(projects.writeProjectFile("thesis", path, new Uint8Array())).rejects.toThrow(/path/i);
      for (const call of calls) expect(call).not.toHaveBeenCalled();
    },
  );

  it("refuses an unknown project id, naming it", async () => {
    const { fileSystem, projects } = setup();
    const write = jest.spyOn(fileSystem, "writeFile");
    await expect(projects.readProjectFile("missing-id", "main.tex")).rejects.toThrow(/missing-id/);
    await expect(projects.writeProjectFile("missing-id", "main.tex", new Uint8Array())).rejects.toThrow(/missing-id/);
    expect(write).not.toHaveBeenCalled();
  });

  it("logs a file system failure with project and path and rethrows it", async () => {
    const { fileSystem, logger, projects } = setup();
    fileSystem.failWriteOn = "projects/thesis/main.tex";
    await expect(projects.writeProjectFile("thesis", "main.tex", new Uint8Array([1]))).rejects.toThrow(/disk full/);
    expect(logger.error).toHaveBeenCalledWith(expect.any(String), expect.any(Error),
      { project: "thesis", path: "main.tex", action: "write" });
    await expect(projects.readProjectFile("thesis", "absent.tex")).rejects.toThrow(/missing/);
    expect(logger.error).toHaveBeenLastCalledWith(expect.any(String), expect.any(Error),
      { project: "thesis", path: "absent.tex", action: "read" });
  });

  it("logs a bridge failure while finding the project with project and path and rethrows it", async () => {
    const { fileSystem, logger, projects } = setup();
    jest.spyOn(fileSystem, "readText").mockRejectedValue(new Error("bridge down"));
    await expect(projects.readProjectFile("thesis", "main.tex")).rejects.toThrow(/bridge down/);
    expect(logger.error).toHaveBeenCalledWith(expect.any(String), expect.any(Error),
      { project: "thesis", path: "main.tex", action: "read" });
  });

  it("finds the project by reading only labshelf.yaml files", async () => {
    const { fileSystem, projects } = setup();
    const readText = jest.spyOn(fileSystem, "readText");
    await projects.readProjectFile("thesis", "main.tex");
    for (const [path] of readText.mock.calls) expect(path).toMatch(/^projects\/[^/]+\/labshelf\.yaml$/);
  });
});
