# qmd notes: closer to a Mathematica notebook

Ideas for making paper notes (.qmd) feel like a Mathematica notebook while staying a typeset document. This replaces an earlier draft with four ideas. It records what was decided, what was measured, and what is still open.

## Constraints

- **The file stays standard Quarto.** Nothing proprietary: a note opens and renders in any Quarto tool.
- **No new syntax to learn.** The editor reacts to what people already type.
- **Same editor in VS Code and the browser.** All of it lives in `packages/core`.
- **Honest states.** An output that is an error, out of date or never run says so where it is read. Polish never suggests something was checked.

## Shipped: interactive plots and a fluid Manipulate

Plan [interactive-plots](../plans/interactive-plots/plan.yaml), merged in 433620a8:
- Python (matplotlib), R (ggplot) and Mathematica (`Graphics`, `Graphics3D`) plots are interactive: zoom, pan and hover in 2D, rotation in 3D.
- Every plot keeps a PNG beside it for Quarto PDF.
- The figure follows a slider while it is dragged, because the driver returns points instead of a PNG.

**Measured** in Mathematica 14.3, per frame:

| | Points | PNG |
|---|---|---|
| 2D `Plot` | 5 ms | 128 ms |
| 3D `Plot3D` | 17 ms | 59 ms |

**Size** of one stored plot:
- 2D spec: about 4 KB.
- 3D mesh: about 85 KB.
- glTF (rejected): 6 MB.

**Open:**
- The hand check A7.
- The pending hand checks of cell-params and multi-language-cells, which now run on the new behaviour.
- Python interpreter order (D5): the order setting, then `python3` on PATH, then managed Python sends anyone whose PATH Python lacks matplotlib to a pip command. Re-evaluate it after the hand checks.

## 1. Structure inferred while typing

People write as in a paper notebook. The editor recognises structure as they type, in front of them, and Backspace undoes it. Nothing changes silently on save.

