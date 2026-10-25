/** Verifies that an include tree flattens into the order the text reads, with each include where it is written. */
import { readLatexProjectSources } from "../../../../src/latex/source/project";
import { readingOrderTexts, wordsUpTo } from "../../../../src/writing/checks/limits";

async function flatten(files: Record<string, string>) {
  const texts = new Map<string, string>();
  const tree = await readLatexProjectSources("main.tex", {
    read: async (path) => {
      const text = files[path];
      if (text !== undefined) { texts.set(path, text); }
      return text;
    },
  });
  return readingOrderTexts(tree.files, texts);
}

describe("readingOrderTexts", () => {
  it("places an included file at its include and the rest of the parent after it", async () => {
    const parts = await flatten({ "main.tex": "A\n\\input{intro}\nB", "intro.tex": "I" });
    expect(parts.map((part) => part.text.trim())).toEqual(["A", "I", "B"]);
  });

  it("follows an \\input chain and reads a file included twice once", async () => {
    const parts = await flatten({
      "main.tex": "\\input{a}\\input{a}\nM",
      "a.tex": "A \\input{b}",
      "b.tex": "B",
    });
    expect(wordsUpTo(parts, "end")).toBe(3);
  });

  it("counts the files after the bibliography out when the main file places them there", async () => {
    const parts = await flatten({
      "main.tex": "\\begin{document}\nm1\n\\input{body}\n\\bibliography{r}\n\\appendix\n\\input{appendix}\n\\end{document}",
      "body.tex": "b1 b2 b3",
      "appendix.tex": "x1 x2 x3 x4",
    });
    expect(wordsUpTo(parts, "references")).toBe(4);
    expect(wordsUpTo(parts, "end")).toBe(8);
  });
});
