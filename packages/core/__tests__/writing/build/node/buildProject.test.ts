/** Verifies a project build: format dispatch, managed TeX, installing missing packages, a declined install and where the built PDF lives. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { typstPreviewPdf } from "../../../../src/writing/build/index";
import { buildProject } from "../../../../src/writing/build/node/index";
import { cleanupTempDirs, pathExists } from "../../../support/tempDirs";
import { buildFixture, runCount } from "./projectBuildFixtures";

const posixOnly = process.platform === "win32" ? describe.skip : describe;
afterEach(cleanupTempDirs);

posixOnly("buildProject", () => {
  it("builds a LaTeX project with the managed TeX without asking", async () => {
    const fixture = await buildFixture();
    const result = await buildProject(fixture.project({ engine: "xelatex" }), fixture.deps);
    expect(result).toEqual({ status: "succeeded", pdf: path.join(fixture.folder, "main.pdf"), problems: [] });
    expect(fixture.prompt.calls).toEqual([]);
    expect(await runCount(fixture.runs)).toBe(1);
  });

  it("stops the LaTeX engine at the first error only when asked", async () => {
    const fixture = await buildFixture();
    await buildProject(fixture.project({ engine: "xelatex" }), fixture.deps);
    expect(await fs.readFile(fixture.runs, "utf8")).not.toContain("-halt-on-error");
    await buildProject(fixture.project({ engine: "xelatex" }), fixture.deps, { haltOnError: true, force: true });
    expect(await fs.readFile(fixture.runs, "utf8")).toContain("-halt-on-error");
  });

  it("installs a missing package with progress and rebuilds", async () => {
    const fixture = await buildFixture();
    await fs.writeFile(fixture.missing, "");
    const result = await buildProject(fixture.project({ engine: "xelatex" }), fixture.deps);
    expect(result.status).toBe("succeeded");
    expect(fixture.prompt.calls).toEqual(["progress:Installing the LaTeX package for foo.sty"]);
    expect(fixture.tex.calls).toEqual(["resolve:xelatex", "installMissing:foo.sty"]);
    expect(await runCount(fixture.runs)).toBe(2);
  });

  it("reports declined and runs nothing when TeX is missing and the user declines", async () => {
    const fixture = await buildFixture({ installed: false });
    const result = await buildProject(fixture.project({ engine: "xelatex" }), fixture.deps);
    expect(result).toEqual({ status: "toolchain-missing", reason: "declined" });
    expect(await runCount(fixture.runs)).toBe(0);
  });

  it("returns no-main for a project without a main file", async () => {
    const fixture = await buildFixture();
    expect(await buildProject(fixture.project({ engine: "xelatex" }, null), fixture.deps)).toEqual({ status: "no-main" });
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
