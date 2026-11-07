import { detectDocumentLanguage } from "../../../src/writing/proofing/index.js";

const latex = (text: string) => detectDocumentLanguage("latex", text);
const typst = (text: string) => detectDocumentLanguage("typst", text);

describe("detectDocumentLanguage in LaTeX", () => {
  it("reads babel, main= and documentclass options as pt-BR", () => {
    expect(latex("\\usepackage[brazilian]{babel}").tag).toBe("pt-BR");
    expect(latex("\\usepackage[english,main=brazilian]{babel}").tag).toBe("pt-BR");
    expect(latex("\\documentclass[12pt,brazilian]{article}").tag).toBe("pt-BR");
    expect(latex("\\usepackage{polyglossia}\n\\setmainlanguage[variant=brazilian]{portuguese}").tag).toBe("pt-BR");
    expect(latex("\\setmainlanguage{portuguese}").tag).toBe("pt-PT");
    expect(latex("\\usepackage[brazilian]{babel}").name).toBe("Portuguese (Brazil)");
  });

  it("gives en-US for english and for no declaration", () => {
    expect(latex("\\usepackage[english]{babel}").tag).toBe("en-US");
    expect(latex("\\begin{document}x\\end{document}")).toEqual({ tag: "en-US", name: "English", declared: false });
  });

  it("lets the last babel option and the last babel line win, skipping other options", () => {
    expect(latex("\\usepackage[english,brazilian]{babel}").tag).toBe("pt-BR");
    expect(latex("\\usepackage[brazilian,english]{babel}").tag).toBe("en-US");
    expect(latex("\\usepackage[brazilian]{babel}\n\\usepackage[french]{babel}").tag).toBe("fr");
    expect(latex("\\usepackage[brazilian,shorthands=off]{babel}").tag).toBe("pt-BR");
  });

  it("ignores commented lines", () => {
    expect(latex("% \\usepackage[brazilian]{babel}\n\\usepackage[german]{babel}").tag).toBe("de");
    expect(latex("% \\usepackage[brazilian]{babel}").declared).toBe(false);
  });

  it("gives a null tag and the raw name for an unknown or dictionary-less language", () => {
    expect(latex("\\usepackage[klingon]{babel}")).toEqual({ tag: null, name: "klingon", declared: true });
    expect(latex("\\usepackage[finnish]{babel}").tag).toBeNull();
    expect(latex("\\usepackage[korean]{babel}")).toEqual({ tag: null, name: "Korean", declared: true });
  });
});

describe("detectDocumentLanguage in Typst", () => {
  it("joins lang and region", () => {
    expect(typst('#set text(lang: "pt", region: "br")').tag).toBe("pt-BR");
    expect(typst('#set text(font: "Libertinus Serif", size: 11pt, lang: "fr")').tag).toBe("fr");
    expect(typst('#set text(lang: "en")').tag).toBe("en-US");
    expect(typst('#set text(lang: "pt")').tag).toBe("pt-PT");
  });

  it("ignores comments and defaults to en-US", () => {
    expect(typst('// #set text(lang: "fr")\n= Title').declared).toBe(false);
    expect(typst("= Title").tag).toBe("en-US");
  });

  it("gives a null tag for an unknown language", () => {
    expect(typst('#set text(lang: "zh")')).toEqual({ tag: null, name: "zh", declared: true });
    expect(typst('#set text(lang: "ko")')).toEqual({ tag: null, name: "Korean", declared: true });
  });
});
