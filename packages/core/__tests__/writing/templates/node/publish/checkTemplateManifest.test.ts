// Verifies the manifest publish check: it comes first, names the failing field and stops the build.
import type { TemplateManifest } from "../../../../../src/writing/templates/index";
import { checkTemplateForPublish } from "../../../../../src/writing/templates/node/index";
import { fakeLogger } from "../../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../../support/tempDirs";
import { promises as fs } from "node:fs";
import * as path from "node:path";

afterEach(cleanupTempDirs);

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3]);
const manifest: TemplateManifest = {
  id: "my-thesis", name: "My Thesis", description: "A thesis starter.", category: "thesis",
  format: "latex", engine: "pdflatex", main: "main.tex", license: "MIT", authors: ["Jane Doe"],
};

function png(): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, 800);
  new DataView(bytes.buffer).setUint32(20, 100);
  return bytes;
}

async function run(over: Partial<TemplateManifest>) {
  const project = path.join(await makeTempDir(), "project");
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(path.join(project, "main.tex"), "\\documentclass{article}\\begin{document}Hi\\end{document}");
  const buildPdf = jest.fn(async () => ({ ok: true as const, pdf: PDF }));
  const renderThumbnail = jest.fn(async () => png());
  const report = await checkTemplateForPublish({
    projectFolder: project, manifest: { ...manifest, ...over }, buildPdf, renderThumbnail, logger: fakeLogger(),
  });
  return { report, buildPdf };
}

const byId = (report: Awaited<ReturnType<typeof run>>["report"], id: string) => report.checks.find((c) => c.id === (id as never));

describe("checkTemplateForPublish: manifest check", () => {
  it("lists a passing manifest check first", async () => {
    const { report } = await run({});
    expect(report.checks[0]).toEqual({ id: "manifest", ok: true });
    expect(report.ok).toBe(true);
  });

  it.each([["description", { description: "" }], ["name", { name: "" }]])("fails on an empty %s, naming it, and never builds", async (field, over) => {
    const { report, buildPdf } = await run(over);
    const manifestCheck = byId(report, "manifest");
    expect(manifestCheck?.ok).toBe(false);
    expect(manifestCheck?.message).toContain(field);
    expect(buildPdf).not.toHaveBeenCalled();
    expect(byId(report, "build")).toBeUndefined();
    expect(byId(report, "thumbnail")).toBeUndefined();
    expect(report.ok).toBe(false);
    expect(report.files).toBeUndefined();
  });
});
