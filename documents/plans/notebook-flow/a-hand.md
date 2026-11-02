# A12 — notebook flow, by hand

Check once in VS Code (the library detail pane or a Space, and the reader) and once in the browser (a project note or the library page). Note each step as pass or fail per host; a fail goes into `log.md` with the host and what you saw.

Before you start: Python 3 on PATH; Mathematica (`wolframscript`) with a valid licence for the Mathematica steps. Without Mathematica, its cells end "missing" and Run section stops there: mark the Mathematica steps "skipped" rather than fail.

## The note

Paste this into a note `.qmd` (two items; the ids are any unique ids). In the reader only the open item is the note (D5), so there check the Python item, then the Mathematica item.

````
::: {#n-01JNF6A12PY0000000000000AA .labshelf-item}
## Setup

```{python}
x = 2
x
```

```{python}
import warnings
warnings.warn("demo warning: x is small")
x * 10
```

## Compute

```{python}
print("\n".join(f"line {i}" for i in range(60)))
```

## Broken

```{python}
1 / 0
```

```{python}
x + 1
```
:::

::: {#n-01JNF6A12WL0000000000000BB .labshelf-item}
## Symbolic

```{mathematica}
Integrate[Sin[t]^2, t]
```

```{mathematica}
1/0
```
:::
````

## Steps

1. **Run all stops at the error.** Note bar → Run all (or Mod-Shift-Enter). While it runs, waiting cells say Queued and the status row says "Running k of n" with one Stop. It stops at `1 / 0` (an error); `x + 1` and both Mathematica cells say "Not run: stopped at an error above". Each cell that ran shows its run time next to Run.
2. **Warning band.** The second Python cell shows the result `20` and a quiet warnings line ("demo warning: x is small"), not the error style. In the Mathematica item, Run section on "Symbolic": `1/0` shows `ComplexInfinity` with a `Power::infy` warning, not an error.
3. **Long output.** The "Compute" cell shows 30 lines and "Show all (60 lines)"; Show all expands it.
4. **May be out of date.** Edit the first cell to `x = 3`. That cell says "Out of date: the code changed"; the later Python cells that ran say "May be out of date: a cell above changed since this ran" with Run below. Mathematica cells are not marked. Run below on the first cell clears them (and stops again at `1 / 0`).
5. **Collapse and reading mode.** Collapse the warning cell from its ⋯ menu: one line "Python · text · ran …". Collapse the "Compute" section from its heading chevron: everything up to "Broken" hides. Turn on Reading mode in the note menu: code hides, results and text stay. The `1 / 0` error stays visible. Close the note and reopen it: the collapses and Reading mode are back. The `.qmd` on disk has no trace of them (`git diff` or open the file as text). Then Expand all and turn Reading mode off.
6. **Outline.** Note menu → Outline: headings indented, each cell as "Python cell" / "Mathematica cell" with its first line, error and out-of-date badges in text and glyph. Choosing an entry scrolls to and selects the block.
7. **F8.** F8 / Shift-F8 (and Next / Previous problem in the note menu) go through the error and the out-of-date cells across both items. In VS Code check that F8 reaches the webview and does not open VS Code's own problems navigation.
8. **Alt-↑/↓ and undo.** Press Escape inside a cell's code to select it, then Alt-↓: the cell moves with its output below the next one. Put the caret in the "Compute" heading and press Alt-↑: the whole section moves above "Setup". One Undo restores each move.
9. **Insert '+'.** Hover a gap between blocks (or Tab to it): '+' offers Cell (Python), Equation, Drawing, Text, then Cell (Mathematica) and Cell (R). Each inserts standard Quarto (check the file as text). An empty note offers the same choices.
10. **Duplicate.** ⋯ → Duplicate on the first cell: a copy below with the same code, no output and no label.
11. **Sticky heading.** Scroll through the long output: the "Compute" heading stays visible at the top of the editor and does not overlap the note bar (D14). Note per host whether it held.

Pass when every step passes in VS Code and in the browser (Mathematica steps may be "skipped" when no licence is available).
