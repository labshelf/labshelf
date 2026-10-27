/** Verifies the project writes: installing from a template, registering an existing folder, changing settings and deleting forever. */
import {
  addExistingFolder, createBlankTemplate, createProjectFromTemplate, listProjects, removeProjectFolderForever, updateProjectSettings,
  type ProjectTemplate,
} from "@labshelf/core";

import { MemoryLibraryFs } from "../../support/memoryLibraryFs";
import { LIB, filesUnder, memoryCatalog, readText, writeTree, type MemoryCatalog } from "../../support/memoryProjectCatalog";

const enc = (text: string) => new TextEncoder().encode(text);
const latex: ProjectTemplate = { id: "ieee", format: "latex", main: "main.tex", engine: "xelatex" };

/** Fails the write of any file whose path ends with `failOn`. */
class FailingWriteFs extends MemoryLibraryFs {
  failOn: string | undefined;
  override async writeFile(file: string, content: Uint8Array): Promise<void> {
    if (this.failOn !== undefined && file.endsWith(this.failOn)) { throw new Error("disk full"); }
    await super.writeFile(file, content);
  }
}

/** Renames into an existing folder by merging, as some stores do. */
class MergingRenameFs extends MemoryLibraryFs {
  /** Runs once the staged labshelf.yaml is written, to make a folder appear between the id claim and the move. */
  afterStaging: (() => Promise<void>) | undefined;
  override async rename(from: string, to: string): Promise<void> {
    for (const file of this.fileList().filter((path) => path.startsWith(`${from}/`))) {
      this.files.set(to + file.slice(from.length), this.files.get(file)!);
      this.files.delete(file);
    }
    this.renames.push([from, to]);
  }
  override async writeFile(file: string, content: Uint8Array): Promise<void> {
    await super.writeFile(file, content);
    if (file.includes("/staging/") && file.endsWith("/labshelf.yaml")) { await this.afterStaging?.(); }
  }
}

function nothingLeft(context: MemoryCatalog): void {
  expect(filesUnder(context.fs, `${LIB}/projects/t`)).toEqual([]);
  expect(filesUnder(context.fs, `${LIB}/.research/staging`)).toEqual([]);
}

