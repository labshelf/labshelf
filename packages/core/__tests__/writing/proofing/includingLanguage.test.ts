import { findIncludingLanguage } from "../../../src/writing/proofing/index.js";

const project = (files: Record<string, string>) => ({
  list: async () => Object.keys(files),
  read: async (path: string) => {
    const text = files[path];
    if (text === undefined) throw new Error(`no ${path}`);
    return text;
  },
});

const MAIN_PT = "\\documentclass{article}\n\\usepackage[brazilian]{babel}\n\\begin{document}\n";

describe("findIncludingLanguage", () => {
  it("takes the language of the main file that \\input s the part", async () => {
    const files = project({ "main.tex": `${MAIN_PT}\\input{sections/intro}\n\\end{document}`, "sections/intro.tex": "Texto" });
    expect((await findIncludingLanguage("sections/intro.tex", "Texto", files))?.tag).toBe("pt-BR");
  });

  it("follows nested \\include and \\subfile, resolved from the main file's folder", async () => {
    const files = project({
      "thesis/main.tex": `${MAIN_PT}\\include{chapters/one}\n\\end{document}`,
      "thesis/chapters/one.tex": "\\subfile{chapters/one-a.tex}",
      "thesis/chapters/one-a.tex": "Texto",
    });
    expect((await findIncludingLanguage("thesis/chapters/one-a.tex", "Texto", files))?.tag).toBe("pt-BR");
  });

  it("follows \\subimport from the including file's folder", async () => {
    const files = project({
      "main.tex": `${MAIN_PT}\\subimport{parts/}{a}\n\\end{document}`,
      "parts/a.tex": "\\subimport{sub/}{b}",
      "parts/sub/b.tex": "Texto",
    });
    expect((await findIncludingLanguage("parts/sub/b.tex", "Texto", files))?.tag).toBe("pt-BR");
  });

  it("reads the root a subfiles class or a TeX root comment names", async () => {
    const files = project({ "main.tex": MAIN_PT, "ch/a.tex": "" });
    expect((await findIncludingLanguage("ch/a.tex", "\\documentclass[../main.tex]{subfiles}", files))?.tag).toBe("pt-BR");
    expect((await findIncludingLanguage("ch/a.tex", "% !TEX root = ../main.tex\nTexto", files))?.tag).toBe("pt-BR");
  });

  it("ignores includes in comments, roots without a language and files nobody includes", async () => {
    const files = project({
      "main.tex": `${MAIN_PT}% \\input{intro}\n\\end{document}`,
      "other.tex": "\\documentclass{article}\\begin{document}\\input{intro}\\end{document}",
      "intro.tex": "Text",
    });
    expect(await findIncludingLanguage("intro.tex", "Text", files)).toBeNull();
  });

  it("skips files it cannot read and ends an include cycle", async () => {
    const files = project({ "main.tex": `${MAIN_PT}\\input{a}\\end{document}`, "a.tex": "\\input{b}", "b.tex": "\\input{a}" });
    const flaky = { ...files, list: async () => ["main.tex", "a.tex", "b.tex", "missing.tex"] };
    expect(await findIncludingLanguage("c.tex", "", flaky)).toBeNull();
    expect((await findIncludingLanguage("b.tex", "", flaky))?.tag).toBe("pt-BR");
  });
});