| You type | The editor makes | In the .qmd |
|---|---|---|
| **Theorem.**, **Proposição.**, **Definição.**, **Lema.** at the start of a paragraph | a theorem-like block | `::: {#thm-…}` / `#prp-` / `#def-` / `#lem-` |
| **Obs.:** or **Nota:** at the start | a remark callout | `::: {.callout-note}` |
| `$$…$$` alone on a line | a numbered display equation, label created by the editor | `$$…$$ {#eq-…}` |
| `@` in text | a picker of equations and figures with previews; shows "(2)" or "Figura 1" | `@eq-…` |
| pasted Mathematica or Python code | a cell with the detected language | `` ```{mathematica} `` |

**Feasibility**, from the code at f0c0a40b:

| Piece | State | Effort |
|---|---|---|
| Backspace undoes a rule | `undoInputRule` from prosemirror-inputrules, bound at the top of Backspace in `qmdCommands.ts` | small |
| **`:::` divs as real nodes** | today a raw block (`qmdBlocks.ts` `readDiv`); needs a container node, recursive read and a byte-identical writer, modelled on `code_cell`'s `info`/`close` attrs | **medium; the base of this idea** |
| Keyword rules | the bold rule fires first on the closing `**`, so the block rule must match the paragraph after the mark is applied | small, after divs |
| Equation labels and numbers | `$$…$$ {#eq-x}` already round-trips; missing: create the label, show the number | small |
| `@` picker | new ProseMirror plugin; copy the keyboard pattern of the `\begin{` list in `mathEnvironments.ts` | medium |
| Numbering across a note | each item has its own editor, so numbers need the shared document (`sharedQmdDoc.ts`) | medium |
| Paste detection | no paste hook today; heuristics (`f[x_] :=`, `Plot[` vs `def`, `import`), falling back to the note's language | small |

**Decisions:**
- Quarto's prefixes are `thm-`, `lem-`, `cor-`, `prp-`, `def-`, `exm-`, `exr-`. `prop-` is not one, and would not render as a theorem.
- Picking an unlabelled equation with `@` labels it. Requiring labels first would mean learning `{#eq-…}`.
- Dropped: guessing a figure caption from the line under a plot. It is too uncertain.
- Dropped: numbering an equation only when the text says "as in (2)". The `@` reference does that explicitly.

## 2. Math that computes where it is written

This is the notebook's 2D input inside a sentence. Write a computation in LaTeX ending in `=`, and the result appears in the same sentence:

> The sum gives $\sum_{k=0}^{t-1}(1-b)b^k =$ ▸ $1-b^t$

**Tested** with Mathematica's `ToExpression[tex, TeXForm]`:

| LaTeX | Read as | |
|---|---|---|
| `\sum_{k=0}^{t-1}(1-b)b^k` | `Sum[(1-b) b^k, {k,0,t-1}]` | ✅ |
| `\int x\sin(x)\,dx` | `Integrate[x Sin[x], x]` | ✅ |
| `\int_0^1 \frac{\ln(1+x)}{x}\,dx` | `Integrate[Log[1+x]/x, {x,0,1}]` | ✅ |
| `\int_0^\infty \exp(-x^2)\,dx` | evaluates to `Sqrt[Pi]/2` | ✅ |
| `\lim_{n\to\infty}(1+1/n)^n` | `Limit[…, n -> Infinity]` | ✅ |
| `y'(x) = -k\, y(x)` | `y'[x] == -k y[x]`; `DSolve` gives `C[1] e^(-k x)` | ✅ |
| `y''(t) + \omega^2 y(t) = 0` | `y''[t] + ω^2 y[t] == 0` | ✅ |
| `e^{-x^2}`, `\mathrm{e}^{…}` | `e` as a **variable**, not Euler's number | ⚠️ silently wrong |
| `\frac{dy}{dx} = -ky` | `dy/dx` as a division | ⚠️ silently wrong |
| `\dot{x} = -x` | `OverDot[x]`, not a derivative | ⚠️ silently wrong |
| `\int_0^1 x^2\,\mathrm{d}x`, `\int … dx` without `\,` | fails | ❌ |

**Design:**
- **Normalise before parsing.** Rewrite `e^` to `\exp`, `\mathrm{d}x` and a bare `dx` to `\,dx`, `\frac{dy}{dx}` to `y'(x)`, and `\dot{x}` to `x'(t)`. Then call `ToExpression`.
- **Show how it was read.** Hovering a result shows the parsed form, for example `Integrate[E^(-x^2), {x,0,∞}]`. Silently wrong parses are the main risk; failures are easy to see.
- **Triggers.**
  - `=` at the end of an expression simplifies it.
  - `≈` gives the numeric value.
  - A full equation with derivatives (an ODE) offers a **Solve** action that runs `DSolve` or `Solve`, since it is already an equation.
- **Engine.** Mathematica first. SymPy only for simple input: its LaTeX parser needs antlr or lark, which the managed Python does not ship, and it is fragile on sums. An input it cannot read shows an honest error.
- **Storage.** The result is plain LaTeX in a Pandoc span, for example `$\sum… =$ [$1-b^t$]{.labshelf-result engine=mathematica source=<hash>}`.
  - It is valid Quarto and renders everywhere without executing anything.
  - Quarto's inline code runs only Python, R and Julia, never Mathematica, and would recompute on render.
  - A reader without Mathematica still sees the last result.
- **Staleness.** The hash covers the expression *and the cells above*, because variables come from the note's session. Sessions close after 10 minutes idle or on cancel, so a result can otherwise look current when it is not.

**Reuse:**
- The per-note session (`cellSessions.ts`) already shares variables between cells.
- The drivers already return LaTeX: `sympy.latex` in Python, `TeXForm` in Mathematica.
- The cell-params preview path runs an expression without writing it.
- `deriveCodeHash` already detects stale outputs.

**Open:**
- How to show "computing", "error" and "stale" inside a sentence; this needs a design from scratch.
- Inline expressions queue behind a long cell of the same language.
- In the browser, results need the LabShelf Helper.

**Not tested yet:** ODEs with initial conditions, systems, multiple integrals, matrices.

Prototype this alone, Mathematica only, before planning it.

## 3. Other notebook gaps

Ordered by value for the cost:

1. **Warnings are not errors.** Today any kernel message turns the whole output into an error (`cellDriver.wl`, `evaluate`). Mathematica shows `NIntegrate::slwcon` beside the result. Return the result with the messages apart. Small.
2. **Run all, run above, initialization cells.** Not found in core. The runner and the per-note queue already exist. Small.
3. **Built-in completion and usage for Mathematica.** Completion only knows names from the note's cells. Generate `Names["System`*"]` with each `::usage` once and ship it. Small to medium.
4. **Fold a section with its cells.** Unverified whether notes do this.
5. **Output as expression.** `%` and `Out[n]` probably work inside the persistent kernel; untested.

**Not pursued:** generic `Dynamic`, palettes, and Wolfram|Alpha free-form input. They tie the note to Mathematica's front end and break the Quarto and browser constraints.

## 4. Looks: a typeset document, not a notebook

Kept from the earlier draft, still open:
- **Styles.** One choice per note or library (`labshelf-style:` in the YAML header): Book (serif, narrow column, numbered theorems and equations, code hidden), Notebook (sans, code shown), Draft (minimal).
- **Cell controls on hover.** The "Python · Run again · Restart · Show code" row and the vertical border leave every output and show on hover; run and show code move to the left margin.
- **Equation outputs** centred like a paper equation.
- **Errors** as a short band with the likely cause and an action, not a raw traceback.
- **Stale outputs** marked discreetly; the top of the note summarises them.
- **Numbering computed in core** from the labels, with Quarto's rules, so the number on screen matches the rendered PDF. CSS only draws it. Quarto numbers only labelled items and counts theorems per type; CSS counters would drift.

## 5. Drawings that become TikZ

Draw a figure inside the note; the PDF gets TikZ, the screen gets SVG, and the drawing stays editable. Being turned into a plan: [drawings](../plans/drawings/).

- **TikZ comes from the drawing's own model, never from SVG.** A list of points, lines, arrows, circles and LaTeX labels maps line by line to `\draw` and `\node`. Converting arbitrary SVG (`svg2tikz`) gives unreadable Bézier soup and loses the math text.
- **The hard part is the editor:** selection, dragging, snapping, undo, LaTeX labels, arrows that follow their nodes.
- **Open libraries considered** (from knowledge, not checked):

| Library | What | TikZ | Note |
|---|---|---|---|
| quiver (MIT) | commutative diagrams on the web | exports `tikz-cd` | closest to math notes |
| Excalidraw (MIT) | whiteboard | none; a scene-to-TikZ converter needed | React, several MB, text is not LaTeX |
| draw.io (Apache-2.0) | full diagram editor, iframe embed | not native | heavy, aimed at flowcharts |
| GeoGebra | geometry and function plots | exports PGF/TikZ | licence free only for non-commercial use |
| TikZiT (GPL) | desktop graph editor on TikZ | native | Qt app, a reference only |
| tldraw | whiteboard | none | needs a licence key in production |
| TikZJax | TeX in WASM | renders TikZ | the reverse direction |

## 6. Algebra spell-check

Rewrite a paper's derivation step by step in plain LaTeX. Each `=` is checked in the background, and a wrong step gets a red wavy underline, like a misspelt word. Hovering shows a counterexample and how the step was read:

> ✗ Sides differ at b = 0.3, t = 2: 0.91 ≠ 0.973. Read as `1 - b^(t+1)`.

- **States:** ✓ proved (`lhs − rhs` simplifies to zero); ≈ agrees at random points but not proved, shown with a different mark so it never reads as checked; ✗ differs, with a counterexample; ⚠ holds only under a condition (`√(x²) = x` if x ≥ 0, from `Reduce` or `Simplify` with assumptions); ? could not read, with the attempted reading.
- **Nothing is written to the .qmd.** Like spell-check, the check is transient, so the file stays plain Quarto.
- **Reuse:** the reader of idea 2 (`ToExpression[…, TeXForm]` plus normalisation) and the per-note session, so variables from cells apply.
- **Speed:** a numeric test at random points is fast and catches most mistakes when `Simplify` cannot decide. Debounce, check only the edited step, and queue below cells.
- **Risks:** a silent misread mostly yields a false ✗, which the hover exposes; over-alarm beats hiding an error. Domains (`b ∈ (0,1)`, integer `n`): the first version samples positive reals; later, read assumptions from the text ("let $b \in (0,1)$").
- **Extension, equation from the paper:** select an equation in the PDF and it lands in the note as exact LaTeX with a link to its page; free symbols become sliders (cell-params and Manipulate). For arXiv papers the exact LaTeX comes from the e-print source, with no OCR. Today `latex/` only scans the user's own projects; nothing downloads a paper's arXiv source.
- **Why it is new:** Mathcha's CAS rewrites the expression, Mathematica must be asked, Lean needs a formal proof. Here the user keeps writing LaTeX and the sign error shows on the line where it entered.

Prototype: Mathematica only, on three or four real derivations from the user's notes, measuring how many steps are read correctly before designing the UI.

## 7. The paper's figure over yours

Reimplement the paper's model in a cell and run it. A **Compare with Figure 3 of the paper** action extracts the paper's curve from the PDF and draws it over yours, on the same axes, with zoom, and highlights where they differ ("diverges for x > 2.1, max difference 0.12 at x = 3.4"). Dragging a Manipulate slider moves your curve while the paper's stays still, so the user can find a parameter the paper used and did not state.

- **Most paper figures are vector.** Curves are PDF paths with exact coordinates, so no computer vision is needed.
- **Calibration from the axis labels.** Tick numbers are PDF text; matching each to its tick gives the page-to-data transform, log scales included.
- **Reuse:** core already walks pdf.js operator lists for fonts and images (`writing/checks/pdfFacts.ts`, `import/node/ocr.ts`). Reading paths extends that walk. The 2D plot spec takes the paper's curve as one more series.
- **Honest states:** "extracted from vector, calibrated by ticks 0–4" is exact; a raster figure falls back to approximate digitising with two clicks per axis; unidentified series let the user click the curve wanted. A digitised curve is never shown as exact data.
- **In the .qmd:** the extracted points live in a cell or a data file citing the page and figure (`@paper, Fig. 3`). Plain Quarto, and the rendered PDF shows the overlay.
- **Hard:** separating several series in one figure (colour, dash style, the legend text help); axes without numeric labels; bar and scatter charts (rectangles and markers, not lines); finding "Figure 3" (the caption is text; the figure is the vector region above it).
- **Why it is new:** WebPlotDigitizer is standalone and manual. No notebook knows the paper being read; LabShelf has the PDF and the runnable note side by side.

Prototype: five papers from the library with line figures; extract one page's paths and measure how often automatic tick calibration is right.

## Reference: Mathcha

[mathcha.io](https://www.mathcha.io/), read from its home page and seven documentation pages; the editor itself was not used.

- **Input:** rich text with a Math Mode. `$` opens inline math, `^` and `_` open superscript and subscript slots, `\` opens a Suggestion Box searchable by name, by category or by drawing the symbol.
- **Structure:** theorems with numbering options (own, shared, per section, nested, template); equation tags in four environments; references to theorems, sections, anchors, tables and figures; footnotes, bibliography, table of contents.
- **CAS Dialog:** a SymPy side panel with 33 actions (Simplify, Factor, Solve, Integrate, Limit, Sum, matrix operations…). The result **replaces** the expression; nothing is recomputed or marked stale.
- **Drawing:** drawing area, commutative diagrams, plotting; diagrams export to TikZ.
- **Format:** its own `.mathcha` file. LaTeX export covers only math and plain text; cross-references, bibliography and packages are not exported.
- **Lessons:** a discoverable trigger (`\` with search) works without new syntax, like our keyword rules and `@` picker. Its numbering does not survive export, which our Quarto constraint keeps. Its CAS actions with parameters (`Solve (var)`, `Substitute`) are a good model for the Solve action of idea 2.

## Suggested order

1. Warnings ≠ errors, and run all or run above: small fixes to daily friction.
2. `:::` divs as real nodes, then Backspace undo and the keyword rules.
3. Equation labels, the `@` picker and numbering in core.
4. A Mathematica-only prototype of math that computes in place, in parallel with step 3; it touches other files.
5. Styles and cell clean-up.

## Not verified

- That the YAML header survives a write. The scout believes so; it was not checked.
- That Pandoc ignores a `.labshelf-result` span the way it is expected to.
- SymPy's coverage of the LaTeX cases above.
- The notebook features listed above are compared from knowledge of Mathematica, not tested side by side.
