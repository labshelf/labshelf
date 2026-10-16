/** Verifies a Typst project build with the real WASM compiler: PDF only on success, located problems, shadowed sources and package downloads. */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { TypstSession } from "../../../../src/writing/typst/index";
import { runTypstBuild, TypstPackageStore, type TypstBuildRequest } from "../../../../src/writing/typst/node/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, listFiles, makeTempDir } from "../../../support/tempDirs";
import { DEMO_PACKAGE_URL, demoPackageArchive, openTestSession, respond, TYPST_TEST_FONT_SETTING } from "../../../support/typstFixtures";

afterEach(cleanupTempDirs);

let session: TypstSession;
let packages: TypstPackageStore;
let cacheDir: string;

beforeAll(async () => {
  cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "labshelf-typst-cache-"));
  packages = new TypstPackageStore({ data: path.join(cacheDir, "data"), cache: path.join(cacheDir, "cache") });
  session = await openTestSession(packages);
});

afterAll(async () => { await fs.rm(cacheDir, { recursive: true, force: true }); });

async function project(files: Record<string, string>): Promise<{ folder: string; outputs: [string, ...string[]] }> {
  const folder = await makeTempDir();
  for (const [name, text] of Object.entries(files)) { await fs.writeFile(path.join(folder, name), text); }
  return { folder, outputs: [path.join(folder, "main.pdf")] };
}

function request(folder: string, outputs: [string, ...string[]], extra: Partial<TypstBuildRequest> = {}): TypstBuildRequest {
  return { session, packages, projectFolder: folder, main: "main.typ", sources: new Map(), outputs, logger: fakeLogger(), ...extra };
}

describe("runTypstBuild", () => {
  it("writes the PDF to every output and returns the first", async () => {
    const { folder } = await project({ "main.typ": `${TYPST_TEST_FONT_SETTING}Hello` });
    const outputs: [string, ...string[]] = [path.join(folder, "main.pdf"), path.join(folder, "copy", "again.pdf")];
    await fs.mkdir(path.join(folder, "copy"));
    const result = await runTypstBuild(request(folder, outputs));
    expect(result).toEqual({ status: "succeeded", pdf: outputs[0], problems: [], cites: [] });
    for (const output of outputs) { expect((await fs.readFile(output)).subarray(0, 5).toString()).toBe("%PDF-"); }
  });

  it("writes nothing and keeps the previous PDF when the compile fails", async () => {
    const { folder, outputs } = await project({ "main.typ": `${TYPST_TEST_FONT_SETTING}#bogus()` });
    await fs.writeFile(outputs[0], "old");
    const result = await runTypstBuild(request(folder, outputs));
    expect(result.status).toBe("failed");
    expect(result.problems[0]).toMatchObject({ severity: "error", file: path.join(folder, "main.typ"), line: 2 });
    expect(await fs.readFile(outputs[0], "utf8")).toBe("old");
    expect(await listFiles(folder)).toEqual(["main.pdf", "main.typ"]);
  });

  it("locates an error in an included file on that file and line", async () => {
    const { folder, outputs } = await project({
      "main.typ": `${TYPST_TEST_FONT_SETTING}#include "chapter.typ"\n`,
      "chapter.typ": "fine\n\n#nope()\n",
    });
    const result = await runTypstBuild(request(folder, outputs));
    expect(result.status).toBe("failed");
    expect(result.problems).toContainEqual(expect.objectContaining({ severity: "error", file: path.join(folder, "chapter.typ"), line: 3 }));
  });

  it("lets unsaved sources shadow the file on disk", async () => {
    const { folder, outputs } = await project({ "main.typ": `${TYPST_TEST_FONT_SETTING}#bogus()` });
    const sources = new Map([[path.join(folder, "main.typ"), `${TYPST_TEST_FONT_SETTING}Fixed`]]);
    expect((await runTypstBuild(request(folder, outputs, { sources }))).status).toBe("succeeded");
    expect((await runTypstBuild(request(folder, outputs))).status).toBe("failed");
  });

  it("downloads a missing preview package through the fetch and then compiles", async () => {
    const archive = await demoPackageArchive();
    const { folder, outputs } = await project({
      "main.typ": `${TYPST_TEST_FONT_SETTING}#import "@preview/demo-pkg:0.1.0": greet\n#greet("Ada")\n`,
    });
    const urls: string[] = [];
    const logger = fakeLogger();
    const fetchImpl = async (url: string): Promise<Response> => { urls.push(url); return respond(200, archive); };
    const result = await runTypstBuild(request(folder, outputs, { fetch: fetchImpl, logger }));
    expect(result).toMatchObject({ status: "succeeded", problems: [] });
    expect(urls).toEqual([DEMO_PACKAGE_URL]);
    expect(logger.logs.map((entry) => entry.message)).toContain("Downloaded Typst package");
  });

  it("reports a Could not download problem on the main file when the download fails", async () => {
    const { folder, outputs } = await project({
      "main.typ": `${TYPST_TEST_FONT_SETTING}#import "@preview/missing-pkg:1.2.3": x\n`,
    });
    const logger = fakeLogger();
    const result = await runTypstBuild(request(folder, outputs, { fetch: async () => respond(404), logger }));
    expect(result.status).toBe("failed");
    expect(result.problems[0]).toMatchObject({
      severity: "error", file: path.join(folder, "main.typ"),
      message: expect.stringContaining("Could not download @preview/missing-pkg:1.2.3"),
    });
    expect(logger.errors).toHaveLength(1);
  });
});
