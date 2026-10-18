/** Verifies a project build: format dispatch, the first-run engine pick, a declined Tectonic download and where the built PDF lives. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { tectonicAsset } from "../../../../src/writing/index";
import { typstPreviewPdf } from "../../../../src/writing/build/index";
import { buildProject } from "../../../../src/writing/build/node/index";
import { cleanupTempDirs, pathExists } from "../../../support/tempDirs";
import { buildFixture, runCount } from "./projectBuildFixtures";

const posixOnly = process.platform === "win32" ? describe.skip : describe;
const savedPath = process.env.PATH;

afterEach(async () => {
  process.env.PATH = savedPath;
  await cleanupTempDirs();
});

posixOnly("buildProject", () => {
  it("builds a LaTeX project with the installed Tectonic without asking", async () => {
    const fixture = await buildFixture({ tectonicInstalled: true });
    const result = await buildProject(fixture.project({ engine: "tectonic" }), fixture.deps);
    expect(result).toEqual({ status: "succeeded", pdf: path.join(fixture.folder, "main.pdf"), problems: [] });
    expect(fixture.prompt.calls).toEqual([]);
    expect(await runCount(fixture.runs)).toBe(1);
  });

  it("asks for the engine on the first build, stores the pick and builds with TeX Live", async () => {
    const fixture = await buildFixture({ engine: "pdflatex" });
    process.env.PATH = fixture.texLiveBin;
    const result = await buildProject(fixture.project(), fixture.deps);
    expect(result.status).toBe("succeeded");
    expect(fixture.prompt.calls).toEqual(["pick:true"]);
    expect(fixture.saved).toEqual([{ folder: fixture.folder, patch: { engine: "pdflatex" } }]);
    expect(await runCount(fixture.runs)).toBe(1);
  });

  it("reports the toolchain missing and runs nothing when the Tectonic download is declined", async () => {
    const fixture = await buildFixture({ confirm: false });
    process.env.PATH = path.dirname(fixture.runs);
    const result = await buildProject(fixture.project({ engine: "tectonic" }), fixture.deps);
    const supported = tectonicAsset(process.platform, process.arch) !== undefined;
    expect(result).toEqual({ status: "toolchain-missing", reason: supported ? "declined" : "tectonic-unsupported" });
    expect(await runCount(fixture.runs)).toBe(0);
  });

  it("returns no-main for a project without a main file", async () => {
    const fixture = await buildFixture({ tectonicInstalled: true });
    expect(await buildProject(fixture.project({ engine: "tectonic" }, null), fixture.deps)).toEqual({ status: "no-main" });
  });

  it("compiles a Typst project into the preview PDF and <root>.pdf", async () => {
    const fixture = await buildFixture();
    const project = fixture.project({ format: "typst" }, "main.typ");
    const result = await buildProject(project, fixture.deps);
    const preview = typstPreviewPdf(project, "main.typ", fixture.deps.projects, path);
    expect(result).toMatchObject({ status: "succeeded", pdf: preview });
    expect(await fs.readFile(path.join(fixture.folder, "main.pdf"), "utf8")).toBe("%PDF-typst");
  });

  it("writes only the preview PDF for a live Typst compile of unsaved text", async () => {
    const fixture = await buildFixture();
    const project = fixture.project({ format: "typst" }, "main.typ");
    const result = await buildProject(project, fixture.deps, { unsaved: new Map([[path.join(fixture.folder, "main.typ"), "Draft"]]) });
    expect(result.status).toBe("succeeded");
    expect(await pathExists(path.join(fixture.folder, "main.pdf"))).toBe(false);
  });
});
