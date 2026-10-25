/** Verifies the words of a root across its includes, up to the project's countUpTo. */
import { countBuildRootWords } from "../../../../src/writing/preview/limits";
import { readyEntry } from "../../../support/writingFixtures";

type Project = Parameters<typeof countBuildRootWords>[1];
const FILES: Record<string, string> = {
  "main.tex": "\\begin{document}\none two\n\\input{sections/body}\n\\bibliography{r}\n\\input{appendix}\n\\end{document}",
  "sections/body.tex": "three four five \\include{deep}",
  "deep.tex": "six",
  "appendix.tex": "seven eight",
};
const deps = { readerFor: jest.fn(() => ({ read: async (path: string) => FILES[path] })) };

function latex(check?: { countUpTo: "references" | "end" }): Project {
  return readyEntry("/p/tex", { settings: { id: "tex", format: "latex", ...(check ? { check: { anonymous: true, ...check } } : {}) } as never }) as Project;
}

describe("countBuildRootWords", () => {
  it("counts through the include chain up to the references by default", async () => {
    expect(await countBuildRootWords(deps, latex(), "main.tex")).toBe(6);
    expect(deps.readerFor).toHaveBeenCalledWith("/p/tex");
  });

  it("counts through the appendix for countUpTo end", async () => {
    expect(await countBuildRootWords(deps, latex({ countUpTo: "end" }), "main.tex")).toBe(8);
  });

  it("counts a root that is itself an included file", async () => {
    expect(await countBuildRootWords(deps, latex(), "appendix.tex")).toBe(2);
  });

  it("counts a Typst root from its own file only and 0 for a missing root", async () => {
    const typst = readyEntry("/p/ty", { settings: { id: "ty", format: "typst" } as never }) as Project;
    const typstDeps = { readerFor: () => ({ read: async (path: string) => (path === "paper.typ" ? "a b c #bibliography(\"r.bib\") d" : undefined) }) };
    expect(await countBuildRootWords(typstDeps, typst, "paper.typ")).toBe(3);
    expect(await countBuildRootWords(typstDeps, typst, "gone.typ")).toBe(0);
  });
});
