/** Verifies saving a library project as a My template: exclusions, manifest, ids and clean failure. */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { createProjectFromTemplate } from "../../../../src/writing/project/node/index";
import { blankTemplate, parseTemplateManifest } from "../../../../src/writing/templates/index";
import { createMineSource, saveProjectAsTemplate } from "../../../../src/writing/templates/node/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, listFiles, makeTempDir, pathExists } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

const details = {
  name: "My Thesis", category: "thesis" as const, license: "MIT", description: "A thesis starter.",
  authors: ["Jane Doe"], engine: "pdflatex" as const,
};

async function put(root: string, rel: string, content: string): Promise<void> {
  const target = path.join(root, rel);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}

async function setup(format: "latex" | "typst" = "latex") {
  const lib = path.join(await makeTempDir(), "lib");
  await fs.mkdir(lib);
  const logger = fakeLogger();
  const { template, files } = blankTemplate(format, "Source");
  await createProjectFromTemplate(lib, { title: "Source", template, files }, logger);
  return { lib, logger, project: path.join(lib, "projects", "source"), main: template.main };
}

async function nothingLeft(lib: string): Promise<void> {
  expect(await listFiles(path.join(lib, "templates"))).toEqual([]);
  expect(await listFiles(path.join(lib, ".research", "staging"))).toEqual([]);
}

describe("saveProjectAsTemplate", () => {
  it("copies the project tree and leaves out the excluded paths", async () => {
    const { lib, logger, project, main } = await setup();
    await put(project, "sections/a.tex", "A");
    await put(project, ".labshelf/figures.json", "{}");
    for (const rel of [".labshelf/versions/v1.json", ".labshelf/rebuttal/1.json", ".labshelf/comments.json", ".labshelf/state.json", ".labshelf/checklist.json", ".git/HEAD"]) {
      await put(project, rel, "x");
    }
    const manifest = await saveProjectAsTemplate(lib, "source", details, logger);
    const files = await listFiles(path.join(lib, "templates", manifest.id, "files"));
    expect(files).toEqual([".labshelf/figures.json", main, "sections/a.tex"].sort());
    expect(logger.errors).toEqual([]);
  });

  it("leaves out the PDF the build copies beside a .tex file but keeps other PDFs", async () => {
    const { lib, logger, project } = await setup();
    for (const rel of ["main.pdf", "chapters/ch.tex", "chapters/ch.pdf", "figures/plot.pdf"]) { await put(project, rel, "x"); }
    const manifest = await saveProjectAsTemplate(lib, "source", details, logger);
    const files = await listFiles(path.join(lib, "templates", manifest.id, "files"));
    expect(files).toEqual(["chapters/ch.tex", "figures/plot.pdf", "main.tex"].sort());
  });

  it("leaves out the PDF the build copies beside a .typ file", async () => {
    const { lib, logger, project, main } = await setup("typst");
    for (const rel of [main.replace(/\.typ$/, ".pdf"), "figures/plot.pdf"]) { await put(project, rel, "x"); }
    const manifest = await saveProjectAsTemplate(lib, "source", details, logger);
    const files = await listFiles(path.join(lib, "templates", manifest.id, "files"));
    expect(files).toEqual([main, "figures/plot.pdf"].sort());
  });

  it("writes a manifest that parses and carries the project format, main and the details", async () => {
    const { lib, logger, main } = await setup();
    const saved = await saveProjectAsTemplate(lib, "source", details, logger);
    const text = await fs.readFile(path.join(lib, "templates", "my-thesis", "template.yaml"), "utf8");
    const parsed = parseTemplateManifest(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) { return; }
    expect(parsed.manifest).toEqual(saved);
    expect(saved).toMatchObject({ id: "my-thesis", name: "My Thesis", category: "thesis", license: "MIT", description: "A thesis starter.", format: "latex", main });
    expect(saved.engine).not.toBe("typst");
    expect(saved.authors.length).toBeGreaterThan(0);
  });

  it("uses the engine from labshelf.yaml for a LaTeX project", async () => {
    const { lib, logger, project } = await setup();
    await fs.appendFile(path.join(project, "labshelf.yaml"), "engine: lualatex\n");
    expect((await saveProjectAsTemplate(lib, "source", details, logger)).engine).toBe("lualatex");
  });

  it("rejects a LaTeX project with no engine in labshelf.yaml or from the app, and writes nothing", async () => {
    const { lib, logger } = await setup();
    const { engine: _engine, ...withoutEngine } = details;
    await expect(saveProjectAsTemplate(lib, "source", withoutEngine, logger)).rejects.toThrow(/no engine/);
    await nothingLeft(lib);
  });

  it("uses the typst engine for a Typst project", async () => {
    const { lib, logger, main } = await setup("typst");
    const saved = await saveProjectAsTemplate(lib, "source", details, logger);
    expect(saved).toMatchObject({ format: "typst", engine: "typst", main });
  });

  it("is listed by the Mine source with its files", async () => {
    const { lib, logger, project, main } = await setup();
    await put(project, "sections/a.tex", "A");
    await saveProjectAsTemplate(lib, "source", details, logger);
    const source = createMineSource({ libraryRoot: lib, logger });
    const { entries } = await source.list();
    expect(entries.map((e) => e.id)).toEqual(["my-thesis"]);
    const files = await source.files(entries[0]!);
    expect(files.map((f) => f.path).sort()).toEqual([main, "sections/a.tex"].sort());
  });

  it("gives two saves with the same name distinct ids", async () => {
    const { lib, logger } = await setup();
    const first = await saveProjectAsTemplate(lib, "source", details, logger);
    const second = await saveProjectAsTemplate(lib, "source", details, logger);
    expect(second.id).not.toBe(first.id);
    expect(second.id.startsWith("my-thesis")).toBe(true);
    expect((await createMineSource({ libraryRoot: lib, logger }).list()).entries.length).toBe(2);
  });

  it("rejects a symlink anywhere in the project naming its path, and writes nothing", async () => {
    const { lib, logger, project } = await setup();
    await fs.mkdir(path.join(project, "sections"));
    await fs.symlink(path.join(project, "main.tex"), path.join(project, "sections", "link.tex"));
    await expect(saveProjectAsTemplate(lib, "source", details, logger)).rejects.toThrow(/sections\/link\.tex/);
    await nothingLeft(lib);
    expect(logger.errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(logger.errors)).toContain("source");
  });

  it.each(["latexmkrc", ".latexmkrc"])("rejects a %s file naming it, and writes nothing", async (name) => {
    const { lib, logger, project } = await setup();
    await put(project, name, "system('x');");
    await expect(saveProjectAsTemplate(lib, "source", details, logger)).rejects.toThrow(name);
    await nothingLeft(lib);
  });

  it("rejects an unknown project id naming it, and writes nothing", async () => {
    const { lib, logger } = await setup();
    await expect(saveProjectAsTemplate(lib, "ghost", details, logger)).rejects.toThrow(/ghost/);
    expect(await pathExists(path.join(lib, "templates", "my-thesis"))).toBe(false);
    await nothingLeft(lib);
  });
});
