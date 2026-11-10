// Verifies the display equations listed from a flattened TeX text: env, labels, LaTeX numbers, expanded latex and offsets (plan D5, D6).
import { listEquations } from "../../src/equations/enumerate";

const tex = String.raw;

/** Collapses runs of whitespace and trims, so tests do not pin incidental spacing. */
const norm = (text: string): string => text.replace(/\s+/g, " ").trim();

/** Like norm, and also drops the spacing around row separators and begin/end so aligned wrappers compare by content. */
const tidy = (text: string): string => norm(text).replace(/\s*(\\\\|\\begin\{[a-z]+\}|\\end\{[a-z]+\})\s*/g, "$1");

const numbersOf = (source: string): string[][] => listEquations(source).map((equation) => equation.numbers);

describe("listEquations numbering by environment", () => {
  it("1.2a numbers an equation 1 and keeps its label", () => {
    const [eq] = listEquations(tex`\begin{equation} E = mc^2 \label{eq:e} \end{equation}`);
    expect(eq?.env).toBe("equation");
    expect(eq?.numbers).toEqual(["1"]);
    expect(eq?.labels).toEqual(["eq:e"]);
  });

  it("1.2a counts equations in order across the text", () => {
    const source = tex`\begin{equation}a\end{equation} text \begin{equation}b\end{equation} text \begin{equation}c\end{equation}`;
    expect(numbersOf(source)).toEqual([["1"], ["2"], ["3"]]);
  });

  it("1.2a gives a starred equation no number and still lists it", () => {
    const eqs = listEquations(tex`\begin{equation*}a\end{equation*} \begin{equation}b\end{equation}`);
    expect(eqs.map((eq) => eq.numbers)).toEqual([[], ["1"]]);
  });

  it("1.2a numbers each row of an align", () => {
    const [eq] = listEquations(tex`\begin{align} a &= b \label{r1} \\ c &= d \label{r2} \\ e &= f \end{align}`);
    expect(eq?.env).toBe("align");
    expect(eq?.numbers).toEqual(["1", "2", "3"]);
    expect(eq?.labels).toEqual(["r1", "r2"]);
  });

  it("1.2a leaves an align row with \\nonumber out of numbers and the counter", () => {
    const source = tex`\begin{align} a &= b \\ c &= d \nonumber \\ e &= f \end{align} \begin{equation}g\end{equation}`;
    expect(numbersOf(source)).toEqual([["1", "2"], ["3"]]);
  });

  it("1.2a leaves an align row with \\notag out of numbers", () => {
    const [eq] = listEquations(tex`\begin{align} a &= b \notag \\ c &= d \end{align}`);
    expect(eq?.numbers).toEqual(["1"]);
  });

  it("1.2a keeps the label of a row that has \\nonumber", () => {
    const [eq] = listEquations(tex`\begin{align} a &= b \label{only} \nonumber \end{align}`);
    expect(eq?.numbers).toEqual([]);
    expect(eq?.labels).toEqual(["only"]);
  });

  it("1.2a lets \\tag override the number of an align row and not advance the counter", () => {
    const source = tex`\begin{align} a &= b \tag{x} \\ c &= d \nonumber \\ e &= f \end{align} \begin{equation}g\end{equation}`;
    expect(numbersOf(source)).toEqual([["x", "1"], ["2"]]);
  });

  it("1.2a lets \\tag override the number of an equation and not advance the counter", () => {
    const source = tex`\begin{equation} a \tag{A} \label{t} \end{equation} \begin{equation} b \end{equation}`;
    const eqs = listEquations(source);
    expect(eqs[0]?.numbers).toEqual(["A"]);
    expect(eqs[0]?.labels).toEqual(["t"]);
    expect(eqs[1]?.numbers).toEqual(["1"]);
  });

  it("1.2a gives an align with \\nonumber on every row no numbers", () => {
    const [eq] = listEquations(tex`\begin{align} a &= b \nonumber \\ c &= d \nonumber \end{align}`);
    expect(eq?.numbers).toEqual([]);
  });

  it("1.2a gives align* no numbers", () => {
    const [eq] = listEquations(tex`\begin{align*} a &= b \\ c &= d \end{align*}`);
    expect(eq?.numbers).toEqual([]);
  });

  it("1.2a does not count a trailing row separator as a numbered row", () => {
    const [eq] = listEquations(tex`\begin{align} a &= b \\ c &= d \\ \end{align}`);
    expect(eq?.numbers).toEqual(["1", "2"]);
  });

  it("1.2a does not split an align row inside a nested cases environment", () => {
    const source = tex`\begin{align} f(x) &= \begin{cases} 1 & x > 0 \\ 0 & x \le 0 \end{cases} \\ g &= h \end{align}`;
    expect(numbersOf(source)).toEqual([["1", "2"]]);
  });

  it("1.2a numbers each row of a gather", () => {
    const [eq] = listEquations(tex`\begin{gather} a = b \label{g1} \\ c = d \end{gather}`);
    expect(eq?.env).toBe("gather");
    expect(eq?.numbers).toEqual(["1", "2"]);
    expect(eq?.labels).toEqual(["g1"]);
  });

  it("1.2a gives a multline one number however many rows it has", () => {
    const [eq] = listEquations(tex`\begin{multline} a + b \\ + c \\ + d \label{m} \end{multline}`);
    expect(eq?.env).toBe("multline");
    expect(eq?.numbers).toEqual(["1"]);
    expect(eq?.labels).toEqual(["m"]);
  });

  it("1.2a numbers each row of an eqnarray and honours \\nonumber", () => {
    const source = tex`\begin{eqnarray} a &=& b \\ c &=& d \nonumber \\ e &=& f \end{eqnarray}`;
    const [eq] = listEquations(source);
    expect(eq?.env).toBe("eqnarray");
    expect(eq?.numbers).toEqual(["1", "2"]);
  });

  it("1.2a gives eqnarray* no numbers", () => {
    const [eq] = listEquations(tex`\begin{eqnarray*} a &=& b \\ c &=& d \end{eqnarray*}`);
    expect(eq?.numbers).toEqual([]);
  });

  it("1.2a numbers each row of an alignat", () => {
    const [eq] = listEquations(tex`\begin{alignat}{2} a &= b & c &= d \\ e &= f & g &= h \end{alignat}`);
    expect(eq?.env).toBe("alignat");
    expect(eq?.numbers).toEqual(["1", "2"]);
  });

  it("1.2a numbers each row of a flalign", () => {
    const [eq] = listEquations(tex`\begin{flalign} a &= b \\ c &= d \end{flalign}`);
    expect(eq?.env).toBe("flalign");
    expect(eq?.numbers).toEqual(["1", "2"]);
  });

  it("1.2a lists a \\[ \\] display without a number", () => {
    const eqs = listEquations(tex`before \[ x = 1 \label{br} \] after`);
    expect(eqs).toHaveLength(1);
    expect(eqs[0]?.numbers).toEqual([]);
    expect(eqs[0]?.labels).toEqual(["br"]);
    expect(norm(eqs[0]?.latex ?? "")).toBe("x = 1");
  });

  it("1.2a lists a $$ $$ display without a number", () => {
    const eqs = listEquations(tex`before $$ y = 2 $$ after`);
    expect(eqs).toHaveLength(1);
    expect(eqs[0]?.numbers).toEqual([]);
    expect(norm(eqs[0]?.latex ?? "")).toBe("y = 2");
  });

  it("1.2a lists displaymath without a number", () => {
    const [eq] = listEquations(tex`\begin{displaymath} z = 3 \end{displaymath}`);
    expect(eq?.numbers).toEqual([]);
  });

  it("1.2a does not let unnumbered displays advance the counter", () => {
    const source = tex`\[a\] $$b$$ \begin{equation*}c\end{equation*} \begin{displaymath}d\end{displaymath} \begin{equation}e\end{equation}`;
    const eqs = listEquations(source);
    expect(eqs).toHaveLength(5);
    expect(eqs[4]?.numbers).toEqual(["1"]);
  });

  it("1.2a keeps a running count across mixed numbered environments", () => {
    const source = [
      tex`\begin{equation}a\end{equation}`,
      tex`\begin{align} b \\ c \end{align}`,
      tex`\begin{gather} d \\ e \end{gather}`,
      tex`\begin{multline} f \\ g \end{multline}`,
      tex`\begin{eqnarray} h \\ i \end{eqnarray}`,
    ].join("\n");
    expect(numbersOf(source)).toEqual([["1"], ["2", "3"], ["4", "5"], ["6"], ["7", "8"]]);
  });
});

