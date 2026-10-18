// Pins that the browser's All projects library lists the library folder's projects and opens one in the page's project session.
import { blankTemplate, type ILogger, type LibraryFileSystem, type LocalStat } from "@labshelf/core";
import { createBrowserProjectData, createBrowserProjectLibrary } from "../../../src/library-page/projects-data";

function memoryFs(): LibraryFileSystem {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>([""]);
  const addParents = (path: string): void => { for (let i = path.lastIndexOf("/"); i > 0; i = path.lastIndexOf("/", i - 1)) dirs.add(path.slice(0, i)); };
  const missing = (path: string): Error => Object.assign(new Error(`${path} not found`), { code: "ENOENT" });
  const stat = (isDirectory: boolean): LocalStat => ({ isFile: !isDirectory, isDirectory, mtimeMs: 1, size: 0 });
  const under = (dir: string, path: string): boolean => (dir === "" ? true : path.startsWith(`${dir}/`));
  const rest = (dir: string, path: string): string => (dir === "" ? path : path.slice(dir.length + 1));
  const fs: LibraryFileSystem = {
    writeFile: async (path, bytes) => { addParents(path); files.set(path, bytes); },
    writeText: async (path, text) => fs.writeFile(path, new TextEncoder().encode(text)),
    readFile: async (path) => { const bytes = files.get(path); if (!bytes) throw missing(path); return bytes; },
    readText: async (path) => new TextDecoder().decode(await fs.readFile(path)),
    exists: async (path) => files.has(path) || dirs.has(path),
    stat: async (path) => (files.has(path) ? stat(false) : dirs.has(path) ? stat(true) : undefined),
    listDir: async (dir) => {
      if (!dirs.has(dir)) return [];
      const names = [...files.keys(), ...dirs].filter((p) => p !== dir && under(dir, p)).map((p) => rest(dir, p).split("/")[0]!);
      return [...new Set(names)];
    },
    ensureDir: async (dir) => { addParents(`${dir}/x`); },
    mkdir: async (dir) => { addParents(`${dir}/x`); },
    deleteFile: async (path) => { files.delete(path); },
    removeTree: async (path) => { for (const p of [...files.keys()]) if (p === path || p.startsWith(`${path}/`)) files.delete(p); for (const d of [...dirs]) if (d === path || d.startsWith(`${path}/`)) dirs.delete(d); },
    trash: async (path) => fs.removeTree(path),
    rename: async (from, to) => {
      for (const [p, bytes] of [...files]) if (p === from || p.startsWith(`${from}/`)) { files.delete(p); await fs.writeFile(to + p.slice(from.length), bytes); }
      for (const d of [...dirs]) if (d === from || d.startsWith(`${from}/`)) { dirs.delete(d); dirs.add(to + d.slice(from.length)); }
    },
  };
  return fs;
}

const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) } as unknown as ILogger;

async function libraryWithOneProject() {
  const fs = memoryFs();
  const created = await createBrowserProjectData({ fs, logger }).createProjectFromTemplate("", { title: "Deep nets", ...blankTemplate("typst", "Deep nets") });
  const workspace = { openTab: jest.fn() };
  const session = { openProject: jest.fn(async () => true), current: jest.fn(() => undefined) };
  const library = createBrowserProjectLibrary({
    fs, logger, workspace, session, pdfjs: { load: jest.fn(), getDocument: jest.fn() }, listPapers: async () => [], askBlank: async () => undefined,
  });
  return { created, session, library };
}

describe("createBrowserProjectLibrary", () => {
  it("lists the projects of the library folder", async () => {
    const { created, library } = await libraryWithOneProject();
    await new Promise((resolve) => library.onDidChange(() => resolve(undefined)));
    const rows = await library.list();
    expect(rows.map((row) => row.title)).toEqual(["deep-nets"]);
    expect(created.kind).toBe("ready");
  });

  it("opens a project through the session", async () => {
    const { created, session, library } = await libraryWithOneProject();
    await new Promise((resolve) => library.onDidChange(() => resolve(undefined)));
    const [row] = await library.list();
    await library.open(row!.id);
    expect(session.openProject).toHaveBeenCalledWith(expect.objectContaining({ folder: created.folder }));
  });
});
