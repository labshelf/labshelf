/** Verifies that validating a template catalog names every broken template folder and accepts a good one. */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";
import { KIB, catalogWith, manifestYaml, pngBytes, put } from "./catalogFixtures";
import { checkCatalog } from "../../../../src/templates/node/index.js";

afterEach(cleanupTempDirs);

describe("checkCatalog", () => {
  it("returns no problems for a good catalog", async () => {
    expect(await checkCatalog(await catalogWith("alpha", "beta"))).toEqual([]);
  });

  it("accepts a thumbnail at the 400 and 1600 pixel limits", async () => {
    const root = await catalogWith("alpha", "beta");
    await put(root, "templates/alpha/preview/thumbnail.png", pngBytes(400));
    await put(root, "templates/beta/preview/thumbnail.png", pngBytes(1600));
    expect(await checkCatalog(root)).toEqual([]);
  });

  it("reports a manifest that fails to parse, naming the key", async () => {
    const root = await catalogWith("alpha");
    await put(root, "templates/alpha/template.yaml", manifestYaml("alpha", { license: undefined }));
    const problems = await checkCatalog(root);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.id).toBe("alpha");
    expect(problems[0]!.reason).toMatch(/license/);
  });

  it("reports a manifest id that differs from the folder name", async () => {
    const root = await catalogWith("alpha");
    await put(root, "templates/alpha/template.yaml", manifestYaml("other"));
    const problems = await checkCatalog(root);
    expect(problems).toEqual([{ id: "alpha", reason: expect.stringMatching(/id/) }]);
  });

  it("refuses a main outside files/", async () => {
    const root = await catalogWith("alpha");
    await put(root, "templates/alpha/template.yaml", manifestYaml("alpha", { main: "../main.tex" }));
    const problems = await checkCatalog(root);
    expect(problems).toEqual([{ id: "alpha", reason: expect.stringMatching(/main/) }]);
  });

  it("refuses a latexmkrc among the files, naming it", async () => {
    const root = await catalogWith("alpha");
    await put(root, "templates/alpha/files/latexmkrc", "system('rm -rf ~');\n");
    const problems = await checkCatalog(root);
    expect(problems).toEqual([{ id: "alpha", reason: expect.stringMatching(/latexmkrc/) }]);
  });

  it("reports a main that is not among the files", async () => {
    const root = await catalogWith("alpha");
    await put(root, "templates/alpha/template.yaml", manifestYaml("alpha", { main: "paper.tex" }));
    const problems = await checkCatalog(root);
    expect(problems).toEqual([{ id: "alpha", reason: expect.stringMatching(/main|paper\.tex/) }]);
  });

  it("reports a thumbnail narrower than 400 pixels", async () => {
    const root = await catalogWith("alpha");
    await put(root, "templates/alpha/preview/thumbnail.png", pngBytes(399));
    const problems = await checkCatalog(root);
    expect(problems).toEqual([{ id: "alpha", reason: expect.stringMatching(/thumbnail/) }]);
  });

  it("reports a thumbnail wider than 1600 pixels", async () => {
    const root = await catalogWith("alpha");
    await put(root, "templates/alpha/preview/thumbnail.png", pngBytes(1601));
    expect((await checkCatalog(root))[0]).toMatchObject({ id: "alpha", reason: expect.stringMatching(/thumbnail/) });
  });

  it("reports a thumbnail that is not a PNG", async () => {
    const root = await catalogWith("alpha");
    await put(root, "templates/alpha/preview/thumbnail.png", Buffer.alloc(200, 1));
    expect((await checkCatalog(root))[0]).toMatchObject({ id: "alpha", reason: expect.stringMatching(/thumbnail/) });
  });

  it("reports a thumbnail over 512 KiB and accepts one at exactly 512 KiB", async () => {
    const root = await catalogWith("alpha", "beta");
    await put(root, "templates/alpha/preview/thumbnail.png", pngBytes(800, 512 * KIB + 1));
    await put(root, "templates/beta/preview/thumbnail.png", pngBytes(800, 512 * KIB));
    expect(await checkCatalog(root)).toEqual([{ id: "alpha", reason: expect.stringMatching(/thumbnail/) }]);
  });

  it("reports a missing thumbnail and a missing sample", async () => {
    const root = await catalogWith("alpha", "beta");
    await fs.rm(path.join(root, "templates/alpha/preview/thumbnail.png"));
    await fs.rm(path.join(root, "templates/beta/preview/sample.pdf"));
    const problems = await checkCatalog(root);
    expect(problems.map((p) => p.id)).toEqual(["alpha", "beta"]);
    expect(problems[0]!.reason).toMatch(/thumbnail/);
    expect(problems[1]!.reason).toMatch(/sample/);
  });

  it("reports a sample that is not a PDF", async () => {
    const root = await catalogWith("alpha");
    await put(root, "templates/alpha/preview/sample.pdf", "<html></html>");
    expect(await checkCatalog(root)).toEqual([{ id: "alpha", reason: expect.stringMatching(/sample/) }]);
  });

  it("reports a sample over 10 MiB", async () => {
    const root = await catalogWith("alpha");
    await put(root, "templates/alpha/preview/sample.pdf", Buffer.concat([Buffer.from("%PDF-1.5\n"), Buffer.alloc(10 * KIB * KIB)]));
    expect(await checkCatalog(root)).toEqual([{ id: "alpha", reason: expect.stringMatching(/sample/) }]);
  });

  it("reports every broken folder, sorted by id, and leaves good ones out", async () => {
    const root = await catalogWith("zulu", "good", "alpha", "mike");
    await put(root, "templates/zulu/preview/sample.pdf", "nope");
    await put(root, "templates/alpha/template.yaml", manifestYaml("alpha", { license: undefined }));
    await put(root, "templates/mike/preview/thumbnail.png", pngBytes(10));
    const problems = await checkCatalog(root);
    expect(problems.map((p) => p.id)).toEqual(["alpha", "mike", "zulu"]);
    expect(problems.every((p) => p.reason.length > 0)).toBe(true);
  });

  it("reports a missing templates folder as one problem with an empty id", async () => {
    const problems = await checkCatalog(await makeTempDir());
    expect(problems).toEqual([{ id: "", reason: expect.stringMatching(/templates/) }]);
  });
});
