// Tests that LaTeX and Typst tokens are painted from the code theme's colour roles.
import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { highlightTree } from "@lezer/highlight";
import { codeHighlight } from "../../../src/library-page/editor/editorTheme";
import { typstLanguage } from "../../../src/library-page/editor/typst";

const latex = StreamLanguage.define(stex);
const typst = (typstLanguage as unknown[])[0] as StreamLanguage<unknown>;

// The CSS rule of each class the highlighter puts on `text`, keyed by the highlighted slice.
function paint(language: StreamLanguage<unknown>, text: string): Map<string, string> {
  const rules = codeHighlight.module!.getRules();
  const painted = new Map<string, string>();
  highlightTree(language.parser.parse(text), codeHighlight, (from, to, classes) => {
    const rule = classes.split(" ").map((c) => rules.split("\n").find((r) => r.startsWith(`.${c} `)) ?? "").join(" ");
    painted.set(text.slice(from, to), rule);
  });
  return painted;
}

describe("code highlight", () => {
  it("paints LaTeX commands, environment names, comments and math from their roles", () => {
    const painted = paint(latex, "\\begin{proof} $x$ % done\n");
    expect(painted.get("\\begin")).toContain("--ls-code-command");
    expect(painted.get("proof")).toContain("--ls-code-argument");
    expect(painted.get("x")).toContain("--ls-code-math");
    expect(painted.get("% done")).toContain("--ls-code-comment");
  });

  it("paints Typst math from the math role and its delimiters as keywords", () => {
    const painted = paint(typst, "#let a = $x + 1$\n");
    expect(painted.get("#let")).toContain("--ls-code-keyword");
    expect(painted.get("x + 1")).toContain("--ls-code-math");
    expect(painted.get("$")).toContain("--ls-code-keyword");
  });

  it("paints Typst headings and references", () => {
    const painted = paint(typst, "= Intro\nSee @smith2020.\n");
    expect(painted.get("= Intro")).toContain("--ls-code-heading");
    expect(painted.get("@smith2020.")).toContain("--ls-code-reference");
  });
});
