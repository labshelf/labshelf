// Pins each typing helper's edit (‸ the cursor, «…» the selection): what it does in LaTeX and Typst, where it stays out, and its switch.
import { backspace, enter, type, typeOver, without } from "./typingFixture";

describe("mathDollar", () => {
  it.each([
    ["latex", "a ‸", "$", "a $‸$"],
    ["latex", "$‸$", "$", "$$‸$$"],
    ["latex", "$x‸$", "$", "$x$‸"],
    ["latex", "$$x‸$$", "$", "$$x$$‸"],
    ["latex", "$x ‸ y", "$", undefined],
    ["latex", "\\‸", "$", undefined],
    ["latex", "% $‸", "$", undefined],
    ["latex", "\\begin{verbatim}\n‸", "$", undefined],
    ["latex", "a ‸word", "$", undefined],
    ["latex", "a ‸)", "$", "a $‸$)"],
    ["typst", "a ‸", "$", "a $‸$"],
    ["typst", "$x‸$", "$", "$x$‸"],
    ["typst", "$‸$", " ", "$ ‸ $"],
    ["typst", "$x‸$", " ", undefined],
    ["typst", "\\‸", "$", undefined],
    ["typst", "`raw ‸", "$", undefined],
    ["typst", "// ‸", "$", undefined],
  ] as const)("%s %j + %j → %j", (language, marked, typed, expected) => {
    expect(type(language, marked, typed)).toBe(expected);
  });

  it("is off with its switch", () => {
    expect(type("latex", "a ‸", "$", { helpers: without("mathDollar") })).toBeUndefined();
    expect(type("typst", "$‸$", " ", { helpers: without("mathDollar") })).toBeUndefined();
  });
});

describe("mathDelimiters and brackets", () => {
  it.each([
    ["latex", "\\‸", "(", "\\(‸\\)"],
    ["latex", "\\‸", "[", "\\[‸\\]"],
    ["latex", "\\\\‸", "(", "\\\\(‸)"],
    ["latex", "\\‸", "{", "\\{‸\\}"],
    ["latex", "a ‸", "(", "a (‸)"],
    ["latex", "a ‸", "[", "a [‸]"],
    ["latex", "\\begin‸", "{", "\\begin{‸}"],
    ["latex", "a ‸b", "(", undefined],
    ["latex", "(a ‸)", "{", "(a {‸})"],
    ["latex", "% ‸", "(", undefined],
    ["typst", "f‸", "(", "f(‸)"],
    ["typst", "#f‸", "[", "#f[‸]"],
    ["typst", "\\‸", "(", undefined],
    ["typst", "a ‸b", "[", undefined],
  ] as const)("%s %j + %j → %j", (language, marked, typed, expected) => {
    expect(type(language, marked, typed)).toBe(expected);
  });

  it("keeps \\( plain without mathDelimiters and ( plain without brackets", () => {
    expect(type("latex", "\\‸", "(", { helpers: without("mathDelimiters") })).toBeUndefined();
    expect(type("latex", "a ‸", "(", { helpers: without("brackets") })).toBeUndefined();
  });
});

describe("leftRight", () => {
  it.each([
    ["$\\left‸", "(", "$\\left(‸\\right)"],
    ["$\\left‸", "[", "$\\left[‸\\right]"],
    ["$\\left‸", "|", "$\\left|‸\\right|"],
    ["$\\left\\‸", "{", "$\\left\\{‸\\right\\}"],
    ["$\\left\\‸", "|", "$\\left\\|‸\\right\\|"],
    ["$\\left\\lang‸", "l", undefined],
    ["$\\left\\langl‸", "e", "$\\left\\langle‸\\right\\rangle"],
    ["$\\left\\langl‸x", "e", undefined],
    ["$\\left\\lfloo‸", "r", "$\\left\\lfloor‸\\right\\rfloor"],
    ["$\\left\\lVer‸", "t", "$\\left\\lVert‸\\right\\rVert"],
    ["$\\bigl‸", "(", "$\\bigl(‸\\bigr)"],
    ["$\\Biggl‸", "[", "$\\Biggl[‸\\Biggr]"],
  ])("%j + %j → %j", (marked, typed, expected) => {
    expect(type("latex", marked, typed)).toBe(expected);
  });

  it("falls back to brackets when off", () => {
    expect(type("latex", "$\\left‸", "(", { helpers: without("leftRight") })).toBe("$\\left(‸)");
  });
});

describe("quotes", () => {
  it.each([
    ["latex", "say `‸", "`", "say ``‸''"],
    ["latex", "say ``‸", "`", undefined],
    ["latex", "say ‸", "'", undefined],
    ["latex", "say ‸", "\"", undefined],
    ["typst", "say ‸", "\"", "say \"‸\""],
    ["typst", "word‸", "\"", undefined],
    ["typst", "say ‸x", "\"", undefined],
    ["typst", "$x \"if‸\"", "\"", "$x \"if\"‸"],
    ["typst", "// ‸", "\"", undefined],
  ] as const)("%s %j + %j → %j", (language, marked, typed, expected) => {
    expect(type(language, marked, typed)).toBe(expected);
  });
});

describe("overtype", () => {
  it("steps over a tracked closer only", () => {
    expect(typeOver("latex", "(a‸)", ")")).toBe("(a)‸");
    expect(type("latex", "(a‸)", ")")).toBeUndefined();
    expect(typeOver("typst", "\"a‸\"", "\"")).toBe("\"a\"‸");
    expect(typeOver("latex", "``a‸''", "'")).toBe("``a'‸'");
    expect(typeOver("latex", "$\\left(a‸\\right)", ")")).toBe("$\\left(a\\right)‸");
    expect(typeOver("latex", "$x^{2‸}", "}")).toBe("$x^{2}‸");
  });

  it("is off with its switch", () => {
    expect(type("latex", "(a‸)", ")", { helpers: without("overtype"), tracked: [3] })).toBeUndefined();
  });
});

