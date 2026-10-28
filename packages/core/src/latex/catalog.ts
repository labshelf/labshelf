// Holds the LaTeX completion catalog: the entry type and the command and environment tables.
/*!
 * The command and environment data in this file is derived from the data files of LaTeX Workshop
 * (https://github.com/James-Yu/LaTeX-Workshop), distributed under the MIT License:
 *
 * The MIT License (MIT)
 *
 * Copyright (c) 2016 James Yu
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/**
 * `snippet` uses VS Code snippet syntax. A command snippet starts at the command name (the backslash
 * is not part of it); an environment snippet is everything after `\begin{name}`.
 */
export interface LatexCatalogEntry {
  name: string;
  snippet: string;
  detail: string;
}

// Base commands for document structure, text, references and layout.
const BASE_COMMANDS: readonly LatexCatalogEntry[] = [
  { name: "documentclass", snippet: "documentclass[${2:options}]{${1:article}}", detail: "Document class" },
  { name: "usepackage", snippet: "usepackage[${2:options}]{${1:package}}", detail: "Load a package" },
  { name: "begin", snippet: "begin{${1:environment}}\n\t$0\n\\end{${1:environment}}", detail: "Begin an environment and close it" },
  { name: "end", snippet: "end{${1:environment}}", detail: "End an environment" },
  { name: "title", snippet: "title{${1:title}}", detail: "Document title" },
  { name: "author", snippet: "author{${1:author}}", detail: "Document author" },
  { name: "date", snippet: "date{${1:\\today}}", detail: "Document date" },
  { name: "maketitle", snippet: "maketitle", detail: "Typeset the title block" },
  { name: "tableofcontents", snippet: "tableofcontents", detail: "Table of contents" },
  { name: "listoffigures", snippet: "listoffigures", detail: "List of figures" },
  { name: "listoftables", snippet: "listoftables", detail: "List of tables" },
  { name: "appendix", snippet: "appendix", detail: "Switch to appendix numbering" },
  { name: "part", snippet: "part{${1:title}}", detail: "Part heading" },
  { name: "chapter", snippet: "chapter{${1:title}}", detail: "Chapter heading" },
  { name: "chapter*", snippet: "chapter*{${1:title}}", detail: "Unnumbered chapter heading" },
  { name: "section", snippet: "section{${1:title}}", detail: "Section heading" },
  { name: "section*", snippet: "section*{${1:title}}", detail: "Unnumbered section heading" },
  { name: "subsection", snippet: "subsection{${1:title}}", detail: "Subsection heading" },
  { name: "subsection*", snippet: "subsection*{${1:title}}", detail: "Unnumbered subsection heading" },
  { name: "subsubsection", snippet: "subsubsection{${1:title}}", detail: "Subsubsection heading" },
  { name: "subsubsection*", snippet: "subsubsection*{${1:title}}", detail: "Unnumbered subsubsection heading" },
  { name: "paragraph", snippet: "paragraph{${1:title}}", detail: "Run-in paragraph heading" },
  { name: "label", snippet: "label{${1:key}}", detail: "Label the current element" },
  { name: "ref", snippet: "ref{${1:key}}", detail: "Reference to a label" },
  { name: "pageref", snippet: "pageref{${1:key}}", detail: "Page number of a label" },
  { name: "cite", snippet: "cite{${1:key}}", detail: "Citation" },
  { name: "nocite", snippet: "nocite{${1:key}}", detail: "List a work without citing it" },
  { name: "bibliography", snippet: "bibliography{${1:file}}", detail: "BibTeX database" },
  { name: "bibliographystyle", snippet: "bibliographystyle{${1:plain}}", detail: "BibTeX style" },
  { name: "bibitem", snippet: "bibitem{${1:key}} $0", detail: "Entry of a thebibliography list" },
  { name: "footnote", snippet: "footnote{${1:text}}", detail: "Footnote" },
  { name: "caption", snippet: "caption{${1:caption}}", detail: "Caption of a figure or table" },
  { name: "textbf", snippet: "textbf{${1:text}}", detail: "Bold text" },
  { name: "textit", snippet: "textit{${1:text}}", detail: "Italic text" },
  { name: "textsl", snippet: "textsl{${1:text}}", detail: "Slanted text" },
  { name: "textsc", snippet: "textsc{${1:text}}", detail: "Small caps text" },
  { name: "textsf", snippet: "textsf{${1:text}}", detail: "Sans serif text" },
  { name: "textrm", snippet: "textrm{${1:text}}", detail: "Roman text" },
  { name: "texttt", snippet: "texttt{${1:text}}", detail: "Typewriter text" },
  { name: "emph", snippet: "emph{${1:text}}", detail: "Emphasised text" },
  { name: "underline", snippet: "underline{${1:text}}", detail: "Underlined text" },
  { name: "mbox", snippet: "mbox{${1:text}}", detail: "Box that never breaks across lines" },
  { name: "tiny", snippet: "tiny", detail: "Font size: tiny" },
  { name: "scriptsize", snippet: "scriptsize", detail: "Font size: script" },
  { name: "footnotesize", snippet: "footnotesize", detail: "Font size: footnote" },
  { name: "small", snippet: "small", detail: "Font size: small" },
  { name: "normalsize", snippet: "normalsize", detail: "Font size: normal" },
  { name: "large", snippet: "large", detail: "Font size: large" },
  { name: "Large", snippet: "Large", detail: "Font size: Large" },
  { name: "LARGE", snippet: "LARGE", detail: "Font size: LARGE" },
  { name: "huge", snippet: "huge", detail: "Font size: huge" },
  { name: "Huge", snippet: "Huge", detail: "Font size: Huge" },
  { name: "hspace", snippet: "hspace{${1:length}}", detail: "Horizontal space" },
  { name: "hspace*", snippet: "hspace*{${1:length}}", detail: "Horizontal space kept at a line break" },
  { name: "vspace", snippet: "vspace{${1:length}}", detail: "Vertical space" },
  { name: "vspace*", snippet: "vspace*{${1:length}}", detail: "Vertical space kept at a page break" },
  { name: "bigskip", snippet: "bigskip", detail: "Big vertical skip" },
  { name: "medskip", snippet: "medskip", detail: "Medium vertical skip" },
  { name: "smallskip", snippet: "smallskip", detail: "Small vertical skip" },
  { name: "quad", snippet: "quad", detail: "One em of horizontal space" },
  { name: "qquad", snippet: "qquad", detail: "Two ems of horizontal space" },
  { name: "newpage", snippet: "newpage", detail: "Start a new page" },
  { name: "clearpage", snippet: "clearpage", detail: "Flush floats and start a new page" },
  { name: "pagebreak", snippet: "pagebreak", detail: "Suggest a page break" },
  { name: "newline", snippet: "newline", detail: "Start a new line" },
  { name: "par", snippet: "par", detail: "End the paragraph" },
  { name: "noindent", snippet: "noindent", detail: "Do not indent the paragraph" },
  { name: "centering", snippet: "centering", detail: "Center the content" },
  { name: "raggedright", snippet: "raggedright", detail: "Left-aligned text" },
  { name: "raggedleft", snippet: "raggedleft", detail: "Right-aligned text" },
  { name: "item", snippet: "item $0", detail: "List item" },
  { name: "hline", snippet: "hline", detail: "Horizontal rule in a table" },
  { name: "multicolumn", snippet: "multicolumn{${1:n}}{${2:cols}}{${3:text}}", detail: "Cell spanning several columns" },
  { name: "input", snippet: "input{${1:file}}", detail: "Include a file" },
  { name: "include", snippet: "include{${1:file}}", detail: "Include a file on a new page" },
  { name: "newcommand", snippet: "newcommand{\\\\${1:name}}[${2:args}]{${3:definition}}", detail: "Define a command" },
  { name: "renewcommand", snippet: "renewcommand{\\\\${1:name}}[${2:args}]{${3:definition}}", detail: "Redefine a command" },
  { name: "newenvironment", snippet: "newenvironment{${1:name}}{${2:begin}}{${3:end}}", detail: "Define an environment" },
  { name: "newtheorem", snippet: "newtheorem{${1:name}}{${2:Title}}", detail: "Define a theorem-like environment" },
  { name: "pagestyle", snippet: "pagestyle{${1:plain}}", detail: "Page style of the document" },
  { name: "thispagestyle", snippet: "thispagestyle{${1:empty}}", detail: "Page style of this page" },
  { name: "setlength", snippet: "setlength{\\\\${1:length}}{${2:value}}", detail: "Set a length" },
  { name: "addtolength", snippet: "addtolength{\\\\${1:length}}{${2:value}}", detail: "Add to a length" },
  { name: "textwidth", snippet: "textwidth", detail: "Width of the text block" },
  { name: "linewidth", snippet: "linewidth", detail: "Width of the current line" },
  { name: "today", snippet: "today", detail: "Current date" },
  { name: "LaTeX", snippet: "LaTeX", detail: "The LaTeX logo" },
  { name: "ldots", snippet: "ldots", detail: "Ellipsis" },
];