describe("createProjectFromTemplate", () => {
  it("writes nested files at their paths and labshelf.yaml with the engine of a latex template", async () => {
    const context = memoryCatalog();
    const figure = new Uint8Array([0, 255, 1, 128]);
    const files = [
      { path: "main.tex", bytes: enc("\\input{sections/intro}") },
      { path: "sections/intro.tex", bytes: enc("Hello") },
      { path: "figures/a.png", bytes: figure },
    ];
    const entry = await createProjectFromTemplate(context, LIB, { title: "T", template: latex, files });
    const folder = `${LIB}/projects/t`;
    expect(filesUnder(context.fs, folder)).toEqual(["figures/a.png", "labshelf.yaml", "main.tex", "sections/intro.tex"]);
    expect(readText(context.fs, `${folder}/sections/intro.tex`)).toBe("Hello");
    expect(context.fs.files.get(`${folder}/figures/a.png`)).toEqual(figure);
    expect(readText(context.fs, `${folder}/labshelf.yaml`)).toBe("id: t\nformat: latex\nmain: main.tex\nengine: xelatex\n");
    expect(entry).toMatchObject({ kind: "ready", folder, location: "library", main: "main.tex" });
    nothingLeftInStaging(context);
  });

  it("does not write an engine for a typst template", async () => {
    const context = memoryCatalog();
    const template: ProjectTemplate = { id: "paper", format: "typst", main: "main.typ", engine: "xelatex" };
    await createProjectFromTemplate(context, LIB, { title: "T", template, files: [{ path: "main.typ", bytes: enc("= A") }] });
    expect(readText(context.fs, `${LIB}/projects/t/labshelf.yaml`)).toBe("id: t\nformat: typst\nmain: main.typ\n");
  });

  it("omits the engine when a latex template has none", async () => {
    const context = memoryCatalog();
    const template: ProjectTemplate = { id: "x", format: "latex", main: "main.tex" };
    await createProjectFromTemplate(context, LIB, { title: "T", template, files: [{ path: "main.tex", bytes: enc("x") }] });
    expect(readText(context.fs, `${LIB}/projects/t/labshelf.yaml`)).toBe("id: t\nformat: latex\nmain: main.tex\n");
  });

  it.each([["../evil.tex"], ["/etc/x"]])("rejects the path %s naming it and writes nothing", async (bad) => {
    const context = memoryCatalog();
    const files = [{ path: "main.tex", bytes: enc("x") }, { path: bad, bytes: enc("y") }];
    await expect(createProjectFromTemplate(context, LIB, { title: "T", template: latex, files }))
      .rejects.toThrow(new RegExp(bad.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")));
    expect(context.fs.writes).toBe(0);
  });

  it("rejects a tree that breaks a tree rule (labshelf.yaml among the files) and writes nothing", async () => {
    const context = memoryCatalog();
    const files = [{ path: "main.tex", bytes: enc("x") }, { path: "labshelf.yaml", bytes: enc("id: z") }];
    await expect(createProjectFromTemplate(context, LIB, { title: "T", template: latex, files })).rejects.toThrow(/labshelf\.yaml/);
    expect(context.fs.writes).toBe(0);
  });

  it("rejects a main file that is not among the files and writes nothing", async () => {
    const context = memoryCatalog();
    const files = [{ path: "other.tex", bytes: enc("x") }];
    await expect(createProjectFromTemplate(context, LIB, { title: "T", template: latex, files })).rejects.toThrow(/main\.tex/);
    expect(context.fs.writes).toBe(0);
  });

  it("removes the staging folder, leaves no project and logs the template id when a write fails mid-copy", async () => {
    const fs = new FailingWriteFs();
    fs.failOn = "sections/intro.tex";
    const context = memoryCatalog(fs);
    const files = [{ path: "main.tex", bytes: enc("x") }, { path: "sections/intro.tex", bytes: enc("y") }];
    await expect(createProjectFromTemplate(context, LIB, { title: "T", template: latex, files })).rejects.toThrow(/intro\.tex/);
    nothingLeft(context);
    expect([...fs.dirs].filter((dir) => dir.startsWith(`${LIB}/.research/staging/`))).toEqual([]);
    expect(context.logger.errors).toHaveLength(1);
    expect(JSON.stringify(context.logger.errors[0]!.context)).toContain("ieee");
  });

  it("leaves a folder that appeared after the id was claimed untouched, even when the store's rename merges", async () => {
    const fs = new MergingRenameFs();
    const context = memoryCatalog(fs);
    fs.afterStaging = () => writeTree(fs, `${LIB}/projects/t`, { "mine.tex": "keep" });
    const files = [{ path: "main.tex", bytes: enc("x") }];
    await expect(createProjectFromTemplate(context, LIB, { title: "T", template: latex, files })).rejects.toThrow(/moving into/);
    expect(filesUnder(fs, `${LIB}/projects/t`)).toEqual(["mine.tex"]);
    nothingLeftInStaging(context);
  });

  it("logs 'project created' at INFO with the template id", async () => {
    const context = memoryCatalog();
    await createProjectFromTemplate(context, LIB, { title: "T", template: latex, files: [{ path: "main.tex", bytes: enc("x") }] });
    expect(context.logger.logs.filter((entry) => entry.message === "project created")).toEqual([
      expect.objectContaining({ level: "INFO" }),
    ]);
  });

  it("gives a second project with the same title the suffix a", async () => {
    const context = memoryCatalog();
    const request = { title: "Thesis", ...createBlankTemplate("latex", "Thesis") };
    await createProjectFromTemplate(context, LIB, request);
    const second = await createProjectFromTemplate(context, LIB, request);
    expect(second.kind === "ready" && second.settings.id).toBe("thesisa");
    expect(second.folder).toBe(`${LIB}/projects/thesisa`);
  });

  it("skips an id a registered folder outside the library already uses", async () => {
    const context = memoryCatalog();
    await writeTree(context.fs, "/elsewhere/p", { "labshelf.yaml": "id: thesis\nformat: latex\n" });
    await context.registry.register(LIB, "/elsewhere/p");
    const entry = await createProjectFromTemplate(context, LIB, { title: "Thesis", ...createBlankTemplate("latex", "Thesis") });
    expect(entry.kind === "ready" && entry.settings.id).toBe("thesisa");
  });
});

function nothingLeftInStaging(context: MemoryCatalog): void {
  expect(filesUnder(context.fs, `${LIB}/.research/staging`)).toEqual([]);
}

describe("createProjectFromTemplate with blank templates", () => {
  it("creates the blank LaTeX article exactly", async () => {
    const context = memoryCatalog();
    await createProjectFromTemplate(context, LIB, { title: "Deep Nets: a Survey", ...createBlankTemplate("latex", "Deep Nets: a Survey") });
    const folder = `${LIB}/projects/deep-nets-a-survey`;
    expect(filesUnder(context.fs, folder)).toEqual(["labshelf.yaml", "main.tex"]);
    expect(readText(context.fs, `${folder}/labshelf.yaml`)).toBe("id: deep-nets-a-survey\nformat: latex\nmain: main.tex\n");
    expect(readText(context.fs, `${folder}/main.tex`)).toBe([
      "\\documentclass{article}", "\\usepackage{hyperref}", "", "\\title{Deep Nets: a Survey}", "\\author{}", "\\date{\\today}", "",
      "\\begin{document}", "\\maketitle", "", "\\section{Introduction}", "", "\\end{document}", "",
    ].join("\n"));
  });

  it("creates the blank Typst article exactly", async () => {
    const context = memoryCatalog();
    await createProjectFromTemplate(context, LIB, { title: "Notes", ...createBlankTemplate("typst", "Notes") });
    const folder = `${LIB}/projects/notes`;
    expect(filesUnder(context.fs, folder)).toEqual(["labshelf.yaml", "main.typ"]);
    expect(readText(context.fs, `${folder}/labshelf.yaml`)).toBe("id: notes\nformat: typst\nmain: main.typ\n");
    expect(readText(context.fs, `${folder}/main.typ`)).toBe([
      '#let title = "Notes"', "#set document(title: title)", '#set page(paper: "a4", numbering: "1")',
      '#set heading(numbering: "1.")', "", '#align(center, text(17pt, weight: "bold", title))', "", "= Introduction", "",
    ].join("\n"));
  });
});

describe("addExistingFolder", () => {
  it("writes labshelf.yaml only, registers the folder and lists it as external", async () => {
    const context = memoryCatalog();
    const folder = "/outside/My Paper";
    await writeTree(context.fs, folder, { "main.tex": "\\documentclass{article}", ".git/HEAD": "ref" });
    const before = filesUnder(context.fs, folder);

    const entry = await addExistingFolder(context, LIB, { folder, format: "latex" });

    expect(entry).toMatchObject({ kind: "ready", folder, location: "external", main: "main.tex", settings: { id: "my-paper" } });
    expect(filesUnder(context.fs, folder)).toEqual([...before, "labshelf.yaml"].sort());
    expect(readText(context.fs, `${folder}/main.tex`)).toBe("\\documentclass{article}");
    expect(await context.registry.folders(LIB)).toEqual([folder]);
    const listed = await listProjects(context, LIB, await context.registry.folders(LIB));
    expect(listed.map((e) => [e.folder, e.location])).toEqual([[folder, "external"]]);
  });

  it("leaves an existing valid labshelf.yaml byte-identical", async () => {
    const context = memoryCatalog();
    const text = "# keep\nid: mine\nformat: typst\nextra: 1\n";
    await writeTree(context.fs, "/outside/p", { "labshelf.yaml": text });
    await addExistingFolder(context, LIB, { folder: "/outside/p", format: "latex" });
    expect(readText(context.fs, "/outside/p/labshelf.yaml")).toBe(text);
  });

  it("rejects an invalid existing labshelf.yaml without registering", async () => {
    const context = memoryCatalog();
    await writeTree(context.fs, "/outside/p", { "labshelf.yaml": "id: a\nformat: nope\n" });
    await expect(addExistingFolder(context, LIB, { folder: "/outside/p", format: "latex" })).rejects.toThrow(/format must be/);
    expect(await context.registry.folders(LIB)).toEqual([]);
  });

  it("rejects a folder inside the library root without registering or writing", async () => {
    const context = memoryCatalog();
    const inside = `${LIB}/projects/x`;
    await writeTree(context.fs, inside, { "main.tex": "x" });
    await expect(addExistingFolder(context, LIB, { folder: inside, format: "latex" })).rejects.toThrow(/inside the library/);
    expect(await context.registry.folders(LIB)).toEqual([]);
    expect(filesUnder(context.fs, inside)).toEqual(["main.tex"]);
  });

  it("rejects an existing id that clashes with another project", async () => {
    const context = memoryCatalog();
    await createProjectFromTemplate(context, LIB, { title: "Thesis", ...createBlankTemplate("latex", "Thesis") });
    await writeTree(context.fs, "/outside/p", { "labshelf.yaml": "id: Thesis\nformat: latex\n" });
    await expect(addExistingFolder(context, LIB, { folder: "/outside/p", format: "latex" })).rejects.toThrow(/already used/);
    expect(await context.registry.folders(LIB)).toEqual([]);
  });

  it("gives a folder without labshelf.yaml a fresh id when its name clashes", async () => {
    const context = memoryCatalog();
    await createProjectFromTemplate(context, LIB, { title: "paper", ...createBlankTemplate("latex", "paper") });
    await writeTree(context.fs, "/outside/paper", { "main.tex": "x" });
    const entry = await addExistingFolder(context, LIB, { folder: "/outside/paper", format: "latex" });
    expect(entry.kind === "ready" && entry.settings.id).toBe("papera");
  });
});

const DIR = "/lib/projects/a";

describe("updateProjectSettings", () => {
  it("patches main and keeps comments", async () => {
    const context = memoryCatalog();
    await writeTree(context.fs, DIR, { "labshelf.yaml": "# mine\nid: a\nformat: latex\n" });
    await updateProjectSettings(context, DIR, { main: "paper.tex" });
    expect(readText(context.fs, `${DIR}/labshelf.yaml`)).toBe("# mine\nid: a\nformat: latex\nmain: paper.tex\n");
  });

  it("keeps every field it does not patch, unknown keys included", async () => {
    const context = memoryCatalog();
    const text = "id: a\nformat: latex\nmain: old.tex\nengine: xelatex\nextra: 1\n";
    await writeTree(context.fs, DIR, { "labshelf.yaml": text });
    await updateProjectSettings(context, DIR, { main: "paper.tex" });
    expect(readText(context.fs, `${DIR}/labshelf.yaml`)).toBe("id: a\nformat: latex\nmain: paper.tex\nengine: xelatex\nextra: 1\n");
  });

  it("rejects and leaves the file unchanged when the yaml is invalid", async () => {
    const context = memoryCatalog();
    const text = "id: a\nformat: nope\n";
    await writeTree(context.fs, DIR, { "labshelf.yaml": text });
    await expect(updateProjectSettings(context, DIR, { main: "x.tex" })).rejects.toThrow(/format must be/);
    expect(readText(context.fs, `${DIR}/labshelf.yaml`)).toBe(text);
  });
});

describe("removeProjectForever", () => {
  it("removes a library project folder and keeps the projects folder", async () => {
    const context = memoryCatalog();
    const entry = await createProjectFromTemplate(context, LIB, { title: "Notes", ...createBlankTemplate("latex", "Notes") });
    await removeProjectFolderForever(context, LIB, entry.folder);
    expect(filesUnder(context.fs, entry.folder)).toEqual([]);
    expect(await context.fs.stat(entry.folder)).toBeUndefined();
    expect(await context.fs.stat(`${LIB}/projects`)).toBeDefined();
  });

  it("unregisters an external folder and leaves its files", async () => {
    const context = memoryCatalog();
    await writeTree(context.fs, "/outside", { "main.tex": "hello" });
    await context.registry.register(LIB, "/outside");
    await removeProjectFolderForever(context, LIB, "/outside");
    expect(filesUnder(context.fs, "/outside")).toEqual(["main.tex"]);
    expect(await context.registry.folders(LIB)).toEqual([]);
  });

  it("refuses the projects folder itself and removes nothing", async () => {
    const context = memoryCatalog();
    await writeTree(context.fs, `${LIB}/projects/a`, { "main.tex": "x" });
    await expect(removeProjectFolderForever(context, LIB, `${LIB}/projects`)).rejects.toThrow(/projects folder/);
    expect(filesUnder(context.fs, `${LIB}/projects`)).toEqual(["a/main.tex"]);
  });

  it("treats a path that climbs out of the projects folder as outside and removes nothing", async () => {
    const context = memoryCatalog();
    await writeTree(context.fs, `${LIB}/x`, { "keep.txt": "x" });
    await writeTree(context.fs, `${LIB}/projects/a`, { "main.tex": "x" });
    await removeProjectFolderForever(context, LIB, `${LIB}/projects/../x`);
    expect(filesUnder(context.fs, `${LIB}/x`)).toEqual(["keep.txt"]);
    expect(filesUnder(context.fs, `${LIB}/projects`)).toEqual(["a/main.tex"]);
  });

  it("only unregisters the library root and keeps its files", async () => {
    const context = memoryCatalog();
    await writeTree(context.fs, LIB, { "library.json": "{}" });
    await writeTree(context.fs, `${LIB}/projects/a`, { "main.tex": "x" });
    await context.registry.register(LIB, LIB);
    await removeProjectFolderForever(context, LIB, LIB);
    expect(filesUnder(context.fs, LIB)).toEqual(["library.json", "projects/a/main.tex"]);
    expect(await context.registry.folders(LIB)).toEqual([]);
  });

  it("logs the failure and names the folder when the removal fails", async () => {
    const context = memoryCatalog();
    await writeTree(context.fs, `${LIB}/projects/a`, { "main.tex": "x" });
    context.fs.removeTree = async () => { throw new Error("busy"); };
    await expect(removeProjectFolderForever(context, LIB, `${LIB}/projects/a`)).rejects.toThrow(/projects\/a failed/);
    expect(context.logger.errors).toHaveLength(1);
  });
});
