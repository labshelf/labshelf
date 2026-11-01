# A8 hand check: math in prose

A8: in VS Code and in the browser, on a real note, a sum and an integral get results, a derivation with one sign error marks that step ✗ with a counterexample, and closing and reopening keeps the results. Run it in both apps. It needs Mathematica on this machine, and in the browser LabShelf Helper running.

## The note

Create a `.qmd` note (in a Space or on a paper) and paste this body:

````markdown
```{mathematica}
a = 3
```

A sum: $\sum_{k=1}^{n} k^2 =$

An integral: $\int_0^\infty e^{-x^2}\,dx =$

A numeric value: $\sqrt{2} \approx$

A variable from the cell above: $a^2 + 1 =$

An ODE to solve: $\frac{dy}{dx} = -2y$

A derivation with one sign error (the last step):

$$
\begin{aligned}
(a+b)^2 - (a-b)^2 &= a^2 + 2ab + b^2 - (a^2 - 2ab + b^2) \\
&= a^2 + 2ab + b^2 - a^2 + 2ab - b^2 \\
&= -4ab
\end{aligned}
$$
````

## Steps (same in VS Code and in the browser)

1. Run the `a = 3` cell once.
2. Click into each inline math that ends in `=` or `\approx` and leave it. Expect, each inserted in one undoable step (Ctrl/Cmd+Z removes it):
   - the sum: $\frac{1}{6} n (n+1)(2n+1)$ (or an equivalent form);
   - the integral: $\frac{\sqrt{\pi}}{2}$; its hover card shows Read as with the `euler-e` rewrite;
   - $\sqrt{2} \approx$: 1.41421…;
   - $a^2 + 1 =$: 10.
3. Hover or select the ODE: a Solve action appears; Solve inserts $y(x) = C_1 e^{-2x}$ (or Mathematica's form), with the `leibniz` rewrite in Read as.
4. Edit the derivation (type a space anywhere in it and wait about a second). Expect in the right gutter, one mark per line: ✓ (or ≈) on the first two lines, ✗ on the third with a wavy underline on the math. Hover the ✗: the card shows Read as and a counterexample with a point and both sides' values (the left side 4ab, the right side −4ab). Change `-4ab` to `4ab`: the ✗ becomes ✓ about a second later.
5. Change the cell to `a = 4` and run it: the $a^2 + 1$ result dims with a ⚠ glyph; its hover card says it is out of date and offers Recompute, which gives 17. Nothing changes until you click it.
6. Save, close the note and reopen it (in the browser, reload the page too). Expect every result still there, unchanged; no step marks (checks never run on open); open the file as text and see each result as `[$…$]{.labshelf-result engine=mathematica source=…}` right after its math.
7. Optional: open the note read-only, or with Mathematica unavailable: results show, no Solve, no Recompute, no marks.

## Report back

Pass or fail per step and app; for a failure, the step, the app and what showed. Then set session 5 of documents/plans/math-in-prose to done (or note the fixes needed).
