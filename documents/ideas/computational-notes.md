# Computational notes

A computational note checks the mathematics of the papers you read and carries it into what you write. You select equation (12) in a PDF, it enters a note as editable LaTeX linked to its page, becomes a symbolic expression, and the note tells you whether (12) really follows from (11). Later, writing in LaTeX, you call the same note back and insert its verified results into the manuscript. This is an idea, not an implementation plan or an on-disk contract.

LabShelf does not build a notebook. Cells, kernels, execution and reactivity come from Jupyter, marimo, Quarto and the engines they already run. What LabShelf adds is what those tools cannot know: the paper, its equations, and the manuscript that cites them.

## The note lives everywhere

A note is a `.qmd` file in the library, attached to a paper, a [Space](spaces.md#notes) or a writing project. The same note opens from the reader while reading, from the LaTeX editor while writing, and as a file in Jupyter, marimo or VS Code's Quarto extension, which run its cells. Equations carry Quarto labels (`$$ … $$ {#eq-smith-12}`), so the note stays a valid, renderable Quarto document outside LabShelf.

The terminal app is out of scope for this idea.

## 1. From the paper to the calculation

**Capture.** In the reader, selecting an equation offers "Add to note". The note gets a block with:

- the equation as LaTeX, rendered;
- its number in the paper and a `labshelf:` link back to the page and region;
- the expression in SymPy, rendered back as an equation so you see how it was read.

**Verify.** Selecting two captured equations, or one equation and the step before it, offers "Check this step". LabShelf writes the check for a computer algebra system (CAS): SymPy by default, or SageMath or Mathematica through their kernels. The check is an ordinary code cell in the note: visible, editable and runnable in any Jupyter. The kernel the user already has runs it. The cell's result is one of:

| Result | Meaning |
|---|---|
| Holds symbolically | The CAS reduced the difference to zero under the stated assumptions |
| Holds numerically | Equal at many random points in the stated domain, but not proved |
| Holds to order *n* | The series agree up to the stated order, for steps the paper calls approximations |
| Fails at a point | A concrete counterexample: the values, and both sides evaluated |
| Undecided | The CAS could not decide; the cell says which part it could not simplify |

The honest middle results matter more than the extremes. Papers skip steps, approximate silently and rely on conventions, so a check states what it assumed: the domain of each symbol, the order of an expansion, a convention such as ħ = 1. A step the user fills in becomes its own equation, checked against its neighbours, so a long derivation turns into a chain where every link shows its status.

## 2. From the calculation to the manuscript

In the LaTeX editor, "Insert from note" lists the note's equations and results with their status. Inserting one writes an ordinary `equation` environment with a trailing comment that names its origin:

```latex
\begin{equation}
  \frac{\partial I}{\partial a} = -\frac{\sqrt{\pi}}{2a^{3/2}}
  \label{eq:gauss-derivative}
\end{equation} % labshelf: notes/derivation.qmd#eq-gauss-derivative
```

The comment never reaches the PDF, and the `.tex` compiles anywhere. Through it, the editor knows the equation's source:

- **The note changed.** The equation shows as stale beside the source, with the new form and a one-click update.
- **The manuscript was edited by hand.** The equation shows as diverged; LabShelf never overwrites it and offers the difference instead.
- **The status is visible while writing.** Hovering the equation shows its check result and opens the note at that equation; an unverified or failing equation is listed among the project's problems.

Backlinks run the other way: the note shows every manuscript that uses each of its equations.

## 3. Notation

The same quantity is `\alpha` in the paper, `a` in the note and `\lambda` in the manuscript. Each note keeps a notation table in its front matter:

```yaml
labshelf:
  notation:
    - symbol: a
      paper: "\\alpha"        # in the paper this note checks
      manuscript: "\\lambda"
      assumptions: [positive]
    - symbol: f
      kind: function
```

The table does three jobs at once:

- **Capture translates.** An equation from the paper arrives in the note's notation.
- **Insertion translates.** A result arrives in the manuscript's notation.
- **Parsing is decided.** `kind: function` makes `f(x)` a call, not `f·x`; `assumptions` reach the CAS, so `sqrt(a**2)` simplifies to `a`.

The table grows as you work: when the parser meets an ambiguity, it asks once ("Is `f` a function?") and records the answer.

## 4. AI and the CAS complement each other

Each covers what the other cannot. An LLM reads prose, guesses intent and proposes: the next step of a derivation, the assumption hidden in the paper's text, SymPy code for LaTeX the parser rejects. It guarantees none of it. A CAS guarantees what it proves, but proposes nothing: it cannot read the paper, fill a skipped step or know that the authors meant "for small *x*". The AI proposes, the CAS decides:

- **Fill a gap.** "Explain this step" proposes intermediate equations between (11) and (12); each enters the note as a step and gets checked like any other.
- **Find the assumption.** The model reads the paragraph around the equation and proposes the domain or approximation the step uses ("for small *x*"); the user accepts it into the check.
- **Repair a parse.** When the parser fails, the model proposes SymPy code, and the note renders it back as an equation for the user to compare with the paper.

Every equation and step shows its origin (paper, you, AI) and its check status. AI never marks anything verified; only a check can. Provider, credentials and review behaviour follow the [embedded AI plan](../plans/ai-embedded/plan.md).

## Difficulties and how to solve them

**Getting the LaTeX of an equation out of a PDF.** A PDF's text layer turns mathematics into scrambled glyphs. Sources, tried in order and labelled in the note:

1. **arXiv HTML.** For papers with an arXiv id, arXiv's HTML rendering carries each formula's TeX in the MathML `alttext` and its equation number. The capture matches the selected region to the formula by number and by the PDF text, giving exact LaTeX. Coverage per paper is to be validated.
2. **arXiv source.** When the HTML rendering is missing, the e-print source has the formula; the paper's own `\newcommand`s expand before parsing. Downloads are per paper, rate-limited, for the user's own use; the note keeps only the captured equation.
3. **Formula recognition.** For anything else, the selected region goes to an image-to-LaTeX model: a local recognition model, or the user's configured AI provider. The note then shows the crop of the PDF beside the rendered result and asks for confirmation before the equation counts as captured.

**Reading LaTeX as mathematics.** `sympy.parsing.latex` exists but stays ambiguous: `f(x)`, `dx` inside integrals, subscripts as indices or names. The notation table settles most cases. Rendering the parsed expression back makes a wrong reading visible. AI repair handles what the grammar cannot.

**What "follows from" means.** The table of results above is the answer: never a bare yes or no, always what was proved, under which assumptions, or the counterexample.

**Running the checks.** Checks are plain cells, so they run where the user's notes already run: a Jupyter kernel, marimo, or VS Code's Jupyter extension. In the browser, the helper starts the local Jupyter kernel over its socket ([helper.md](../contracts/helper.md#transport)), and [Pyodide](https://pyodide.org/) with SymPy covers users without Python, at the cost of a slow first start. Mathematica users point the note at the Wolfram Language Jupyter kernel; no check requires a license.

**The manuscript is the user's.** An inserted equation is only ever updated on request, and a hand edit is never overwritten. The origin comment is the whole link; deleting it detaches the equation and nothing breaks.

**Trust.** Opening a note runs nothing. A check cell, whether the user, the paper capture or AI wrote it, runs when the user runs it. A received note shows its recorded results, marked with the engine that produced them.

## Decisions to validate

- How often arXiv HTML and source recover the exact equation, and which recognition model is good enough for the rest.
- Whether numeric spot checks with stated domains catch the errors researchers actually find in papers.
- Where the notation table lives when one note checks several papers.
- Which `labshelf:` front-matter keys and origin comments become contracts, and how backlinks are indexed.
- Whether the browser runs checks through the helper's Jupyter, Pyodide or both.

## Evidence before implementation scope

Take ten derivations from papers in physics and applied mathematics, including one with a known error. Measure how many equations capture exactly from each source, how many steps check symbolically, numerically or not at all, and whether the known error is found. Insert results into a manuscript, edit both sides, and confirm that nothing is overwritten and every divergence is shown.
