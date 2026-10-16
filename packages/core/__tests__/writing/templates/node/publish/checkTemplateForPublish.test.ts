/** Verifies the publish checks: each failing check is named, the build is skipped on cheap failures, and the files are laid out as in the catalog. */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { TemplateManifest } from "../../../../../src/writing/templates/index";
import { checkTemplateForPublish } from "../../../../../src/writing/templates/node/index";
import { fakeLogger } from "../../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../../support/tempDirs";

afterEach(cleanupTempDirs);

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3]);

const manifest: TemplateManifest = {
  id: "my-thesis", name: "My Thesis", description: "A thesis starter.", category: "thesis",
  format: "latex", engine: "pdflatex", main: "main.tex", license: "MIT", authors: ["Jane Doe"],
};

function png(width: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, 100);
  return bytes;
}

async function put(root: string, rel: string, content: string): Promise<void> {
  const target = path.join(root, rel);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}

async function setup() {
  const project = path.join(await makeTempDir(), "project");
  await put(project, "main.tex", "\\documentclass{article}\\begin{document}Hi\\end{document}");
  await put(project, "labshelf.yaml", "id: my-thesis\nformat: latex\nengine: pdflatex\nmain: main.tex\n");
  const logger = fakeLogger();
  const buildPdf = jest.fn(async () => ({ ok: true as const, pdf: PDF }));
  const renderThumbnail = jest.fn(async () => png(800));
  const run = (overrides: { manifest?: TemplateManifest } = {}) =>
    checkTemplateForPublish({ projectFolder: project, manifest: overrides.manifest ?? manifest, buildPdf, renderThumbnail, logger });
  return { project, logger, buildPdf, renderThumbnail, run };
}

function check(report: Awaited<ReturnType<typeof checkTemplateForPublish>>, id: string) {
  const found = report.checks.find((c) => c.id === id);
  if (found === undefined) { throw new Error(`no ${id} check in ${JSON.stringify(report.checks)}`); }
  return found;
}

describe("checkTemplateForPublish", () => {
  it("passes a small LaTeX project and lays out the catalog files", async () => {
    const { run, buildPdf, logger } = await setup();
    const report = await run();
    expect(report.checks.map((c) => c.id).sort()).toEqual(["build", "latexmkrc", "license", "manifest", "paths", "sizes", "thumbnail"]);
    expect(report.checks.every((c) => c.ok)).toBe(true);
    expect(report.ok).toBe(true);
    expect(buildPdf).toHaveBeenCalledTimes(1);
    const paths = report.files?.map((f) => f.path) ?? [];
    expect(paths).toEqual(expect.arrayContaining(["template.yaml", "files/main.tex", "preview/thumbnail.png", "preview/sample.pdf"]));
    expect(paths).not.toContain("files/labshelf.yaml");
    expect(report.sample).toEqual(PDF);
    expect(report.thumbnail).toEqual(png(800));
    expect(report.files?.find((f) => f.path === "preview/sample.pdf")?.bytes).toEqual(PDF);
    expect(logger.errors).toEqual([]);
  });

  it("fails the license check for an invalid license", async () => {
    const { run } = await setup();
    const report = await run({ manifest: { ...manifest, license: "NOASSERTION" } });
    const license = check(report, "license");
    expect(license.ok).toBe(false);
    expect(license.message).toBeTruthy();
    expect(report.ok).toBe(false);
    expect(report.files).toBeUndefined();
  });

  it.each(["latexmkrc", ".latexmkrc", "chapters/latexmkrc", "chapters/.latexmkrc"])("refuses a project with %s and skips the build", async (rel) => {
    const { run, project, buildPdf } = await setup();
    await put(project, rel, "$pdflatex = 'pdflatex -shell-escape %O %S';");
    const report = await run();
    const latexmkrc = check(report, "latexmkrc");
    expect(latexmkrc.ok).toBe(false);
    expect(latexmkrc.message).toContain("latexmkrc");
    expect(buildPdf).not.toHaveBeenCalled();
    const build = check(report, "build");
    expect(build.ok).toBe(false);
    expect(build.message).toMatch(/skipped/i);
    expect(report.ok).toBe(false);
  });

  it("fails the paths check naming a symbolic link and skips the build", async () => {
    const { run, project, buildPdf } = await setup();
    const outside = path.join(await makeTempDir(), "secret.txt");
    await fs.writeFile(outside, "secret");
    await fs.symlink(outside, path.join(project, "leak.txt"));
    const report = await run();
    const paths = check(report, "paths");
    expect(paths.ok).toBe(false);
    expect(paths.message).toContain("leak.txt");
    expect(buildPdf).not.toHaveBeenCalled();
    expect(report.ok).toBe(false);
  });

  it("fails the sizes check naming a file over the per-file limit", async () => {
    const { run, project, buildPdf } = await setup();
    await fs.truncate(path.join(project, "huge.bin"), 0).catch(() => undefined);
    const handle = await fs.open(path.join(project, "huge.bin"), "w");
    await handle.truncate(MAX_FILE_BYTES + 1);
    await handle.close();
    const report = await run();
    const sizes = check(report, "sizes");
    expect(sizes.ok).toBe(false);
    expect(sizes.message).toContain("huge.bin");
    expect(buildPdf).not.toHaveBeenCalled();
    expect(report.ok).toBe(false);
  });

  it("reports the first build problem and logs the failure with context", async () => {
    const { project, logger, renderThumbnail } = await setup();
    const buildPdf = async () => ({ ok: false as const, problems: ["main.tex:3 Undefined control sequence", "second"] });
    const report = await checkTemplateForPublish({ projectFolder: project, manifest, buildPdf, renderThumbnail, logger });
    const build = check(report, "build");
    expect(build.ok).toBe(false);
    expect(build.message).toContain("Undefined control sequence");
    expect(report.ok).toBe(false);
    expect(report.files).toBeUndefined();
    expect(logger.errors.length).toBeGreaterThan(0);
    expect(logger.errors[0]?.context).toBeDefined();
  });

  it("fails the thumbnail check when the PNG is narrower than 400 px", async () => {
    const { project, logger, buildPdf } = await setup();
    const renderThumbnail = async () => png(399);
    const report = await checkTemplateForPublish({ projectFolder: project, manifest, buildPdf, renderThumbnail, logger });
    const thumbnail = check(report, "thumbnail");
    expect(thumbnail.ok).toBe(false);
    expect(thumbnail.message).toBeTruthy();
    expect(check(report, "build").ok).toBe(true);
    expect(report.ok).toBe(false);
    expect(report.files).toBeUndefined();
  });

  it("leaves per-device project state out of the files", async () => {
    const { run, project } = await setup();
    for (const rel of [".labshelf/versions/v1.json", ".labshelf/rebuttal/1.json", ".labshelf/comments.json", ".labshelf/state.json", ".labshelf/checklist.json"]) {
      await put(project, rel, "x");
    }
    await put(project, ".labshelf/figures.json", "{}");
    const report = await run();
    expect(report.ok).toBe(true);
    const paths = report.files?.map((f) => f.path) ?? [];
    expect(paths).toContain("files/.labshelf/figures.json");
    expect(paths.filter((p) => /versions|rebuttal|comments|state|checklist/.test(p))).toEqual([]);
  });
});
