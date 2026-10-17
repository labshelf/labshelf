/** Verifies that building a catalog index is deterministic, hashes the files and refuses an invalid catalog. */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { cleanupTempDirs, makeTempDir } from "../../../../support/tempDirs";
import { PDF, addTemplate, put } from "./catalogFixtures";
import { buildCatalogIndex } from "../../../../../src/writing/templates/node/index.js";
import { parseCatalogIndex } from "../../../../../src/writing/templates/manifest/index.js";

afterEach(cleanupTempDirs);

const COMMIT = "3f2c9a1b4d5e6f708192a3b4c5d6e7f801234567";
const sha256 = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");

async function catalogWith(...ids: string[]): Promise<string> {
  const root = await makeTempDir();
  for (const id of ids) { await addTemplate(root, id, {}, ["sections/b.tex", "sections/a.tex"]); }
  return root;
}

describe("buildCatalogIndex", () => {
  it("returns the same text on two runs, ending in a newline", async () => {
    const root = await catalogWith("beta", "alpha");
    const first = await buildCatalogIndex(root, COMMIT);
    expect(await buildCatalogIndex(root, COMMIT)).toBe(first);
    expect(first.endsWith("\n")).toBe(true);
  });

  it("records the schema, the commit, templates sorted by id and files sorted by path", async () => {
    const index = JSON.parse(await buildCatalogIndex(await catalogWith("beta", "alpha"), COMMIT));
    expect(index.schema).toBe(1);
    expect(index.commit).toBe(COMMIT);
    expect(index.templates.map((t: { id: string }) => t.id)).toEqual(["alpha", "beta"]);
    expect(index.templates[0].files.map((f: { path: string }) => f.path)).toEqual(["main.tex", "sections/a.tex", "sections/b.tex"]);
  });

  it("carries the manifest keys of each template", async () => {
    const index = JSON.parse(await buildCatalogIndex(await catalogWith("alpha"), COMMIT));
    expect(index.templates[0]).toMatchObject({
      id: "alpha", name: "Sample", description: "A sample template.", category: "article", format: "latex",
      engine: "pdflatex", main: "main.tex", license: "MIT", authors: ["Jane Doe"],
    });
  });

  it("hashes files, thumbnail and sample as lowercase hex of the bytes on disk", async () => {
    const root = await catalogWith("alpha");
    const entry = JSON.parse(await buildCatalogIndex(root, COMMIT)).templates[0];
    const main = entry.files.find((f: { path: string }) => f.path === "main.tex");
    const mainBytes = await fs.readFile(path.join(root, "templates/alpha/files/main.tex"));
    expect(main).toEqual({ path: "main.tex", size: mainBytes.length, sha256: sha256(mainBytes) });
    const thumb = await fs.readFile(path.join(root, "templates/alpha/preview/thumbnail.png"));
    expect(entry.thumbnail).toEqual({ size: thumb.length, sha256: sha256(thumb) });
    expect(entry.sample).toEqual({ size: PDF.length, sha256: sha256(PDF) });
  });

  it("round-trips through parseCatalogIndex with no skipped entries", async () => {
    const parsed = parseCatalogIndex(await buildCatalogIndex(await catalogWith("alpha", "beta"), COMMIT));
    expect(parsed).toMatchObject({ ok: true, commit: COMMIT, skipped: [] });
    if (parsed.ok) { expect(parsed.entries.map((e) => e.id)).toEqual(["alpha", "beta"]); }
  });

  it("throws when the catalog has a problem, naming the template", async () => {
    const root = await catalogWith("alpha", "beta");
    await put(root, "templates/beta/preview/sample.pdf", "not a pdf");
    await expect(buildCatalogIndex(root, COMMIT)).rejects.toThrow(/beta/);
  });

  it("adds no downloads key without a downloads.json", async () => {
    const index = JSON.parse(await buildCatalogIndex(await catalogWith("alpha"), COMMIT));
    expect("downloads" in index.templates[0]).toBe(false);
  });

  it("writes the counts of downloads.json after sample, ignoring unknown ids", async () => {
    const root = await catalogWith("alpha", "beta");
    await put(root, "downloads.json", JSON.stringify({ beta: 3, gone: 9, alpha: 12 }));
    const text = await buildCatalogIndex(root, COMMIT);
    const index = JSON.parse(text);
    expect(index.templates.map((t: { downloads: number }) => t.downloads)).toEqual([12, 3]);
    expect(Object.keys(index.templates[0]).slice(-2)).toEqual(["sample", "downloads"]);
    expect(text).not.toContain("gone");
    expect(await buildCatalogIndex(root, COMMIT)).toBe(text);
  });

  it("leaves out downloads for a template missing from downloads.json", async () => {
    const root = await catalogWith("alpha", "beta");
    await put(root, "downloads.json", JSON.stringify({ alpha: 1 }));
    const index = JSON.parse(await buildCatalogIndex(root, COMMIT));
    expect("downloads" in index.templates[1]).toBe(false);
  });

  it("throws naming downloads.json when it is invalid JSON, the wrong shape or holds a bad count", async () => {
    for (const text of ["{nope", "[1]", "null", JSON.stringify({ alpha: -1 }), JSON.stringify({ alpha: "3" }), JSON.stringify({ alpha: 1.5 })]) {
      const root = await catalogWith("alpha");
      await put(root, "downloads.json", text);
      await expect(buildCatalogIndex(root, COMMIT)).rejects.toThrow(/downloads\.json/);
    }
  });

  it("throws when the templates folder is missing", async () => {
    await expect(buildCatalogIndex(await makeTempDir(), COMMIT)).rejects.toThrow();
  });
});
