/** Verifies TeX preparation: the default engine, declining the install, installing with progress and a failed install. */
import { ensureToolchain } from "../../../../src/writing/build/node/index";
import { cleanupTempDirs } from "../../../support/tempDirs";
import { buildFixture } from "./projectBuildFixtures";

afterEach(cleanupTempDirs);

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