describe("listEquations subequations, numberwithin and appendix", () => {
  it("1.2b numbers equations of a subequations block 3a and 3b", () => {
    const source = tex`
\begin{equation}a\end{equation}
\begin{equation}b\end{equation}
\begin{subequations}
\begin{equation}c\label{s1}\end{equation}
\begin{equation}d\label{s2}\end{equation}
\end{subequations}
\begin{equation}e\end{equation}`;
    const eqs = listEquations(source);
    expect(eqs.map((eq) => eq.numbers)).toEqual([["1"], ["2"], ["3a"], ["3b"], ["4"]]);
    expect(eqs[2]?.labels).toEqual(["s1"]);
    expect(eqs[3]?.labels).toEqual(["s2"]);
  });

  it("1.2b numbers the rows of an align inside subequations 2a 2b 2c", () => {
    const source = tex`
\begin{equation}a\end{equation}
\begin{subequations}
\begin{align} b \\ c \\ d \end{align}
\end{subequations}
\begin{equation}e\end{equation}`;
    expect(numbersOf(source)).toEqual([["1"], ["2a", "2b", "2c"], ["3"]]);
  });

  it("1.2b gives \\numberwithin{equation}{section} numbers like 2.1", () => {
    const source = tex`
\numberwithin{equation}{section}
\section{One}
\begin{equation}a\end{equation}
\section{Two}
\begin{equation}b\end{equation}
\begin{equation}c\end{equation}`;
    expect(numbersOf(source)).toEqual([["1.1"], ["2.1"], ["2.2"]]);
  });

  it("1.2b numbers align rows within a section 2.1 and 2.2", () => {
    const source = tex`
\numberwithin{equation}{section}
\section{One}
\begin{equation}a\end{equation}
\section{Two}
\begin{align} b \\ c \end{align}`;
    expect(numbersOf(source)).toEqual([["1.1"], ["2.1", "2.2"]]);
  });

  it("1.2b combines subequations with \\numberwithin as 2.1a", () => {
    const source = tex`
\numberwithin{equation}{section}
\section{One}
\begin{equation}a\end{equation}
\section{Two}
\begin{subequations}
\begin{equation}b\end{equation}
\begin{equation}c\end{equation}
\end{subequations}`;
    expect(numbersOf(source)).toEqual([["1.1"], ["2.1a"], ["2.1b"]]);
  });

  it("1.2b switches to A.1 after \\appendix", () => {
    const source = tex`
\numberwithin{equation}{section}
\section{One}
\begin{equation}a\end{equation}
\appendix
\section{Extra}
\begin{equation}b\end{equation}
\begin{equation}c\end{equation}
\section{More}
\begin{equation}d\end{equation}`;
    expect(numbersOf(source)).toEqual([["1.1"], ["A.1"], ["A.2"], ["B.1"]]);
  });
});

