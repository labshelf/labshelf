// Pins what the typing helpers take the cursor to sit in, for LaTeX and Typst, read from the text before it.
import { deriveTypingContext } from "../../../src/writing/typing/index";
import { parseMarked } from "./typingFixture";

const at = (language: "latex" | "typst", marked: string): string => {
  const { text, from } = parseMarked(marked);
  return deriveTypingContext(language, text, from);
};

describe("deriveTypingContext for LaTeX", () => {
  it.each([
    ["plain ‸text", "text"],
    ["a $x‸ b", "math"],
    ["a $x$ ‸b", "text"],
    ["$$x‸$$", "math"],
    ["$$x$$ ‸", "text"],
    ["\\(x‸\\)", "math"],
    ["\\(x\\) ‸", "text"],
    ["\\[x‸", "math"],
    ["\\[x\\]‸", "text"],
    ["\\begin{equation}\nx‸", "math"],
    ["\\begin{align*}\nx‸", "math"],
    ["\\begin{align*}\nx\n\\end{align*}\n‸", "text"],
    ["\\begin{gather}x\\end{gather} ‸", "text"],
    ["$x \\text{if ‸", "text"],
    ["$x \\text{a {b} c} ‸", "math"],
    ["\\[ \\mbox{‸} \\]", "text"],
    ["costs \\$5 ‸", "text"],
    ["\\$ x‸", "text"],
    ["% a comment $x‸", "comment"],
    ["50\\% off $x‸", "math"],
    ["% comment\n‸", "text"],
    ["\\\\% comment ‸", "comment"],
    ["\\begin{verbatim}\n$x‸", "verbatim"],
    ["\\begin{verbatim}\n$x\n\\end{verbatim}\n‸", "text"],
    ["\\begin{lstlisting}\n%‸", "verbatim"],
    ["\\begin{minted}{python}\n‸", "verbatim"],
    ["\\verb|a $b‸", "verbatim"],
    ["\\verb|a| $b‸", "math"],
    ["\\verb+x\n‸", "verbatim"],
    ["a $stray\n\nnew paragraph ‸", "text"],
    ["$$x\n  \n‸", "text"],
    ["\\{ $x‸", "math"],
  ])("%j is %s", (marked, expected) => {
    expect(at("latex", marked)).toBe(expected);
  });
});

describe("deriveTypingContext for Typst", () => {
  it.each([
    ["plain ‸", "text"],
    ["$x‸", "math"],
    ["$x$ ‸", "text"],
    ["\\$ ‸", "text"],
    ["// note $x‸", "comment"],
    ["// note\n‸", "text"],
    ["see https://x.org/a ‸", "text"],
    ["/* a /* b */ still‸", "comment"],
    ["/* a /* b */ c */ ‸", "text"],
    ["`code $‸", "verbatim"],
    ["`code` $x‸", "math"],
    ["``` \nraw $‸", "verbatim"],
    ["```\nraw\n``` ‸", "text"],
    ["````\n```\n‸", "verbatim"],
    ["``$x‸", "math"],
    ["$x \"text‸", "string"],
    ["$x \"text\" ‸", "math"],
    ["\"quote‸", "text"],
  ])("%j is %s", (marked, expected) => {
    expect(at("typst", marked)).toBe(expected);
  });
});
