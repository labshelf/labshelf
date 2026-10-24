/** Verifies data sources are found where biber looks and refused outside the project, the build folder and the TeX tree. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { locateDataSources } from "../../../../src/latex/biber/node/findBibliographies";

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