describe("listEquations enumeration", () => {
  it("A2 lists nothing for a text without displays", () => {
    expect(listEquations("Just text with inline $a + b$ math and 5 dollars.")).toEqual([]);
  });

  it("A2 ignores inline math next to a display", () => {
    const eqs = listEquations(tex`We know $a$ and $b$, so $$c = d$$ follows.`);
    expect(eqs).toHaveLength(1);
    expect(norm(eqs[0]?.latex ?? "")).toBe("c = d");
  });

  it("A2 ignores an escaped dollar sign", () => {
    expect(listEquations(tex`It costs \$5 and \$6 in total.`)).toEqual([]);
  });

  it("A2 lists equations in text order", () => {
    const eqs = listEquations(tex`$$a$$ \begin{equation}b\end{equation} \[c\] \begin{align}d\end{align}`);
    expect(eqs.map((eq) => norm(eq.latex))).toEqual(["a", "b", "c", "d"]);
    const offsets = eqs.map((eq) => eq.offset);
    expect([...offsets].sort((x, y) => x - y)).toEqual(offsets);
    expect(new Set(offsets).size).toBe(4);
  });

  it("A2 puts the offset at the opening delimiter of each equation", () => {
    const source = tex`Intro text. \begin{equation} a \end{equation} middle $$ b $$ end \[ c \]`;
    const eqs = listEquations(source);
    expect(eqs.map((eq) => eq.offset)).toEqual([
      source.indexOf(String.raw`\begin{equation}`),
      source.indexOf("$$"),
      source.indexOf(String.raw`\[`),
    ]);
  });

  it("A2 keeps the raw text between delimiters as body", () => {
    const [eq] = listEquations(tex`\begin{equation} x \in \R \label{k} \end{equation}`);
    expect(norm(eq?.body ?? "")).toBe(String.raw`x \in \R \label{k}`);
  });

  it("A2 keeps the raw text between $$ as body", () => {
    const [eq] = listEquations(tex`$$ \frac{a}{b} $$`);
    expect(norm(eq?.body ?? "")).toBe(String.raw`\frac{a}{b}`);
  });

  it("A2 collects several labels of one equation in order", () => {
    const [eq] = listEquations(tex`\begin{align} a \label{first} \\ b \label{second} \\ c \label{third} \end{align}`);
    expect(eq?.labels).toEqual(["first", "second", "third"]);
  });

  it("A2 gives an equation without a label an empty labels list", () => {
    const [eq] = listEquations(tex`\begin{equation}a\end{equation}`);
    expect(eq?.labels).toEqual([]);
  });

  it("A2 skips equations inside a verbatim environment and does not count them", () => {
    const source = tex`\begin{verbatim}
\begin{equation} shown \end{equation}
$$ shown too $$
\end{verbatim}
\begin{equation} real \end{equation}`;
    const eqs = listEquations(source);
    expect(eqs).toHaveLength(1);
    expect(norm(eqs[0]?.latex ?? "")).toBe("real");
    expect(eqs[0]?.numbers).toEqual(["1"]);
  });

  it("A2 skips display math written inside \\verb", () => {
    const source = tex`Type \verb|$$ x $$| to get a display, as in \begin{equation} y \end{equation}.`;
    const eqs = listEquations(source);
    expect(eqs).toHaveLength(1);
    expect(norm(eqs[0]?.latex ?? "")).toBe("y");
  });
});