// Math commands: fractions, accents, fonts, operators, relations, arrows and Greek letters.
const greek = (name: string): LatexCatalogEntry => ({ name, snippet: name, detail: "Greek letter" });
const symbol = (name: string, detail: string): LatexCatalogEntry => ({ name, snippet: name, detail });

const MATH_COMMANDS: readonly LatexCatalogEntry[] = [
  { name: "frac", snippet: "frac{${1:num}}{${2:den}}", detail: "Fraction" },
  { name: "dfrac", snippet: "dfrac{${1:num}}{${2:den}}", detail: "Fraction in display style (amsmath)" },
  { name: "binom", snippet: "binom{${1:above}}{${2:below}}", detail: "Binomial coefficient (amsmath)" },
  { name: "sqrt", snippet: "sqrt{${1:x}}", detail: "Square root" },
  { name: "sum", snippet: "sum_{${1:i=1}}^{${2:n}}", detail: "Summation" },
  { name: "prod", snippet: "prod_{${1:i=1}}^{${2:n}}", detail: "Product" },
  { name: "int", snippet: "int_{${1:a}}^{${2:b}}", detail: "Integral" },
  { name: "lim", snippet: "lim_{${1:x \\\\to \\\\infty}}", detail: "Limit" },
  { name: "text", snippet: "text{${1:text}}", detail: "Text inside math (amsmath)" },
  { name: "mathbf", snippet: "mathbf{${1:x}}", detail: "Bold math" },
  { name: "mathrm", snippet: "mathrm{${1:x}}", detail: "Roman math" },
  { name: "mathit", snippet: "mathit{${1:x}}", detail: "Italic math" },
  { name: "mathsf", snippet: "mathsf{${1:x}}", detail: "Sans serif math" },
  { name: "mathtt", snippet: "mathtt{${1:x}}", detail: "Typewriter math" },
  { name: "mathcal", snippet: "mathcal{${1:X}}", detail: "Calligraphic math" },
  { name: "mathbb", snippet: "mathbb{${1:R}}", detail: "Blackboard bold (amssymb)" },
  { name: "boldsymbol", snippet: "boldsymbol{${1:x}}", detail: "Bold math symbol (amsmath)" },
  { name: "operatorname", snippet: "operatorname{${1:name}}", detail: "Upright operator name (amsmath)" },
  { name: "DeclareMathOperator", snippet: "DeclareMathOperator{\\\\${1:name}}{${2:text}}", detail: "Define a math operator (amsmath)" },
  { name: "left", snippet: "left${1:(} $0 \\\\right${2:)}", detail: "Delimiters that grow with their content" },
  { name: "overline", snippet: "overline{${1:x}}", detail: "Line over" },
  { name: "overbrace", snippet: "overbrace{${1:x}}^{${2:text}}", detail: "Brace over" },
  { name: "underbrace", snippet: "underbrace{${1:x}}_{${2:text}}", detail: "Brace under" },
  { name: "overset", snippet: "overset{${1:top}}{${2:base}}", detail: "Symbol over another (amsmath)" },
  { name: "underset", snippet: "underset{${1:bottom}}{${2:base}}", detail: "Symbol under another (amsmath)" },
  { name: "hat", snippet: "hat{${1:x}}", detail: "Hat accent" },
  { name: "widehat", snippet: "widehat{${1:x}}", detail: "Wide hat accent" },
  { name: "tilde", snippet: "tilde{${1:x}}", detail: "Tilde accent" },
  { name: "bar", snippet: "bar{${1:x}}", detail: "Bar accent" },
  { name: "vec", snippet: "vec{${1:x}}", detail: "Vector arrow accent" },
  { name: "dot", snippet: "dot{${1:x}}", detail: "Dot accent" },
  { name: "boxed", snippet: "boxed{${1:formula}}", detail: "Boxed formula (amsmath)" },
  { name: "tag", snippet: "tag{${1:label}}", detail: "Custom equation tag (amsmath)" },
  { name: "eqref", snippet: "eqref{${1:key}}", detail: "Reference to an equation in parentheses (amsmath)" },
  { name: "intertext", snippet: "intertext{${1:text}}", detail: "Text between aligned lines (amsmath)" },
  { name: "numberwithin", snippet: "numberwithin{${1:equation}}{${2:section}}", detail: "Number a counter within another (amsmath)" },
  symbol("nonumber", "Suppress the equation number"),
  symbol("notag", "Suppress the equation tag (amsmath)"),
  symbol("displaystyle", "Display math style"),
  symbol("partial", "Partial derivative symbol"),
  symbol("nabla", "Nabla"),
  symbol("infty", "Infinity"),
  symbol("cdot", "Centered dot"),
  symbol("cdots", "Centered ellipsis"),
  symbol("vdots", "Vertical ellipsis"),
  symbol("times", "Multiplication sign"),
  symbol("pm", "Plus or minus"),
  symbol("leq", "Less than or equal"),
  symbol("geq", "Greater than or equal"),
  symbol("neq", "Not equal"),
  symbol("approx", "Approximately equal"),
  symbol("equiv", "Equivalent"),
  symbol("sim", "Similar"),
  symbol("propto", "Proportional to"),
  symbol("subset", "Subset"),
  symbol("subseteq", "Subset or equal"),
  symbol("in", "Element of"),
  symbol("notin", "Not an element of"),
  symbol("cup", "Union"),
  symbol("cap", "Intersection"),
  symbol("setminus", "Set difference"),
  symbol("emptyset", "Empty set"),
  symbol("forall", "For all"),
  symbol("exists", "There exists"),
  symbol("neg", "Negation"),
  symbol("to", "Right arrow"),
  symbol("mapsto", "Maps to"),
  symbol("rightarrow", "Right arrow"),
  symbol("leftarrow", "Left arrow"),
  symbol("Rightarrow", "Implies"),
  symbol("Leftrightarrow", "If and only if"),
  ...["alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "theta", "lambda", "mu", "pi", "rho", "sigma", "tau",
    "phi", "varphi", "psi", "omega", "Delta", "Sigma", "Omega"].map(greek),
];