describe("scripts", () => {
  it.each([
    ["latex", "$x‸", "^", "$x^{‸}"],
    ["latex", "$x‸", "_", "$x_{‸}"],
    ["latex", "$x‸{", "^", undefined],
    ["latex", "x‸", "^", undefined],
    ["latex", "$x\\‸", "_", undefined],
    ["typst", "$x‸", "^", "$x^(‸)"],
    ["typst", "$x‸(", "_", undefined],
    ["typst", "x‸", "_", undefined],
  ] as const)("%s %j + %j → %j", (language, marked, typed, expected) => {
    expect(type(language, marked, typed)).toBe(expected);
  });

  it("is off with its switch", () => {
    expect(type("latex", "$x‸", "^", { helpers: without("scripts") })).toBeUndefined();
  });
});

describe("wrapSelection", () => {
  it.each([
    ["latex", "a «x» b", "$", "a $«x»$ b"],
    ["latex", "a $«x»$ b", "$", "a $$«x»$$ b"],
    ["latex", "«x»", "(", "(«x»)"],
    ["latex", "«x»", "{", "{«x»}"],
    ["latex", "«x»", "`", "``«x»''"],
    ["latex", "$«x»", "^", "$^{«x»}"],
    ["latex", "«x»", "^", undefined],
    ["latex", "«x»", "'", undefined],
    ["latex", "% «x»", "(", undefined],
    ["typst", "«x»", "$", "$«x»$"],
    ["typst", "$«x»$", "$", "$ «x» $"],
    ["typst", "«x»", "*", "*«x»*"],
    ["typst", "«x»", "_", "_«x»_"],
    ["typst", "«x»", "`", "`«x»`"],
    ["typst", "«x»", "\"", "\"«x»\""],
    ["typst", "$«x»", "_", "$_(«x»)"],
    ["typst", "$«x»", "*", undefined],
  ] as const)("%s %j + %j → %j", (language, marked, typed, expected) => {
    expect(type(language, marked, typed)).toBe(expected);
  });

  it("is off with its switch", () => {
    expect(type("latex", "«x»", "$", { helpers: without("wrapSelection") })).toBeUndefined();
  });
});

describe("deletePair", () => {
  it.each([
    ["latex", "(‸)", "‸"],
    ["latex", "a[‸]", "a‸"],
    ["latex", "{‸}", "‸"],
    ["latex", "$‸$", "‸"],
    ["latex", "$$‸$$", "$‸$"],
    ["latex", "\\(‸\\)", "‸"],
    ["latex", "\\[‸\\]", "‸"],
    ["latex", "\\{‸\\}", "‸"],
    ["latex", "``‸''", "`‸"],
    ["latex", "$\\left(‸\\right)", "$\\left‸"],
    ["latex", "$\\left\\{‸\\right\\}", "$\\left‸"],
    ["latex", "$\\bigl\\langle‸\\bigr\\rangle", "$\\bigl‸"],
    ["latex", "\\{‸}", undefined],
    ["latex", "(a‸)", undefined],
    ["typst", "$ ‸ $", "$‸$"],
    ["typst", "$‸$", "‸"],
    ["typst", "\"‸\"", "‸"],
    ["typst", "\\(‸)", undefined],
  ] as const)("%s %j → %j", (language, marked, expected) => {
    expect(backspace(language, marked)).toBe(expected);
  });

  it("is off with its switch", () => {
    expect(backspace("latex", "(‸)", without("deletePair"))).toBeUndefined();
  });
});

describe("enterMath", () => {
  it.each([
    ["latex", "  \\[‸\\]", "  \\[\n    ‸\n  \\]"],
    ["latex", "$$‸$$", "$$\n  ‸\n$$"],
    ["typst", "$ ‸ $", "$\n  ‸\n$"],
    ["latex", "\\\\[‸\\]", undefined],
    ["typst", "$‸$", undefined],
  ] as const)("%s %j → %j", (language, marked, expected) => {
    expect(enter(language, marked)).toBe(expected);
  });

  it("is off with its switch", () => {
    expect(enter("latex", "\\[‸\\]", without("enterMath"))).toBeUndefined();
  });
});

describe("beginEnd", () => {
  it("closes an environment at the end of its \\begin line", () => {
    expect(enter("latex", "  \\begin{itemize}‸")).toBe("  \\begin{itemize}\n    ‸\n  \\end{itemize}");
    expect(enter("latex", "\\begin{tabular}{ll}‸")).toBe("\\begin{tabular}{ll}\n  ‸\n\\end{tabular}");
  });

  it("closes \\begin{name‸} with its brace auto-closed", () => {
    expect(enter("latex", "\\begin{figure‸}")).toBe("\\begin{figure}\n  ‸\n\\end{figure}");
  });

  it("does not close one that is already closed, commented or switched off", () => {
    expect(enter("latex", "\\begin{itemize}‸\n\\end{itemize}")).toBeUndefined();
    expect(enter("latex", "% \\begin{itemize}‸")).toBeUndefined();
    expect(enter("latex", "\\begin{itemize}‸", without("beginEnd"))).toBeUndefined();
    expect(enter("typst", "\\begin{itemize}‸")).toBeUndefined();
  });
});