describe("listEquations returned LaTeX", () => {
  it("A2 drops \\label from the latex of an equation", () => {
    const [eq] = listEquations(tex`\begin{equation} E = mc^2 \label{eq:e} \end{equation}`);
    expect(norm(eq?.latex ?? "")).toBe("E = mc^2");
  });

  it("A2 drops \\nonumber, \\notag and \\tag from the latex", () => {
    const eqs = listEquations(tex`\begin{equation} a \tag{x} \end{equation} \begin{equation} b \notag \end{equation} \begin{equation} c \nonumber \end{equation}`);
    expect(eqs.map((eq) => norm(eq.latex))).toEqual(["a", "b", "c"]);
  });

  it("A2 turns a multi-row align into an aligned block without labels or number commands", () => {
    const [eq] = listEquations(tex`\begin{align} a &= b \label{l1} \\ c &= d \nonumber \end{align}`);
    expect(tidy(eq?.latex ?? "")).toBe(String.raw`\begin{aligned}a &= b\\c &= d\end{aligned}`);
  });

  it("A2 turns a multi-row gather into a gathered block", () => {
    const [eq] = listEquations(tex`\begin{gather} a = b \label{l1} \\ c = d \end{gather}`);
    expect(tidy(eq?.latex ?? "")).toBe(String.raw`\begin{gathered}a = b\\c = d\end{gathered}`);
  });

  it("A2 keeps the content of a multline and removes its label", () => {
    const [eq] = listEquations(tex`\begin{multline} a + b \\ + c \label{m} \end{multline}`);
    const latex = norm(eq?.latex ?? "");
    expect(latex).toContain("a + b");
    expect(latex).toContain("+ c");
    expect(latex).not.toContain("label");
  });

  it("A2 drops the column-count argument of an alignat from the latex", () => {
    const [eq] = listEquations(tex`\begin{alignat}{2} a &= b & c &= d \\ e &= f & g &= h \end{alignat}`);
    const latex = eq?.latex ?? "";
    expect(latex).not.toContain("{2}");
    expect(latex).not.toContain("alignat");
  });

  it("A2 removes labels from every row of an eqnarray latex", () => {
    const [eq] = listEquations(tex`\begin{eqnarray} a &=& b \label{x} \\ c &=& d \label{y} \end{eqnarray}`);
    const latex = eq?.latex ?? "";
    expect(latex).not.toContain("label");
    expect(latex).not.toContain("eqnarray");
    expect(latex).toContain("a");
    expect(latex).toContain("d");
  });
});