// Commands of common packages: graphicx, hyperref, booktabs, xcolor, cleveref and geometry.
const PACKAGE_COMMANDS: readonly LatexCatalogEntry[] = [
  { name: "includegraphics", snippet: "includegraphics[${2:width=\\\\linewidth}]{${1:file}}", detail: "Insert an image (graphicx)" },
  { name: "graphicspath", snippet: "graphicspath{{${1:figures/}}}", detail: "Image search folders (graphicx)" },
  { name: "scalebox", snippet: "scalebox{${1:scale}}{${2:text}}", detail: "Scale a box (graphicx)" },
  { name: "resizebox", snippet: "resizebox{${1:width}}{${2:height}}{${3:text}}", detail: "Resize a box (graphicx)" },
  { name: "rotatebox", snippet: "rotatebox{${1:angle}}{${2:text}}", detail: "Rotate a box (graphicx)" },
  { name: "href", snippet: "href{${1:url}}{${2:text}}", detail: "Hyperlink with text (hyperref)" },
  { name: "url", snippet: "url{${1:url}}", detail: "Typeset a URL (hyperref)" },
  { name: "hypersetup", snippet: "hypersetup{${1:options}}", detail: "Set hyperref options (hyperref)" },
  { name: "autoref", snippet: "autoref{${1:key}}", detail: "Reference with its type name (hyperref)" },
  { name: "hyperlink", snippet: "hyperlink{${1:name}}{${2:text}}", detail: "Link to a target (hyperref)" },
  { name: "hypertarget", snippet: "hypertarget{${1:name}}{${2:text}}", detail: "Link target (hyperref)" },
  { name: "texorpdfstring", snippet: "texorpdfstring{${1:tex}}{${2:pdf}}", detail: "Alternative text for PDF strings (hyperref)" },
  { name: "cref", snippet: "cref{${1:key}}", detail: "Smart reference (cleveref)" },
  { name: "Cref", snippet: "Cref{${1:key}}", detail: "Smart reference, capitalised (cleveref)" },
  { name: "toprule", snippet: "toprule", detail: "Top rule of a table (booktabs)" },
  { name: "midrule", snippet: "midrule", detail: "Middle rule of a table (booktabs)" },
  { name: "bottomrule", snippet: "bottomrule", detail: "Bottom rule of a table (booktabs)" },
  { name: "cmidrule", snippet: "cmidrule{${1:a-b}}", detail: "Partial rule of a table (booktabs)" },
  { name: "addlinespace", snippet: "addlinespace", detail: "Extra space between rows (booktabs)" },
  { name: "textcolor", snippet: "textcolor{${1:color}}{${2:text}}", detail: "Colored text (xcolor)" },
  { name: "color", snippet: "color{${1:color}}", detail: "Switch the text color (xcolor)" },
  { name: "colorbox", snippet: "colorbox{${1:color}}{${2:text}}", detail: "Text on a colored background (xcolor)" },
  { name: "definecolor", snippet: "definecolor{${1:name}}{${2:rgb}}{${3:0,0,0}}", detail: "Define a color (xcolor)" },
  { name: "geometry", snippet: "geometry{${1:margin=2.5cm}}", detail: "Page layout (geometry)" },
  { name: "theoremstyle", snippet: "theoremstyle{${1:plain}}", detail: "Style of the next theorems (amsthm)" },
];

