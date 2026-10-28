/** Verifies the words of a root, counted through its includes up to the references or the end. */
import { countBuildRootWords } from "../../src/writing/index";

describe("countBuildRootWords", () => {
  const FILES: Record<string, string> = {
    "main.tex": "\\begin{document}\none two\n\\input{sections/body}\n\\bibliography{r}\n\\input{appendix}\n\\end{document}",
    "sections/body.tex": "three four five \\include{deep}",
    "deep.tex": "six",
    "appendix.tex": "seven eight",
  };
  const reader = { read: async (path: string) => FILES[path] };
  const latex = { format: "latex" as const };

  it("counts through the include chain up to the references by default", async () => {
    expect(await countBuildRootWords(reader, latex, "main.tex")).toBe(6);
  });

  it("counts through the appendix for countUpTo end", async () => {
    expect(await countBuildRootWords(reader, { format: "latex", check: { countUpTo: "end", anonymous: true } }, "main.tex")).toBe(8);
  });

  it("counts a root that is itself an included file", async () => {
    expect(await countBuildRootWords(reader, latex, "appendix.tex")).toBe(2);
  });

  it("counts a Typst root from its own file only and 0 for a missing root", async () => {
    const typstReader = { read: async (path: string) => (path === "paper.typ" ? "a b c #bibliography(\"r.bib\") d" : undefined) };
    expect(await countBuildRootWords(typstReader, { format: "typst" }, "paper.typ")).toBe(3);
    expect(await countBuildRootWords(typstReader, { format: "typst" }, "gone.typ")).toBe(0);
  });
});
