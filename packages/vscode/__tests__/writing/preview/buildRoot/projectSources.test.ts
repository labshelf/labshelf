// Tests which files a root's sources come from: includes for LaTeX, the root alone for Typst.
import { projectSources } from "../../../../src/writing/preview/buildRoot";
import type { ReadyProject } from "../../../../src/writing/buildRootDocument";
import { readyEntry } from "../../../support/writingFixtures";

const FILES: Record<string, string> = { "main.tex": "\\input{intro}", "intro.tex": "hello", "main.typ": '#include "intro.typ"', "intro.typ": "hello" };
const readerFor = () => ({ read: async (file: string) => FILES[file] });

function project(format: "latex" | "typst"): ReadyProject {
  const base = readyEntry("/lib/paper") as ReadyProject;
  return { ...base, settings: { ...base.settings, format } } as ReadyProject;
}

describe("projectSources", () => {
  it("reads a LaTeX root with the files it includes", async () => {
    const sources = await projectSources(readerFor)(project("latex"), "main.tex");
    expect(sources.map((source) => source.file)).toEqual(["main.tex", "intro.tex"]);
  });

  it("reads a Typst root alone", async () => {
    const sources = await projectSources(readerFor)(project("typst"), "main.typ");
    expect(sources).toEqual([{ file: "main.typ", text: '#include "intro.typ"' }]);
  });

  it("leaves out a Typst root that cannot be read", async () => {
    expect(await projectSources(readerFor)(project("typst"), "gone.typ")).toEqual([]);
  });
});
