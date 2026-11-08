// The starter source of a new LaTeX or Typst talk or poster, marked with a `labshelf: talk|poster` comment so it is recognised whatever it imports.
import { listDeckSizePresets, type DeckKind, type DeckSize } from "./deckSizes.js";
import type { SourceDeckFormat } from "./sourceDecks.js";

/** The LaTeX poster sizes a new tikzposter offers: the A series, portrait or landscape. */
export const LATEX_POSTER_PAPERS = ["a0", "a1", "a2"] as const;
export type LatexPosterPaper = (typeof LATEX_POSTER_PAPERS)[number];

/** How a new source talk or poster is shaped: a talk's aspect ratio, or a poster's size (a DeckSize for Typst, an A paper and orientation for LaTeX). */
export type SourceDeckShape =
  | { kind: "talk"; aspect: "16:9" | "4:3" }
  | { kind: "poster"; size: DeckSize; paper?: LatexPosterPaper; landscape?: boolean };

const escapeLatex = (text: string): string => text.replace(/[\\{}$&#^_%~]/g, (ch) => (ch === "\\" ? "\\textbackslash{}" : ch === "~" ? "\\textasciitilde{}" : ch === "^" ? "\\textasciicircum{}" : `\\${ch}`));
const escapeTypst = (text: string): string => text.replace(/[\\#*_`$<>@\[\]]/g, (ch) => `\\${ch}`);

function latexTalk(title: string, aspect: "16:9" | "4:3", blank = false): string {
  return `% labshelf: talk
\\documentclass[aspectratio=${aspect === "16:9" ? "169" : "43"}]{beamer}
\\usetheme{default}
\\setbeamertemplate{navigation symbols}{}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amssymb,graphicx}

\\title{${escapeLatex(title)}}
\\author{}
\\date{\\today}

\\begin{document}

\\begin{frame}
  \\titlepage
  \\note{Greet the audience and say the problem in one sentence.}
\\end{frame}
${blank ? "" : LATEX_TALK_FRAMES}
\\end{document}
`;
}

const LATEX_TALK_FRAMES = `
\\begin{frame}{Motivation}
  \\begin{itemize}
    \\item First point
    \\item Second point
  \\end{itemize}
  \\note{Speaker notes for this slide: only you see them in the presenter view.}
\\end{frame}

\\begin{frame}{Results}
  \\begin{columns}
    \\column{0.5\\textwidth}
      A figure goes here.
    \\column{0.5\\textwidth}
      \\[ e^{i\\pi} + 1 = 0 \\]
  \\end{columns}
\\end{frame}

\\begin{frame}{Conclusion}
  Thank you!
\\end{frame}
`;

function latexPoster(title: string, paper: LatexPosterPaper, landscape: boolean): string {
  return `% labshelf: poster
\\documentclass[25pt, ${paper}paper, ${landscape ? "landscape" : "portrait"}]{tikzposter}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amssymb,graphicx}
\\usetheme{Default}

\\title{${escapeLatex(title)}}
\\author{}
\\institute{}

\\begin{document}
\\maketitle

\\begin{columns}
  \\column{0.5}
  \\block{Introduction}{
    What the problem is and why it matters.
  }
  \\block{Method}{
    \\[ \\min_{x} \\|Ax - b\\|_2^2 \\]
  }

  \\column{0.5}
  \\block{Results}{
    A figure goes here.
  }
  \\block{Conclusion}{
    The main take-away in one sentence.
  }
\\end{columns}

\\end{document}
`;
}

function typstTalk(title: string, aspect: "16:9" | "4:3", blank = false): string {
  const [width, height] = aspect === "16:9" ? ["254mm", "142.88mm"] : ["254mm", "190.5mm"];
  return `// labshelf: talk
// One slide per level-2 heading${blank ? "" : " (== Title)"}. Speaker notes go in #speaker-note[...]: the presenter view shows them.
#let speaker-note(body) = none

#set page(width: ${width}, height: ${height}, margin: (x: 1.6cm, y: 1.2cm), numbering: "1", number-align: right + bottom)
#set text(size: 20pt)
#show heading.where(level: 2): it => {
  pagebreak(weak: true)
  block(below: 1em, text(size: 28pt, weight: "bold", it.body))
}

#align(center + horizon)[
  #text(size: 36pt, weight: "bold")[${escapeTypst(title)}]

  #datetime.today().display()
]
#speaker-note[Greet the audience and say the problem in one sentence.]
${blank ? "" : TYPST_TALK_SLIDES}`;
}

const TYPST_TALK_SLIDES = `
== Motivation
- First point
- Second point
#speaker-note[Speaker notes for this slide: only you see them in the presenter view.]

== Results
#grid(columns: (1fr, 1fr), gutter: 1cm,
  [A figure goes here.],
  [$ e^(i pi) + 1 = 0 $],
)

== Conclusion
Thank you!
`;

const typstLength = (size: DeckSize, side: number): string => `${side}${size.unit === "in" ? "in" : "mm"}`;

function typstPoster(title: string, size: DeckSize): string {
  return `// labshelf: poster
#set page(width: ${typstLength(size, size.w)}, height: ${typstLength(size, size.h)}, margin: 3cm)
#set text(size: 32pt)
#show heading.where(level: 1): it => block(below: 0.6em, text(size: 54pt, fill: rgb("#1f5673"), it.body))

#align(center)[
  #text(size: 96pt, weight: "bold")[${escapeTypst(title)}]
]
#v(2cm)

#columns(2, gutter: 3cm)[
  = Introduction
  What the problem is and why it matters.

  = Method
  $ min_x norm(A x - b)_2^2 $

  #colbreak()

  = Results
  A figure goes here.

  = Conclusion
  The main take-away in one sentence.
]
`;
}

/** The sections of a new LaTeX or Typst poster: the column ratios, the type scale (Typst multiplies its base text size by it) and each section in order. */
export interface SourcePosterLayout { columns: number[]; typeScale: number; sections: Array<{ title: string; text: string; column: number; takeaway?: boolean }> }

const columnFraction = (ratio: number, sum: number): string => String(Math.round((ratio / sum) * 100) / 100);

function latexLayoutPoster(title: string, paper: LatexPosterPaper, landscape: boolean, layout: SourcePosterLayout): string {
  const sum = layout.columns.reduce((total, ratio) => total + ratio, 0);
  const columns = layout.columns.map((ratio, column) => [
    `  \\column{${columnFraction(ratio, sum)}}`,
    ...layout.sections.filter((section) => section.column === column).map((section) => (section.takeaway === true
      ? `  \\block{}{\\Huge ${escapeLatex(section.text)}}`
      : `  \\block{${escapeLatex(section.title)}}{\n    ${escapeLatex(section.text)}\n  }`)),
  ].join("\n"));
  return `% labshelf: poster
\\documentclass[25pt, ${paper}paper, ${landscape ? "landscape" : "portrait"}]{tikzposter}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amssymb,graphicx}
\\usetheme{Default}

\\title{${escapeLatex(title)}}
\\author{}
\\institute{}

\\begin{document}
\\maketitle

\\begin{columns}
${columns.join("\n\n")}
\\end{columns}

\\end{document}
`;
}

const typstPt = (value: number): string => `${Math.round(value * 100) / 100}pt`;

function typstLayoutPoster(title: string, size: DeckSize, layout: SourcePosterLayout): string {
  const ratios = layout.columns.map((ratio) => `${ratio}fr`);
  const cells = layout.columns.map((_, column) => {
    const parts = layout.sections.filter((section) => section.column === column).map((section) => (section.takeaway === true
      ? `    #text(size: 72pt, weight: "bold")[${escapeTypst(section.text)}]`
      : `    = ${escapeTypst(section.title)}\n    ${escapeTypst(section.text)}`));
    return `  [\n${parts.join("\n\n")}\n  ],`;
  });
  return `// labshelf: poster
#set page(width: ${typstLength(size, size.w)}, height: ${typstLength(size, size.h)}, margin: 3cm)
#set text(size: ${typstPt(32 * layout.typeScale)})
#show heading.where(level: 1): it => block(below: 0.6em, text(size: 54pt, fill: rgb("#1f5673"), it.body))

#align(center)[
  #text(size: 96pt, weight: "bold")[${escapeTypst(title)}]
]
#v(2cm)

#grid(columns: (${ratios.join(", ")}${ratios.length === 1 ? "," : ""}), gutter: 3cm,
${cells.join("\n")}
)
`;
}

/** The source of a new tikzposter (one \column per layout column, its sections as blocks) or Typst poster (a grid of the columns) laid out as given. */
export function scaffoldSourcePoster(format: SourceDeckFormat, title: string, shape: Extract<SourceDeckShape, { kind: "poster" }>, layout: SourcePosterLayout): string {
  return format === "latex" ? latexLayoutPoster(title, shape.paper ?? "a0", shape.landscape === true, layout) : typstLayoutPoster(title, shape.size, layout);
}

/** The starter source of a new talk with the title slide only. */
export function scaffoldBlankSourceTalk(format: SourceDeckFormat, title: string, aspect: "16:9" | "4:3"): string {
  return format === "latex" ? latexTalk(title, aspect, true) : typstTalk(title, aspect, true);
}

/** The starter source of a new talk (Beamer or a self-contained Typst page setup) or poster (tikzposter or a Typst page of the size). */
export function scaffoldSourceDeck(format: SourceDeckFormat, title: string, shape: SourceDeckShape): string {
  if (shape.kind === "talk") return format === "latex" ? latexTalk(title, shape.aspect) : typstTalk(title, shape.aspect);
  return format === "latex" ? latexPoster(title, shape.paper ?? "a0", shape.landscape === true) : typstPoster(title, shape.size);
}

const PAPER_MM: Record<LatexPosterPaper, [number, number]> = { a0: [841, 1189], a1: [594, 841], a2: [420, 594] };

/** One size a new source talk or poster can take, as a picker shows it. */
export interface SourceDeckShapeChoice { label: string; description?: string; shape: SourceDeckShape }

/** The sizes a new source talk or poster offers: 16:9 and 4:3 for talks, the A papers either way for tikzposter, the poster presets for Typst. */
export function listSourceDeckShapes(kind: DeckKind, format: SourceDeckFormat): SourceDeckShapeChoice[] {
  if (kind === "talk") return (["16:9", "4:3"] as const).map((aspect) => ({ label: aspect, shape: { kind: "talk", aspect } }));
  if (format === "latex") {
    return LATEX_POSTER_PAPERS.flatMap((paper) => [false, true].map((landscape): SourceDeckShapeChoice => {
      const [w, h] = PAPER_MM[paper];
      const size: DeckSize = { w: landscape ? h : w, h: landscape ? w : h, unit: "mm" };
      return { label: `${paper.toUpperCase()} ${landscape ? "landscape" : "portrait"}`, description: `${size.w} × ${size.h} mm`, shape: { kind: "poster", size, paper, landscape } };
    }));
  }
  return listDeckSizePresets("poster").map((preset) => ({ label: preset.label, shape: { kind: "poster", size: preset.size } }));
}
