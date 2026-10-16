/** Verifies installing a project from template files: layout, validation before any write, staging cleanup, blank templates. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { createProjectFromTemplate } from "../../../../src/writing/project/node/index";
import { blankTemplate } from "../../../../src/writing/templates/index";
import type { ProjectTemplate } from "../../../../src/writing/templates/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, listFiles, makeTempDir, pathExists } from "../../../support/tempDirs";

// Fails the write of any file whose path ends with failOn.suffix, and delegates every other write.
const failOn: { suffix?: string | undefined } = {};
jest.mock("../../../../src/library/node/index", () => {
  const actual = jest.requireActual("../../../../src/library/node/index");
  return {
    ...actual,
    writeFileAtomic: (file: string, ...rest: unknown[]) => {
      if (failOn.suffix !== undefined && file.endsWith(failOn.suffix)) { return Promise.reject(new Error("disk full")); }
      return actual.writeFileAtomic(file, ...rest);
    },
  };
});

afterEach(async () => { failOn.suffix = undefined; await cleanupTempDirs(); });

const enc = (text: string) => new TextEncoder().encode(text);
const latex: ProjectTemplate = { id: "ieee", format: "latex", main: "main.tex", engine: "xelatex" };

async function library(): Promise<string> {
  const lib = path.join(await makeTempDir(), "lib");
  await fs.mkdir(lib);
  return lib;
}

async function nothingLeft(lib: string): Promise<void> {
  expect(await pathExists(path.join(lib, "projects", "t"))).toBe(false);
  expect(await listFiles(path.join(lib, ".research", "staging"))).toEqual([]);
}

describe("createProjectFromTemplate", () => {
  it("writes nested files at their paths and labshelf.yaml with the engine of a latex template", async () => {
    const lib = await library();
    const figure = new Uint8Array([0, 255, 1, 128]);
    const files = [
      { path: "main.tex", bytes: enc("\\input{sections/intro}") },
      { path: "sections/intro.tex", bytes: enc("Hello") },
      { path: "figures/a.png", bytes: figure },
    ];
    const entry = await createProjectFromTemplate(lib, { title: "T", template: latex, files }, fakeLogger());
    const folder = path.join(lib, "projects", "t");
    expect(await listFiles(folder)).toEqual(["figures/a.png", "labshelf.yaml", "main.tex", "sections/intro.tex"]);
    expect(await fs.readFile(path.join(folder, "sections", "intro.tex"), "utf8")).toBe("Hello");
    expect(new Uint8Array(await fs.readFile(path.join(folder, "figures", "a.png")))).toEqual(figure);
    expect(await fs.readFile(path.join(folder, "labshelf.yaml"), "utf8")).toBe("id: t\nformat: latex\nmain: main.tex\nengine: xelatex\n");
    expect(entry).toMatchObject({ kind: "ready", folder, location: "library", main: "main.tex" });
    expect(await listFiles(path.join(lib, ".research", "staging"))).toEqual([]);
  });

  it("does not write an engine for a typst template", async () => {
    const lib = await library();
    const template: ProjectTemplate = { id: "paper", format: "typst", main: "main.typ", engine: "xelatex" };
    await createProjectFromTemplate(lib, { title: "T", template, files: [{ path: "main.typ", bytes: enc("= A") }] }, fakeLogger());
    expect(await fs.readFile(path.join(lib, "projects", "t", "labshelf.yaml"), "utf8")).toBe("id: t\nformat: typst\nmain: main.typ\n");
  });

  it("omits the engine when a latex template has none", async () => {
    const lib = await library();
    const template: ProjectTemplate = { id: "x", format: "latex", main: "main.tex" };
    await createProjectFromTemplate(lib, { title: "T", template, files: [{ path: "main.tex", bytes: enc("x") }] }, fakeLogger());
    expect(await fs.readFile(path.join(lib, "projects", "t", "labshelf.yaml"), "utf8")).toBe("id: t\nformat: latex\nmain: main.tex\n");
  });

  it.each([["../evil.tex"], ["/etc/x"]])("rejects the path %s naming it and writes nothing", async (bad) => {
    const lib = await library();
    const files = [{ path: "main.tex", bytes: enc("x") }, { path: bad, bytes: enc("y") }];
    await expect(createProjectFromTemplate(lib, { title: "T", template: latex, files }, fakeLogger()))
      .rejects.toThrow(new RegExp(bad.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")));
    await nothingLeft(lib);
  });

  it("rejects a tree that breaks a tree rule (labshelf.yaml among the files) and writes nothing", async () => {
    const lib = await library();
    const files = [{ path: "main.tex", bytes: enc("x") }, { path: "labshelf.yaml", bytes: enc("id: z") }];
    await expect(createProjectFromTemplate(lib, { title: "T", template: latex, files }, fakeLogger())).rejects.toThrow(/labshelf\.yaml/);
    await nothingLeft(lib);
  });

  it("rejects a main file that is not among the files and writes nothing", async () => {
    const lib = await library();
    const files = [{ path: "other.tex", bytes: enc("x") }];
    await expect(createProjectFromTemplate(lib, { title: "T", template: latex, files }, fakeLogger())).rejects.toThrow(/main\.tex/);
    await nothingLeft(lib);
  });

  it("removes the staging folder, leaves no project and logs the template id when a write fails mid-copy", async () => {
    const lib = await library();
    const logger = fakeLogger();
    failOn.suffix = path.join("sections", "intro.tex");
    const files = [
      { path: "main.tex", bytes: enc("x") },
      { path: "sections/intro.tex", bytes: enc("y") },
    ];
    await expect(createProjectFromTemplate(lib, { title: "T", template: latex, files }, logger)).rejects.toThrow(/intro\.tex/);
    await nothingLeft(lib);
    expect(logger.errors).toHaveLength(1);
    expect(JSON.stringify(logger.errors[0]!.context)).toContain("ieee");
  });

  it("logs 'project created' at INFO with the template id", async () => {
    const lib = await library();
    const logger = fakeLogger();
    await createProjectFromTemplate(lib, { title: "T", template: latex, files: [{ path: "main.tex", bytes: enc("x") }] }, logger);
    expect(logger.logs.filter((entry) => entry.message === "project created")).toEqual([
      expect.objectContaining({ level: "INFO" }),
    ]);
  });

  it("gives a second project with the same title the suffix a", async () => {
    const lib = await library();
    const request = { title: "Thesis", ...blankTemplate("latex", "Thesis") };
    await createProjectFromTemplate(lib, request, fakeLogger());
    const second = await createProjectFromTemplate(lib, request, fakeLogger());
    expect(second.kind === "ready" && second.settings.id).toBe("thesisa");
    expect(path.basename(second.folder)).toBe("thesisa");
  });
});

describe("createProjectFromTemplate with blank templates", () => {
  it("creates the blank LaTeX article exactly", async () => {
    const lib = await library();
    await createProjectFromTemplate(lib, { title: "Deep Nets: a Survey", ...blankTemplate("latex", "Deep Nets: a Survey") }, fakeLogger());
    const folder = path.join(lib, "projects", "deep-nets-a-survey");
    expect(await listFiles(folder)).toEqual(["labshelf.yaml", "main.tex"]);
    expect(await fs.readFile(path.join(folder, "labshelf.yaml"), "utf8")).toBe("id: deep-nets-a-survey\nformat: latex\nmain: main.tex\n");
    expect(await fs.readFile(path.join(folder, "main.tex"), "utf8")).toBe([
      "\\documentclass{article}", "\\usepackage{hyperref}", "", "\\title{Deep Nets: a Survey}", "\\author{}", "\\date{\\today}", "",
      "\\begin{document}", "\\maketitle", "", "\\section{Introduction}", "", "\\end{document}", "",
    ].join("\n"));
  });

  it("creates the blank Typst article exactly", async () => {
    const lib = await library();
    await createProjectFromTemplate(lib, { title: "Notes", ...blankTemplate("typst", "Notes") }, fakeLogger());
    const folder = path.join(lib, "projects", "notes");
    expect(await listFiles(folder)).toEqual(["labshelf.yaml", "main.typ"]);
    expect(await fs.readFile(path.join(folder, "labshelf.yaml"), "utf8")).toBe("id: notes\nformat: typst\nmain: main.typ\n");
    expect(await fs.readFile(path.join(folder, "main.typ"), "utf8")).toBe([
      '#let title = "Notes"', "#set document(title: title)", '#set page(paper: "a4", numbering: "1")',
      '#set heading(numbering: "1.")', "", '#align(center, text(17pt, weight: "bold", title))', "", "= Introduction", "",
    ].join("\n"));
  });
});
