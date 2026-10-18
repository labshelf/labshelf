// Pins the labshelf-project: file system over the project store: reads, directory listing, and writes that never lose a concurrent edit.
import type { ILogger, ProjectEntry } from "@labshelf/core";
import { createProjectFileSystemProvider, FileChangeType, FileType, type ProjectUri } from "../../../src/editor/fileSystem";
import { ProjectFileNotFoundError } from "../../../src/storage/projects";

const text = new TextEncoder();
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const uri = (path: string, scheme = "labshelf-project"): ProjectUri => ({ scheme, path });

function ready(id: string, main: string | undefined): ProjectEntry {
  return {
    kind: "ready", folder: `projects/${id}`, location: "library", main,
    settings: { id, format: "typst" } as Extract<ProjectEntry, { kind: "ready" }>["settings"],
  };
}

function setup() {
  const files = new Map<string, Uint8Array>([
    ["thesis/main.typ", text.encode("= Thesis")],
    ["thesis/chapters/intro.typ", text.encode("Intro")],
    ["deep/src/paper.typ", text.encode("Deep")],
  ]);
  const entries: ProjectEntry[] = [
    ready("thesis", "main.typ"),
    ready("deep", "src/paper.typ"),
    { kind: "broken", folder: "projects/bad", location: "library", reason: "labshelf.yaml is missing" },
  ];
  const projects = {
    listBrowserProjects: jest.fn(async () => entries),
    readProjectFile: jest.fn(async (id: string, path: string) => {
      const found = files.get(`${id}/${path}`);
      if (found === undefined) throw new ProjectFileNotFoundError(id, path);
      return found;
    }),
    writeProjectFile: jest.fn(async (id: string, path: string, bytes: Uint8Array) => { files.set(`${id}/${path}`, bytes); }),
    listProjectDirectory: jest.fn(async (id: string, path: string) => {
      const prefix = path === "" ? `${id}/` : `${id}/${path}/`;
      const names = new Map<string, "file" | "directory">();
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const [name, ...rest] = key.slice(prefix.length).split("/");
        names.set(name!, rest.length > 0 ? "directory" : "file");
      }
      return [...names].map(([name, kind]) => ({ name, kind }));
    }),
    statProjectPath: jest.fn(async (id: string, path: string) => {
      const bytes = files.get(`${id}/${path}`);
      if (bytes !== undefined) return { isFile: true, isDirectory: false, mtimeMs: 42, size: bytes.length };
      const folder = path === "" ? `${id}/` : `${id}/${path}/`;
      return [...files.keys()].some((key) => key.startsWith(folder)) ? { isFile: false, isDirectory: true, mtimeMs: 0, size: 0 } : undefined;
    }),
  };
  const logger: ILogger & { error: jest.Mock } = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
  const provider = createProjectFileSystemProvider({ projects, logger });
  return { files, projects, logger, provider };
}

