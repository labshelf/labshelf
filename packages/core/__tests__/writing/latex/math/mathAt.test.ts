/** Verifies which math span of a LaTeX source covers an offset. */
import { mathAt } from "../../../../src/writing/latex/math/index";

function at(text: string, marker: string): ReturnType<typeof mathAt> {
  return mathAt(text, text.indexOf(marker));
}

describe("mathAt", () => {
  it("finds inline dollar math and its delimiters", () => {
    const text = "Let $\\alpha^2$ be it.";
    expect(at(text, "alpha")).toEqual({ tex: "\\alpha^2", display: false, start: 4, end: 14 });
    expect(mathAt(text, 4)?.tex).toBe("\\alpha^2");
    expect(mathAt(text, 14)).toBeUndefined();
  });

  it("finds display math in all delimiter forms", () => {
    expect(at("a $$x+y$$ b", "x")).toMatchObject({ tex: "x+y", display: true });
    expect(at("a \\[x+y\\] b", "x")).toMatchObject({ tex: "x+y", display: true });
    expect(at("a \\(x+y\\) b", "x")).toMatchObject({ tex: "x+y", display: false });
  });

  it("returns the whole environment for math environments", () => {
    const text = "x\n\\begin{align*}\na &= b \\\\\nc &= d\n\\end{align*}\ny";
    expect(at(text, "c &")).toMatchObject({ tex: text.slice(2, text.length - 2), display: true });
  });

  it("ignores text, escaped dollars and comments", () => {
    expect(at("Costs \\$5 and $x$.", "5")).toBeUndefined();
    expect(at("Costs \\$5 and $x$.", "x$")).toMatchObject({ tex: "x" });
    expect(at("% $a$ not math\n$b$", "a")).toBeUndefined();
    expect(at("% $a$ not math\n$b$", "b")).toMatchObject({ tex: "b" });
  });

  it("does not pair dollars across a paragraph break or leave math unclosed", () => {
    expect(at("$a\n\nb$", "b")).toBeUndefined();
    expect(at("text $x", "x")).toBeUndefined();
  });

  it("skips non-math environments", () => {
    expect(at("\\begin{itemize} $q$ \\end{itemize}", "q")).toMatchObject({ tex: "q" });
    expect(at("\\begin{itemize} $q$ \\end{itemize}", "itemize}")).toBeUndefined();
  });
});
