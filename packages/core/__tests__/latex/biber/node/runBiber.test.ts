/** Verifies a biber run picks the WASM build or the TeX's biber by control-file version, and that the WASM build writes the .bbl native biber writes. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";

import { biberAssetsInFolder, runBiber } from "../../../../src/latex/biber/node/index";
import { runNativeBiber } from "../../../../src/latex/biber/node/runNativeBiber";
import type { BiberWasmAssets } from "../../../../src/latex/biber/index";
import { locateDataSources } from "../../../../src/latex/biber/node/runBiber";

jest.mock("../../../../src/latex/biber/node/runNativeBiber", () => ({ runNativeBiber: jest.fn(async () => 0) }));

const FIXTURES = path.join(__dirname, "../fixtures");
// Our build of biber's WASM; BIBER_WASM_DIR points at another copy.
const ASSETS_DIR = process.env.BIBER_WASM_DIR ?? path.resolve(__dirname, "../../../../../../tools/biber-wasm/dist");
const realAssets = biberAssetsInFolder(ASSETS_DIR);
const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };

const fakeAssets = (bcfVersion: string): BiberWasmAssets => ({
  manifest: { biber: "2.22", bcfVersion, files: {} },
  factorySource: () => Promise.reject(new Error("not loaded")), wasm: () => Promise.reject(new Error("not loaded")), dataFile: () => Promise.reject(new Error("not loaded")),
});

describe("runBiber", () => {
  let base: string;
  let project: string;
  let build: string;
  const io = (args: string[]) => ({ args, cwd: project, env: process.env, stdout: new PassThrough(), stderr: new PassThrough() });

  beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "biber-run-")));
    project = path.join(base, "src");
    build = path.join(base, "Application Support", "build", "main.tex");
    fs.mkdirSync(project, { recursive: true });
    fs.mkdirSync(build, { recursive: true });
    fs.copyFileSync(path.join(FIXTURES, "refs.bib"), path.join(project, "refs.bib"));
    fs.copyFileSync(path.join(FIXTURES, "main.bcf"), path.join(build, "main.bcf"));
  });
  afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

  it("leaves a control file of another version to the TeX's own biber", async () => {
    const code = await runBiber(io(["--root", project, path.join(build, "main.bcf")]), fakeAssets("3.10"), logger);
    expect(code).toBe(0);
    expect(runNativeBiber).toHaveBeenCalledWith({ root: project, options: [], controlFile: path.join(build, "main.bcf") });
  });

  it("fails with biber's ERROR line in stderr and the .blg when a data source is outside the project", async () => {
    fs.writeFileSync(path.join(build, "main.bcf"), fs.readFileSync(path.join(build, "main.bcf"), "utf8").replace(">refs.bib<", ">../outside.bib<"));
    fs.writeFileSync(path.join(base, "outside.bib"), "");
    const run = io(["--root", project, path.join(build, "main")]);
    const code = await runBiber(run, fakeAssets("3.11"), logger);
    expect(code).toBe(2);
    expect(String(run.stderr.read())).toBe("ERROR - Data source ../outside.bib is outside the project folder\n");
    expect(fs.readFileSync(path.join(build, "main.blg"), "utf8")).toContain("ERROR - Data source ../outside.bib");
    expect(runNativeBiber).not.toHaveBeenCalled();
  });

  (realAssets ? it : it.skip)("writes the .bbl and .blg native biber writes beside the control file", async () => {
    const code = await runBiber(io(["--root", project, path.join(build, "main.bcf")]), realAssets!, logger);
    expect(code).toBe(0);
    expect(fs.readFileSync(path.join(build, "main.bbl"), "utf8")).toBe(fs.readFileSync(path.join(FIXTURES, "main.bbl"), "utf8"));
    expect(fs.readFileSync(path.join(build, "main.blg"), "utf8")).toContain("INFO - Output to");
  });
});

describe("locateDataSources", () => {
  let base: string;
  let places: { cwd: string; project: string; build: string; env: NodeJS.ProcessEnv };

  beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "biber-sources-")));
    const project = path.join(base, "My Project");
    places = { cwd: path.join(project, "thesis"), project, build: path.join(base, "build dir"), env: { PATH: "/nonexistent" } };
    fs.mkdirSync(places.cwd, { recursive: true });
    fs.mkdirSync(places.build);
  });
  afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

  it("finds a source from the main file's folder, also one level up inside the project, and one beside the control file", async () => {
    fs.writeFileSync(path.join(places.cwd, "refs.bib"), "");
    fs.writeFileSync(path.join(places.project, "shared.bib"), "");
    fs.writeFileSync(path.join(places.build, "generated.bib"), "");
    const sources = ["refs.bib", "../shared.bib", "generated.bib"].map((p) => ({ path: p, type: "file" }));
    expect(await locateDataSources(sources, places)).toEqual([
      { file: path.join(places.cwd, "refs.bib"), placed: path.join(places.cwd, "refs.bib") },
      { file: path.join(places.project, "shared.bib"), placed: path.join(places.project, "shared.bib") },
      { file: path.join(places.build, "generated.bib"), placed: path.join(places.build, "generated.bib") },
    ]);
  });

  it("refuses a source outside the project, by path or through a symbolic link", async () => {
    fs.writeFileSync(path.join(base, "secret.bib"), "");
    fs.symlinkSync(path.join(base, "secret.bib"), path.join(places.cwd, "link.bib"));
    await expect(locateDataSources([{ path: "../../secret.bib", type: "file" }], places)).rejects.toThrow(/outside the project/);
    await expect(locateDataSources([{ path: "link.bib", type: "file" }], places)).rejects.toThrow(/outside the project/);
    await expect(locateDataSources([{ path: path.join(base, "secret.bib"), type: "file" }], places)).rejects.toThrow(/outside the project/);
  });

  it("reports a source that neither the folders nor kpsewhich have", async () => {
    await expect(locateDataSources([{ path: "missing.bib", type: "file" }], places)).rejects.toThrow("Cannot find data source missing.bib");
  });
});
