/** Verifies the sources of a build root: a LaTeX root with its includes, a Typst root alone. */
import { createProjectSources } from "../../../src/writing/preview/index";

describe("createProjectSources", () => {
  const FILES: Record<string, string> = { "main.tex": "\\input{intro}", "intro.tex": "hello", "main.typ": '#include "intro.typ"', "intro.typ": "hello" };
  const readerFor = () => ({ read: async (file: string) => FILES[file] });
  const project = (format: "latex" | "typst") => ({ folder: "/lib/paper", settings: { format } });

  it("reads a LaTeX root with the files it includes", async () => {
    const sources = await createProjectSources(readerFor)(project("latex"), "main.tex");
    expect(sources.map((source) => source.file)).toEqual(["main.tex", "intro.tex"]);
  });

  it("reads a Typst root alone", async () => {
    const sources = await createProjectSources(readerFor)(project("typst"), "main.typ");
    expect(sources).toEqual([{ file: "main.typ", text: '#include "intro.typ"' }]);
  });

  it("leaves out a Typst root that cannot be read", async () => {
    expect(await createProjectSources(readerFor)(project("typst"), "gone.typ")).toEqual([]);
  });
});