// Common environments with the body that follows their \begin{name}.
const BLOCK = "\n\t$0";
const plain = (name: string, detail: string): LatexCatalogEntry => ({ name, snippet: BLOCK, detail });
const floatBody = (kind: string): string =>
  `[\${1:htbp}]\n\t\\centering\n\t$0\n\t\\caption{\${2:caption}}\n\t\\label{${kind}:\${3:key}}`;

const ENVIRONMENTS: readonly LatexCatalogEntry[] = [
  plain("document", "Document body"),
  plain("abstract", "Abstract"),
  { name: "itemize", snippet: "\n\t\\item $0", detail: "Bulleted list" },
  { name: "enumerate", snippet: "\n\t\\item $0", detail: "Numbered list" },
  { name: "description", snippet: "\n\t\\item[$1] $0", detail: "Labelled list" },
  plain("equation", "Numbered equation"),
  plain("equation*", "Unnumbered equation"),
  plain("align", "Aligned equations (amsmath)"),
  plain("align*", "Aligned equations without numbers (amsmath)"),
  plain("gather", "Centered equations (amsmath)"),
  plain("gather*", "Centered equations without numbers (amsmath)"),
  plain("multline", "Equation split over lines (amsmath)"),
  plain("multline*", "Equation split over lines without number (amsmath)"),
  plain("split", "Split one equation at alignment points (amsmath)"),
  plain("aligned", "Aligned lines inside an equation (amsmath)"),
  plain("cases", "Cases (amsmath)"),
  plain("subequations", "Number equations as 1a, 1b, ... (amsmath)"),
  plain("math", "Inline math"),
  plain("displaymath", "Unnumbered display math"),
  plain("matrix", "Matrix without delimiters (amsmath)"),
  plain("pmatrix", "Matrix with parentheses (amsmath)"),
  plain("bmatrix", "Matrix with brackets (amsmath)"),
  plain("vmatrix", "Matrix with vertical bars (amsmath)"),
  { name: "figure", snippet: floatBody("fig"), detail: "Floating figure" },
  { name: "figure*", snippet: floatBody("fig"), detail: "Floating figure across two columns" },
  { name: "table", snippet: floatBody("tab"), detail: "Floating table" },
  { name: "table*", snippet: floatBody("tab"), detail: "Floating table across two columns" },
  { name: "tabular", snippet: "{${1:lcr}}\n\t$0", detail: "Table" },
  { name: "array", snippet: "{${1:lcr}}\n\t$0", detail: "Array in math mode" },
  plain("center", "Centered content"),
  plain("flushleft", "Left-aligned content"),
  plain("flushright", "Right-aligned content"),
  plain("quote", "Quotation"),
  plain("quotation", "Long quotation"),
  plain("verbatim", "Text printed as typed"),
  plain("verse", "Verse"),
  { name: "minipage", snippet: "{${1:0.5\\\\textwidth}}\n\t$0", detail: "Box with its own paragraphs" },
  { name: "thebibliography", snippet: "{${1:99}}\n\t\\bibitem{${2:key}} $0", detail: "Hand-written bibliography" },
  plain("titlepage", "Custom title page"),
  plain("theorem", "Theorem (needs \\newtheorem)"),
  plain("lemma", "Lemma (needs \\newtheorem)"),
  plain("proposition", "Proposition (needs \\newtheorem)"),
  plain("corollary", "Corollary (needs \\newtheorem)"),
  plain("definition", "Definition (needs \\newtheorem)"),
  plain("remark", "Remark (needs \\newtheorem)"),
  plain("example", "Example (needs \\newtheorem)"),
  plain("proof", "Proof (amsthm)"),
  plain("tikzpicture", "Drawing (tikz)"),
  { name: "frame", snippet: "{${1:title}}\n\t$0", detail: "Slide (beamer)" },
  plain("lstlisting", "Source code listing (listings)"),
];

export const LATEX_COMMANDS: readonly LatexCatalogEntry[] = [...BASE_COMMANDS, ...MATH_COMMANDS, ...PACKAGE_COMMANDS];
export const LATEX_ENVIRONMENTS: readonly LatexCatalogEntry[] = ENVIRONMENTS;