describe("readFile and stat", () => {
  it("reads a project file's bytes through the store", async () => {
    const { provider, projects } = setup();
    expect(decode(await provider.readFile(uri("/thesis/chapters/intro.typ")))).toBe("Intro");
    expect(projects.readProjectFile).toHaveBeenCalledWith("thesis", "chapters/intro.typ");
  });

  it("fails a missing file with EntryNotFound and logs nothing", async () => {
    const { provider, logger } = setup();
    await expect(provider.readFile(uri("/thesis/.vscode/settings.json"))).rejects.toMatchObject({ code: "EntryNotFound" });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("fails an unreadable file as unavailable, not as missing", async () => {
    const { provider, projects } = setup();
    projects.readProjectFile.mockRejectedValueOnce(new Error("bridge down"));
    await expect(provider.readFile(uri("/thesis/main.typ"))).rejects.toMatchObject({ code: "Unavailable" });
  });

  it("refuses another scheme and the library or project folders as files", async () => {
    const { provider } = setup();
    await expect(provider.readFile(uri("/thesis/main.typ", "file"))).rejects.toMatchObject({ code: "Unavailable" });
    await expect(provider.readFile(uri("/"))).rejects.toMatchObject({ code: "EntryIsADirectory" });
    await expect(provider.readFile(uri("/thesis"))).rejects.toMatchObject({ code: "EntryIsADirectory" });
  });

  it("stats the root and projects as directories and a file with its size", async () => {
    const { provider } = setup();
    expect((await provider.stat(uri("/"))).type).toBe(FileType.Directory);
    expect((await provider.stat(uri("/thesis"))).type).toBe(FileType.Directory);
    expect((await provider.stat(uri("/deep/src"))).type).toBe(FileType.Directory);
    expect(await provider.stat(uri("/thesis/chapters"))).toMatchObject({ type: FileType.Directory });
    expect(await provider.stat(uri("/thesis/main.typ"))).toMatchObject({ type: FileType.File, size: 8, mtime: 42 });
    await expect(provider.stat(uri("/ghost"))).rejects.toMatchObject({ code: "EntryNotFound" });
    await expect(provider.stat(uri("/thesis/none.typ"))).rejects.toMatchObject({ code: "EntryNotFound" });
  });
});

describe("readDirectory", () => {
  it("lists the ready projects at the root and skips broken ones", async () => {
    const { provider } = setup();
    expect(await provider.readDirectory(uri("/"))).toEqual([["thesis", FileType.Directory], ["deep", FileType.Directory]]);
  });

  it("lists every file and folder of a project through the store", async () => {
    const { provider, projects } = setup();
    expect(await provider.readDirectory(uri("/thesis"))).toEqual([["main.typ", FileType.File], ["chapters", FileType.Directory]]);
    expect(await provider.readDirectory(uri("/thesis/chapters"))).toEqual([["intro.typ", FileType.File]]);
    expect(projects.listProjectDirectory).toHaveBeenCalledWith("thesis", "chapters");
  });

  it("fails for a project the store does not list", async () => {
    const { provider } = setup();
    await expect(provider.readDirectory(uri("/ghost"))).rejects.toMatchObject({ code: "EntryNotFound" });
  });
});

describe("writeFile", () => {
  it("reaches the store with the project id and relative path", async () => {
    const { provider, files } = setup();
    await provider.readFile(uri("/thesis/main.typ"));
    await provider.writeFile(uri("/thesis/main.typ"), text.encode("= Edited"), { create: false, overwrite: true });
    expect(decode(files.get("thesis/main.typ") as Uint8Array)).toBe("= Edited");
  });

  it("creates a file that does not exist when create is set, and announces it", async () => {
    const { provider, files } = setup();
    const seen: Array<{ type: number; resource: ProjectUri }> = [];
    provider.onDidChangeFile((changes) => seen.push(...changes));
    await provider.writeFile(uri("/thesis/refs.bib"), text.encode("@x"), { create: true, overwrite: false });
    expect(decode(files.get("thesis/refs.bib") as Uint8Array)).toBe("@x");
    expect(seen).toEqual([{ type: FileChangeType.Created, resource: uri("/thesis/refs.bib") }]);
  });

  it("announces a change after overwriting a read file", async () => {
    const { provider } = setup();
    const seen: number[] = [];
    provider.onDidChangeFile((changes) => seen.push(...changes.map((change) => change.type)));
    await provider.readFile(uri("/thesis/main.typ"));
    await provider.writeFile(uri("/thesis/main.typ"), text.encode("x"), { create: false, overwrite: true });
    expect(seen).toEqual([FileChangeType.Changed]);
  });

  it("refuses to create over an existing file or to write a missing file without create", async () => {
    const { provider, files } = setup();
    await expect(provider.writeFile(uri("/thesis/main.typ"), text.encode("x"), { create: true, overwrite: false }))
      .rejects.toMatchObject({ code: "EntryExists" });
    await expect(provider.writeFile(uri("/thesis/none.typ"), text.encode("x"), { create: false, overwrite: true }))
      .rejects.toMatchObject({ code: "EntryNotFound" });
    expect(decode(files.get("thesis/main.typ") as Uint8Array)).toBe("= Thesis");
  });

  it("fails and keeps the stored text when the file changed since the editor read it", async () => {
    const { provider, files, projects, logger } = setup();
    await provider.readFile(uri("/thesis/main.typ"));
    files.set("thesis/main.typ", text.encode("= Edited elsewhere"));
    await expect(provider.writeFile(uri("/thesis/main.typ"), text.encode("= Mine"), { create: false, overwrite: true }))
      .rejects.toThrow(/changed since/);
    expect(projects.writeProjectFile).not.toHaveBeenCalled();
    expect(decode(files.get("thesis/main.typ") as Uint8Array)).toBe("= Edited elsewhere");
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("refuses to create a file whose existence the store cannot tell, and keeps it", async () => {
    const { provider, projects } = setup();
    projects.readProjectFile.mockRejectedValueOnce(new Error("bridge down"));
    await expect(provider.writeFile(uri("/thesis/main.typ"), text.encode("x"), { create: true, overwrite: true })).rejects.toMatchObject({ code: "Unavailable" });
    expect(projects.writeProjectFile).not.toHaveBeenCalled();
  });

  it("overwrites an existing file the editor never read, as a rebuild of a generated PDF does", async () => {
    const { provider, projects } = setup();
    await provider.writeFile(uri("/thesis/main.typ"), text.encode("x"), { create: false, overwrite: true });
    expect(projects.writeProjectFile).toHaveBeenCalledWith("thesis", "main.typ", text.encode("x"));
  });

  it("accepts consecutive saves and treats each written text as the new baseline", async () => {
    const { provider, files } = setup();
    await provider.readFile(uri("/thesis/main.typ"));
    await provider.writeFile(uri("/thesis/main.typ"), text.encode("one"), { create: false, overwrite: true });
    await provider.writeFile(uri("/thesis/main.typ"), text.encode("two"), { create: false, overwrite: true });
    expect(decode(files.get("thesis/main.typ") as Uint8Array)).toBe("two");
  });

  it("applies overlapping writes in order", async () => {
    const { provider, files } = setup();
    await provider.readFile(uri("/thesis/main.typ"));
    const first = provider.writeFile(uri("/thesis/main.typ"), text.encode("A"), { create: false, overwrite: true });
    const second = provider.writeFile(uri("/thesis/main.typ"), text.encode("B"), { create: false, overwrite: true });
    await Promise.all([first, second]);
    expect(decode(files.get("thesis/main.typ") as Uint8Array)).toBe("B");
  });

  it("logs a failed write with its context and rethrows so the editor keeps its text", async () => {
    const { provider, projects, logger } = setup();
    await provider.readFile(uri("/thesis/main.typ"));
    projects.writeProjectFile.mockRejectedValueOnce(new Error("disk full"));
    await expect(provider.writeFile(uri("/thesis/main.typ"), text.encode("x"), { create: false, overwrite: true }))
      .rejects.toMatchObject({ code: "Unavailable", message: expect.stringContaining("disk full") });
    expect(logger.error).toHaveBeenCalledWith(expect.any(String), expect.any(Error), expect.objectContaining({ project: "thesis", path: "main.typ" }));
  });

  it("keeps the old baseline after a failed write so a retry still succeeds", async () => {
    const { provider, projects, files } = setup();
    await provider.readFile(uri("/thesis/main.typ"));
    projects.writeProjectFile.mockRejectedValueOnce(new Error("disk full"));
    await expect(provider.writeFile(uri("/thesis/main.typ"), text.encode("x"), { create: false, overwrite: true })).rejects.toThrow();
    await provider.writeFile(uri("/thesis/main.typ"), text.encode("x"), { create: false, overwrite: true });
    expect(decode(files.get("thesis/main.typ") as Uint8Array)).toBe("x");
  });

  it("refuses to write a directory path", async () => {
    const { provider } = setup();
    await expect(provider.writeFile(uri("/thesis"), text.encode("x"), { create: true, overwrite: true }))
      .rejects.toMatchObject({ code: "EntryIsADirectory" });
  });
});

describe("operations the project store cannot do", () => {
  it("rejects delete, rename and createDirectory with NoPermissions", async () => {
    const { provider } = setup();
    await expect(provider.delete(uri("/thesis/main.typ"), { recursive: false })).rejects.toMatchObject({ code: "NoPermissions" });
    await expect(provider.rename(uri("/thesis/main.typ"), uri("/thesis/a.typ"), { overwrite: false })).rejects.toMatchObject({ code: "NoPermissions" });
    await expect(provider.createDirectory(uri("/thesis/new"))).rejects.toMatchObject({ code: "NoPermissions" });
  });

  it("watch returns a disposable", () => {
    const { provider } = setup();
    expect(() => provider.watch(uri("/thesis"), { recursive: true, excludes: [] }).dispose()).not.toThrow();
  });
});
