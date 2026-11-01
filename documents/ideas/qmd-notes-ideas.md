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
