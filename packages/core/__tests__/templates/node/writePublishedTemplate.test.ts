// Verifies atomic local publication copies, collision preservation and confinement to the library.
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { writePublishedTemplate } from "../../../src/templates/node/index";
import { parseTemplateManifest, type TemplateManifest } from "../../../src/templates/index";
import { makeTempDir, cleanupTempDirs } from "../../support/tempDirs";

const manifest: TemplateManifest = { id: "research", name: "Research", category: "article", description: "Starter", license: "MIT", authors: ["researcher"], format: "latex", engine: "pdflatex", main: "main.tex" };
const bytes = new TextEncoder().encode("source");
const files = [{ path: "template.yaml", bytes }, { path: "files/main.tex", bytes }];
afterEach(cleanupTempDirs);

it("preserves an existing template and gives its saved copy a matching unique manifest id", async () => {
  const root = await makeTempDir();
  await fs.mkdir(path.join(root, "templates/research"), { recursive: true });
  await fs.writeFile(path.join(root, "templates/research/keep.txt"), "existing");
  await writePublishedTemplate(root, manifest, files);
  expect(await fs.readFile(path.join(root, "templates/research/keep.txt"), "utf8")).toBe("existing");
  const id = (await fs.readdir(path.join(root, "templates"))).find((id) => id !== "research")!;
  const parsed = parseTemplateManifest(await fs.readFile(path.join(root, "templates", id, "template.yaml"), "utf8"));
  expect(parsed).toMatchObject({ ok: true, manifest: { id } });
});

it("refuses a template destination symlink outside the library", async () => {
  const root = await makeTempDir(); const outside = await makeTempDir();
  await fs.symlink(outside, path.join(root, "templates"));
  await expect(writePublishedTemplate(root, manifest, files)).rejects.toThrow();
  expect(await fs.readdir(outside)).toEqual([]);
});

it("cleans staging when a file path is refused and leaves no partial template", async () => {
  const root = await makeTempDir();
  await expect(writePublishedTemplate(root, manifest, [...files, { path: "../escape", bytes }])).rejects.toThrow();
  expect(await fs.readdir(path.join(root, "templates"))).toEqual([]);
  expect(await fs.readdir(path.join(root, ".research/staging"))).toEqual([]);
});
