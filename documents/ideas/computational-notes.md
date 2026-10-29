# Computational notes

A computational note checks the mathematics of the papers you read. You select equation (12) in a PDF, it enters a note as editable LaTeX linked to its page, becomes a symbolic expression, and the note tells you whether (12) really follows from (11). This is an idea, not an implementation plan or an on-disk contract.

Notes are `.qmd` item files. Their format, anchors, code cells, outputs and the origin comments that link a note's equations into a manuscript are specified in [qmd-items.md](../contracts/qmd-items.md); this idea builds on that contract and does not restate it.

## 1. Capture an equation from the paper

In the reader, selecting an equation offers "Add to note". The note gets an item with:

- the equation as LaTeX, rendered;
- its number in the paper and a `labshelf:` link back to the page and region;
- the expression in SymPy, rendered back as an equation so you see how it was read.

A PDF's text layer turns mathematics into scrambled glyphs, so the LaTeX comes from sources tried in order and labelled in the note:

1. **arXiv HTML.** For papers with an arXiv id, arXiv's HTML rendering carries each formula's TeX in the MathML `alttext` and its equation number. The capture matches the selected region to the formula by number and by the PDF text, giving exact LaTeX. Coverage per paper is to be validated.
2. **arXiv source.** When the HTML rendering is missing, the e-print source has the formula; the paper's own `\newcommand`s expand before parsing. Downloads are per paper, rate-limited, for the user's own use; the note keeps only the captured equation.
3. **Formula recognition.** For anything else, the selected region goes to an image-to-LaTeX model: a local recognition model, or the user's configured AI provider. The note then shows the crop of the PDF beside the rendered result and asks for confirmation before the equation counts as captured.

**Reading LaTeX as mathematics.** `sympy.parsing.latex` exists but stays ambiguous: `f(x)`, `dx` inside integrals, subscripts as indices or names. The notation table settles most cases. Rendering the parsed expression back makes a wrong reading visible. AI repair handles what the grammar cannot.

## 2. Check this step

Selecting two captured equations, or one equation and the step before it, offers "Check this step". LabShelf writes the check for a computer algebra system (CAS): SymPy by default, or SageMath or Mathematica through their kernels. The check is an ordinary code cell in the note: visible, editable, and run like any other cell. The cell's result is one of:

| Result | Meaning |
|---|---|
| Holds symbolically | The CAS reduced the difference to zero under the stated assumptions |
| Holds numerically | Equal at many random points in the stated domain, but not proved |
| Holds to order *n* | The series agree up to the stated order, for steps the paper calls approximations |
| Fails at a point | A concrete counterexample: the values, and both sides evaluated |
| Undecided | The CAS could not decide; the cell says which part it could not simplify |

The honest middle results matter more than the extremes. Papers skip steps, approximate silently and rely on conventions, so a check states what it assumed: the domain of each symbol, the order of an expansion, a convention such as ħ = 1. A step the user fills in becomes its own equation, checked against its neighbours, so a long derivation turns into a chain where every link shows its status. A check is never a bare yes or no: it says what was proved, under which assumptions, or gives the counterexample.

The status follows the equation into the manuscript: an equation linked from a note shows its check result on hover, and an unverified or failing one is listed among the project's problems.

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

## 5. Cells in the terminal

The terminal app treats notes as text: a note opens as its `.qmd` file in `$EDITOR`, and `labshelf show` prints it. It has no rich editor and runs no cells. The idea is to run a note's code cells from the terminal, checks included, and write their results back into the note as cell outputs, so a derivation can be checked without leaving the shell. Nothing runs unless the user asks for it.

## Decisions to validate

- How often arXiv HTML and source recover the exact equation, and which recognition model is good enough for the rest.
- Whether numeric spot checks with stated domains catch the errors researchers actually find in papers.
- Where the notation table lives when one note checks several papers, and whether its front-matter keys become part of the contract.
- Which kernel the terminal uses to run a note's cells, and whether it runs one cell, a selection or the whole note.

## Evidence before implementation scope

Take ten derivations from papers in physics and applied mathematics, including one with a known error. Measure how many equations capture exactly from each source, how many steps check symbolically, numerically or not at all, and whether the known error is found.
