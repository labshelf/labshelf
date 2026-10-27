/** Verifies a project build: format dispatch, managed TeX, installing missing packages, a declined install and where the built PDF lives; also the TeX preparation and the install-and-rebuild loop it is made of. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { buildTypstPreviewPdf } from "../../../../src/writing/build/index";
import { buildInstallingPackages } from "../../../../src/writing/build/index";
import { buildProject, ensureToolchain } from "../../../../src/writing/build/node/index";
import { cleanupTempDirs, pathExists } from "../../../support/tempDirs";
import { fakeLogger } from "../../../support/fakeLogger";
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
    const preview = buildTypstPreviewPdf(project, "main.typ", fixture.deps.projects, path);
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

describe("ensureToolchain", () => {
  it("resolves pdflatex for a project without an engine and asks nothing", async () => {
    const fixture = await buildFixture();
    const toolchain = await ensureToolchain(fixture.project(), fixture.deps);
    expect(toolchain).toMatchObject({ engine: "pdflatex" });
    expect(fixture.tex.calls).toEqual(["resolve:pdflatex"]);
    expect(fixture.prompt.calls).toEqual([]);
  });

  it("returns declined when TeX is missing and the user declines the install", async () => {
    const fixture = await buildFixture({ installed: false });
    expect(await ensureToolchain(fixture.project({ engine: "xelatex" }), fixture.deps)).toEqual({ status: "toolchain-missing", reason: "declined" });
    expect(fixture.tex.calls).toEqual(["resolve:xelatex"]);
  });

  it("installs the picked TeX with progress and resolves again", async () => {
    const fixture = await buildFixture({ installed: false, pick: "tinytex" });
    const toolchain = await ensureToolchain(fixture.project({ engine: "lualatex" }), fixture.deps);
    expect(toolchain).toMatchObject({ engine: "lualatex" });
    expect(fixture.prompt.calls).toEqual(["choose", "progress:Installing TinyTeX", "report:50%", "report:"]);
    expect(fixture.tex.calls).toEqual(["resolve:lualatex", "install:tinytex", "resolve:lualatex"]);
  });

  it("returns install-failed with the message when the install throws", async () => {
    const fixture = await buildFixture({ installed: false, pick: "texlive", installError: new Error("mirror down") });
    expect(await ensureToolchain(fixture.project(), fixture.deps)).toEqual({ status: "toolchain-missing", reason: "install-failed", message: "mirror down" });
    expect(fixture.prompt.calls).toEqual(["choose", "progress:Installing TeX Live"]);
  });
});

interface Round { force: boolean; missing?: string }

function run(missingRounds: number, installs = true): Promise<{ rounds: Round[]; installed: string[]; last: Round }> {
  const rounds: Round[] = [];
  const installed: string[] = [];
  return buildInstallingPackages<Round>({
    compile: async ({ force }) => {
      const round: Round = { force, ...(rounds.length < missingRounds && { missing: `p${rounds.length}.sty` }) };
      rounds.push(round);
      return round;
    },
    missingFile: (result) => result.missing,
    tex: { installMissing: async (fileName) => { installed.push(fileName); return installs; } },
    logger: fakeLogger(),
  }).then((last) => ({ rounds, installed, last }));
}

describe("buildInstallingPackages", () => {
  it("installs a missing file and rebuilds with force", async () => {
    const { rounds, installed, last } = await run(1);
    expect(rounds.map((r) => r.force)).toEqual([false, true]);
    expect(installed).toEqual(["p0.sty"]);
    expect(last.missing).toBeUndefined();
  });

  it("stops after ten install rounds", async () => {
    const { rounds, installed, last } = await run(100);
    expect(installed).toHaveLength(10);
    expect(rounds).toHaveLength(11);
    expect(last.missing).toBe("p10.sty");
  });

  it("stops when the missing file cannot be installed", async () => {
    const { rounds, installed } = await run(5, false);
    expect(rounds).toHaveLength(1);
    expect(installed).toEqual(["p0.sty"]);
  });
});
