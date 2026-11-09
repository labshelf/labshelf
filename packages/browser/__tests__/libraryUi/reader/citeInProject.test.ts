import type { ILogger, LibraryFileSystem, PaperRecord, ProjectEntry } from "@labshelf/core";

jest.mock("webextension-polyfill", () => ({
  runtime: { getURL: (p: string) => `chrome-extension://ext/${p}` },
  extension: { getViews: jest.fn(() => []) },
  tabs: { create: jest.fn(async () => ({})) },
}));

import { createBrowserReaderCiteIo, createReaderCite } from "../../../src/libraryUi/reader/citeInProject";

type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;

const paper = { id: "p1", citeKey: "smith2020", doi: "10.1/x", path: "papers/ml/smith2020", title: "Smith T" } as PaperRecord;
const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) } as unknown as ILogger;

const project = {
  kind: "ready", folder: "projects/thesis", location: "library", main: "main.tex",
  settings: { id: "thesis", format: "latex" },
} as unknown as ReadyProject;

/** A library file system over a map of path to text; folders are implied by the paths. */
function memoryFs(files: Record<string, string>): { fs: LibraryFileSystem; files: Record<string, string> } {
  const fs = {
    readText: async (path: string) => {
      if (!(path in files)) throw new Error(`missing ${path}`);
      return files[path]!;
    },
    writeText: async (path: string, text: string) => { files[path] = text; },
    exists: async (path: string) => path in files,
    listDir: async (dir: string) => {
      const prefix = `${dir}/`;
      return [...new Set(Object.keys(files).filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length).split("/")[0]!))];
    },
    stat: async (path: string) => {
      if (path in files) return { isFile: true, isDirectory: false, mtimeMs: 0, size: files[path]!.length };
      return Object.keys(files).some((p) => p.startsWith(`${path}/`)) ? { isFile: false, isDirectory: true, mtimeMs: 0, size: 0 } : undefined;
    },
    ensureDir: async () => undefined,
  };
  return { fs: fs as unknown as LibraryFileSystem, files };
}

describe("createBrowserReaderCiteIo", () => {
  it("lists the project's files with their folders, and has no recent files", async () => {
    const { fs } = memoryFs({ "projects/thesis/main.tex": "a", "projects/thesis/chapters/one.tex": "b", "projects/thesis/.labshelf/x.tex": "c" });
    const io = createBrowserReaderCiteIo(fs, logger, async () => [paper]);
    expect((await io.listFiles(project)).sort()).toEqual(["chapters/one.tex", "main.tex"]);
    expect(io.recentFiles(project)).toEqual([]);
  });

  it("reads and splices through the library file system under the project folder", async () => {
    const { fs, files } = memoryFs({ "projects/thesis/main.tex": "Hello world" });
    const io = createBrowserReaderCiteIo(fs, logger, async () => [paper]);
    expect(await io.read(project, "main.tex")).toBe("Hello world");
    await io.insert(project, "main.tex", 5, "\\cite{smith2020}");
    expect(files["projects/thesis/main.tex"]).toBe("Hello\\cite{smith2020} world");
  });

  it("refreshBibliography regenerates labshelf.bib with the cached papers", async () => {
    const { fs, files } = memoryFs({ "projects/thesis/labshelf.yaml": "id: thesis\nformat: latex\n", "projects/thesis/main.tex": "A \\cite{smith2020}." });
    const listPapers = jest.fn(async () => [paper]);
    const io = createBrowserReaderCiteIo(fs, logger, listPapers);
    await io.refreshBibliography(project, "main.tex");
    expect(listPapers).toHaveBeenCalled();
    expect(files["projects/thesis/labshelf.bib"]).toContain("smith2020");
  });

  it("addToBibliography lists the paper in labshelf.yaml and writes labshelf.bib", async () => {
    const { fs, files } = memoryFs({ "projects/thesis/labshelf.yaml": "id: thesis\nformat: latex\ntitle: Thesis\n", "projects/thesis/main.tex": "x" });
    const io = createBrowserReaderCiteIo(fs, logger, async () => [paper]);
    await io.addToBibliography(project, paper);
    expect(files["projects/thesis/labshelf.yaml"]).toContain("smith2020");
    expect(files["projects/thesis/labshelf.bib"]).toContain("smith2020");
  });
});

describe("createReaderCite", () => {
  it("answers a targets request over the library's ready projects", async () => {
    const { fs } = memoryFs({
      "projects/thesis/labshelf.yaml": "id: thesis\nformat: latex\ntitle: Thesis\n",
      "projects/thesis/main.tex": "x",
    });
    const cite = createReaderCite(fs, logger, paper, async () => [paper]);
    const reply = await cite({ kind: "targets" });
    expect(reply).toMatchObject({ kind: "targets", projects: [{ id: "thesis", files: ["main.tex"] }] });
  });

  it("inserts the citation at the clicked place of a CRLF file and refuses a stale version", async () => {
    const { fs, files } = memoryFs({
      "projects/thesis/labshelf.yaml": "id: thesis\nformat: latex\n",
      "projects/thesis/main.tex": "one\r\ntwo",
    });
    const cite = createReaderCite(fs, logger, paper, async () => [paper]);
    const source = await cite({ kind: "read", projectId: "thesis", path: "main.tex" });
    if (source.kind !== "source") throw new Error("expected source");
    expect(source.text).toBe("one\ntwo");
    const inserted = await cite({ kind: "insert", projectId: "thesis", path: "main.tex", version: source.version, offset: 5, quoted: false });
    expect(inserted).toMatchObject({ kind: "inserted", path: "main.tex", citation: "\\cite{smith2020}" });
    expect(files["projects/thesis/main.tex"]).toBe("one\r\nt\\cite{smith2020}wo");
    const stale = await cite({ kind: "insert", projectId: "thesis", path: "main.tex", version: source.version, offset: 0, quoted: false });
    expect(stale).toMatchObject({ kind: "error", stale: true });
  });
});