describe("listEquations macro expansion in latex", () => {
  it("A3 expands the author's macros in latex and keeps body raw", () => {
    const source = tex`\newcommand{\R}{\mathbb{R}}
\begin{equation} x \in \R^2 \end{equation}`;
    const [eq] = listEquations(source);
    expect(norm(eq?.latex ?? "")).toBe(String.raw`x \in \mathbb{R}^2`);
    expect(eq?.body).toContain(String.raw`\R`);
  });

  it("A3 uses a macro defined after the equation", () => {
    const source = tex`\begin{equation} x \in \R^2 \end{equation}
\newcommand{\R}{\mathbb{R}}`;
    const [eq] = listEquations(source);
    expect(norm(eq?.latex ?? "")).toBe(String.raw`x \in \mathbb{R}^2`);
  });

  it("A3 uses the last definition of a twice-defined macro for every equation", () => {
    const source = tex`\newcommand{\a}{first}
\begin{equation} \a \end{equation}
\renewcommand{\a}{second}
\begin{equation} \a \end{equation}`;
    const eqs = listEquations(source);
    expect(eqs.map((eq) => norm(eq.latex))).toEqual(["second", "second"]);
  });

  it("A3 expands macros with arguments inside an aligned block", () => {
    const source = tex`\newcommand{\norm}[1]{\left\|#1\right\|}
\begin{align} \norm{a} &= 1 \\ \norm{b} &= 2 \end{align}`;
    const [eq] = listEquations(source);
    const latex = eq?.latex ?? "";
    expect(latex).toContain(String.raw`\left\|a\right\|`);
    expect(latex).toContain(String.raw`\left\|b\right\|`);
    expect(latex).not.toContain("norm");
  });

  it("A3 leaves commands that are not defined by the author as they are", () => {
    const [eq] = listEquations(tex`\begin{equation} \frac{a}{b} + \alpha \end{equation}`);
    expect(norm(eq?.latex ?? "")).toBe(String.raw`\frac{a}{b} + \alpha`);
  });
});

describe("listEquations with the author's moves of the equation counter", () => {
  const eqnr = tex`\newcommand{\eqnr}{\addtocounter{equation}{1}\tag{\theequation}}
\begin{document}
`;

  it("numbers an align* row whose macro hides \\addtocounter and \\tag{\\theequation}, and drops them from the latex", () => {
    const eqs = listEquations(tex`${eqnr}\begin{align*} a = b \eqnr\end{align*}
\begin{align*} c = d \eqnr\label{eq:c}\end{align*}
\begin{align} e = f \end{align}`);
    expect(eqs.map((eq) => eq.numbers)).toEqual([["1"], ["2"], ["3"]]);
    expect(eqs[1]?.labels).toEqual(["eq:c"]);
    expect(eqs.map((eq) => norm(eq.latex))).toEqual(["a = b", "c = d", "e = f"]);
  });

  it("reads \\tag{\\theequation} as the counter's current value within the section", () => {
    const eqs = listEquations(tex`\numberwithin{equation}{section}${eqnr}\section{A}\begin{equation} x \end{equation}
\begin{equation*} y \eqnr\end{equation*}`);
    expect(eqs.map((eq) => eq.numbers)).toEqual([["1.1"], ["1.2"]]);
  });

  it("follows \\setcounter and \\stepcounter on the equation counter in the document and inside a display", () => {
    expect(numbersOf(tex`\begin{document}\begin{equation} a \end{equation}\setcounter{equation}{9}
\begin{equation} b \end{equation}\stepcounter{equation}\begin{equation} c \end{equation}
\begin{align} d \stepcounter{equation} \\ e \end{align}`)).toEqual([["1"], ["10"], ["12"], ["14", "15"]]);
  });

  it("ignores counter commands in preamble definitions and on other counters", () => {
    expect(numbersOf(tex`\newcommand{\bump}{\stepcounter{equation}}\setcounter{equation}{5}
\begin{document}\addtocounter{section}{3}\begin{equation} a \end{equation}`)).toEqual([["1"]]);
  });

  it("moves the letter counter inside subequations", () => {
    expect(numbersOf(tex`\begin{document}\begin{subequations}\begin{equation} a \end{equation}
\stepcounter{equation}\begin{equation} b \end{equation}\end{subequations}`)).toEqual([["1a"], ["1c"]]);
  });
});
