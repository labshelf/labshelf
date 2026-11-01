# Reader measurement (spec 1.4)

Items: [derivations.md](derivations.md). Run: `measure.ts` (bundled with esbuild, run with node) sends every item through `runMath` on the real kernel (Mathematica 14.3, `cellDriver.wl` + `mathDriver.wl`). `compare.wls` tests whether the held `readAs` is the same expression as the held expected reading. Raw replies: `raw-1.json` (first run) and `raw-2.json` (after 1.5).

Two numbers are counted per item:
- **read right**: `readAs` is the expected reading. This is what D11 counts.
- **usable**: read right *and* the state is the expected one (a value for eval/solve; proved or sampled for a true step; differs for the planted error). A right reading that the allowlist refuses is read right but not usable.

## First run (1.1–1.3 as built)

| Item | State | Read right | Usable | Note |
|---|---|---|---|---|
| D1.E1–E4 | unread | ✅ ×4 | ❌ ×4 | "Refused symbol β": the D3 name rule `^[A-Za-z][A-Za-z0-9]*$` refuses Greek letters |
| D1.S1–S3 | unread | ✅ ×3 | ❌ ×3 | same |
| D2.E1–E4 | value | ✅ ×4 | ✅ ×4 | bare `dx` and `e^{x}` normalised |
| D2.S1–S3 | proved | ✅ ×3 | ✅ ×3 | |
| D3.E1, E2 | value | ✅ ×2 | ✅ ×2 | Leibniz `\frac{dy}{dx} = -ky` is read as `y'[x] == -k y[x]` |
| D3.E3, E4 | value | ✅ ×2 | ✅ ×2 | |
| D3.E5 | unread | ❌ | ❌ | `\frac{d}{dx}(…)` read as `(d/dx)*(…)`; `C` is `System`C`, refused |
| D3.S1, S2 | proved | ✅ ×2 | ✅ ×2 | |
| D3.S3 | unread | ❌ | ❌ | `\frac{d}{dx}` again; `C` refused |
| D3.S4 | unread | ❌ | ❌ | `-k\left(C…\right)` read as the function call `k[C…]`; `C` refused |
| D4.E1–E3 | value | ✅ ×3 | ✅ ×3 | |
| D4.S1, S3 | proved | ✅ ×2 | ✅ ×2 | |
| D4.S2 | differs | ✅ | ✅ | planted sign error found, with its counterexample |
| D4.S4 | differs | ❌ | ❌ | a lone `\mathrm{e}` stays the variable `e` (spec 1.1 said `\mathrm{e}` is always Euler's number) |

**Totals, first run:** expressions read right 15/16 (94%), steps 11/14 (79%). Usable: expressions 11/16 (69%), steps 8/14 (57%).

### Misreads by cause, with a proposed rule

1. **Derivative operator** (D3.E5, D3.S3). `\frac{d}{dx} X` is read as a product with `d/dx`, and no TeX form makes TeXForm read `D`. Rule: the normaliser rewrites `\frac{\mathrm{d}}{\mathrm{d}v}` to `\frac{d}{dv}` and reports `derivative-operator`. The driver turns the held `(d/dv)*X` into `D[X, v]`. General: this is the textbook way to write a derivative.
2. **Implicit product before a parenthesis** (D3.S4). `k(…)` and `k\left(…\right)` are read as a function call. Rule: a single letter followed by `(` or `\left(` gets `\,` inserted (which TeXForm reads as Times) unless the parenthesis holds only single symbols separated by commas (`f(x)`, `y(t)`, `g(x, y)`, which stay function calls). Reported as `implicit-product`. General: `a(b+c)` is everywhere.
3. **A lone `\mathrm{e}`** (D4.S4). Rule: `\mathrm{e}` not followed by `^` becomes `\exp\left(1\right)` (read as `E^1`), reported as `euler-e`. This is a gap against spec 1.1's own decision.
4. **Allowlist refusals of right readings** (D1, D3: β, C). These are not misreads, but they make right readings unusable. Rule (driver): a Global` name is allowed when it starts with a letter and has only letters and digits, Unicode letters included (`LetterQ`). The single letters that TeXForm reads as System` symbols (`C`, `D`, `K`, `N`, `O`), when they are not a head, are replaced in the held parse by formal symbols (`\[FormalCapitalC]` …). These cannot be assigned and so stay free variables. `E` and `I` keep their meaning. General: Greek letters and a constant `C` are in almost every derivation.

All four are general, so they go to package 1.5.

## Second run (after 1.5)

Every item now has the expected state: values for all eval/solve items, proved for every true step, and differs with a counterexample for the planted sign error (D4.S2). `compare.wls` still reports four items as different (D3.E5, D3.S3, D3.S4, D4.S4). These were judged right by hand: D3's held forms print the same once both sides are re-parsed (InputForm writes `C e^{-kx}` as `C/E^(k*x)`, so the string round trip changes the tree, not the reading), and D4.S4 reads `\mathrm{e}` as `E^1`, which is `E`. Each pair also evaluates to the same value.

**Totals, second run:** expressions read right 16/16 (100%), steps 14/14 (100%). Usable: expressions 16/16, steps 14/14.

## Verdict (D11)

Rule: go when at least 80% of expressions and 70% of steps are read right after 1.5. The final totals are 100% and 100%, so the verdict is **go**. (The first run already passed the rule on readings, at 94% and 79%, but only 69% and 57% were usable.)

Caveats: 30 items from four derivations, three of them textbook material written for this run. The 1.5 implementer found a misread not covered here: `C x` with a plain space is read as the single symbol `Cx`. It needs a rule if real notes write it that way.
