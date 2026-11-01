# Prototype derivations (spec 1.4)

Only one note on this machine has math (`~/Documents/LabShelf Teste/.research/papers/kingma2015adam/notes.qmd`, the Adam bias correction), and it has no chain of three `=` steps. D1 writes out that note's derivation in full. D2–D4 are textbook material: integration by parts, a separable ODE, and a limit. D4 S2 has a planted sign error.

Each item lists its TeX, the op, and the expected Mathematica reading (InputForm of the held parse). These were written before any run. A reading is right when the kernel finds `ToExpression[expected, InputForm, HoldForm] === ToExpression[readAs, InputForm, HoldForm]`. When the two differ only in a form that is the same expression (such as `-(k*y[x])` against `-k*y[x]`), the judgement is made by hand and the reason recorded in results.md. Steps also have an expected state: `proved` or `sampled` when the step is true, `differs` for the planted error.

```json
[
  {"id": "D1.E1", "op": "eval", "tex": "(1-\\beta)\\sum_{i=1}^{t}\\beta^{t-i}", "expect": "(1 - \\[Beta])*Sum[\\[Beta]^(t - i), {i, 1, t}]"},
  {"id": "D1.E2", "op": "eval", "tex": "(1-\\beta)\\sum_{k=0}^{t-1}\\beta^{k}", "expect": "(1 - \\[Beta])*Sum[\\[Beta]^k, {k, 0, t - 1}]"},
  {"id": "D1.E3", "op": "eval", "tex": "(1-\\beta)\\frac{1-\\beta^t}{1-\\beta}", "expect": "(1 - \\[Beta])*((1 - \\[Beta]^t)/(1 - \\[Beta]))"},
  {"id": "D1.E4", "op": "eval", "tex": "1-\\beta^t", "expect": "1 - \\[Beta]^t"},
  {"id": "D1.S1", "op": "check", "tex": "(1-\\beta)\\sum_{i=1}^{t}\\beta^{t-i} = (1-\\beta)\\sum_{k=0}^{t-1}\\beta^{k}", "expect": "(1 - \\[Beta])*Sum[\\[Beta]^(t - i), {i, 1, t}] == (1 - \\[Beta])*Sum[\\[Beta]^k, {k, 0, t - 1}]", "state": "true"},
  {"id": "D1.S2", "op": "check", "tex": "(1-\\beta)\\sum_{k=0}^{t-1}\\beta^{k} = (1-\\beta)\\frac{1-\\beta^t}{1-\\beta}", "expect": "(1 - \\[Beta])*Sum[\\[Beta]^k, {k, 0, t - 1}] == (1 - \\[Beta])*((1 - \\[Beta]^t)/(1 - \\[Beta]))", "state": "true"},
  {"id": "D1.S3", "op": "check", "tex": "(1-\\beta)\\frac{1-\\beta^t}{1-\\beta} = 1-\\beta^t", "expect": "(1 - \\[Beta])*((1 - \\[Beta]^t)/(1 - \\[Beta])) == 1 - \\[Beta]^t", "state": "true"},

  {"id": "D2.E1", "op": "eval", "tex": "\\int x e^{x} dx", "expect": "Integrate[x*E^x, x]"},
  {"id": "D2.E2", "op": "eval", "tex": "x e^{x} - \\int e^{x}\\,dx", "expect": "x*E^x - Integrate[E^x, x]"},
  {"id": "D2.E3", "op": "eval", "tex": "x e^{x} - e^{x}", "expect": "x*E^x - E^x"},
  {"id": "D2.E4", "op": "eval", "tex": "(x-1)e^{x}", "expect": "(x - 1)*E^x"},
  {"id": "D2.S1", "op": "check", "tex": "\\int x e^{x} dx = x e^{x} - \\int e^{x}\\,dx", "expect": "Integrate[x*E^x, x] == x*E^x - Integrate[E^x, x]", "state": "true"},
  {"id": "D2.S2", "op": "check", "tex": "x e^{x} - \\int e^{x}\\,dx = x e^{x} - e^{x}", "expect": "x*E^x - Integrate[E^x, x] == x*E^x - E^x", "state": "true"},
  {"id": "D2.S3", "op": "check", "tex": "x e^{x} - e^{x} = (x-1)e^{x}", "expect": "x*E^x - E^x == (x - 1)*E^x", "state": "true"},

  {"id": "D3.E1", "op": "solve", "tex": "\\frac{dy}{dx} = -ky", "expect": "Derivative[1][y][x] == -k*y[x]"},
  {"id": "D3.E2", "op": "solve", "tex": "y'(x) = -k\\, y(x)", "expect": "Derivative[1][y][x] == -k*y[x]"},
  {"id": "D3.E3", "op": "eval", "tex": "\\int \\frac{1}{y}\\,dy", "expect": "Integrate[1/y, y]"},
  {"id": "D3.E4", "op": "eval", "tex": "\\int -k\\,dx", "expect": "Integrate[-k, x]"},
  {"id": "D3.E5", "op": "eval", "tex": "\\frac{d}{dx}\\left(C\\mathrm{e}^{-kx}\\right)", "expect": "D[C*E^(-k*x), x]"},
  {"id": "D3.S1", "op": "check", "tex": "\\int \\frac{1}{y}\\,dy = \\ln(y)", "expect": "Integrate[1/y, y] == Log[y]", "state": "true"},
  {"id": "D3.S2", "op": "check", "tex": "\\int -k\\,dx = -kx", "expect": "Integrate[-k, x] == -k*x", "state": "true"},
  {"id": "D3.S3", "op": "check", "tex": "\\frac{d}{dx}\\left(C\\mathrm{e}^{-kx}\\right) = -kC\\mathrm{e}^{-kx}", "expect": "D[C*E^(-k*x), x] == -k*C*E^(-k*x)", "state": "true"},
  {"id": "D3.S4", "op": "check", "tex": "-kC\\mathrm{e}^{-kx} = -k\\left(C\\mathrm{e}^{-kx}\\right)", "expect": "-k*C*E^(-k*x) == -k*(C*E^(-k*x))", "state": "true"},

  {"id": "D4.E1", "op": "eval", "tex": "\\frac{n^2+1}{2n^2-n}", "expect": "(n^2 + 1)/(2*n^2 - n)"},
  {"id": "D4.E2", "op": "eval", "tex": "\\lim_{n\\to\\infty}\\frac{1+\\frac{1}{n^2}}{2-\\frac{1}{n}}", "expect": "Limit[(1 + 1/n^2)/(2 - 1/n), n -> Infinity]"},
  {"id": "D4.E3", "op": "eval", "tex": "\\lim_{n\\to\\infty}\\left(1+\\frac{1}{n}\\right)^{n}", "expect": "Limit[(1 + 1/n)^n, n -> Infinity]"},
  {"id": "D4.S1", "op": "check", "tex": "\\frac{n^2+1}{2n^2-n} = \\frac{1+\\frac{1}{n^2}}{2-\\frac{1}{n}}", "expect": "(n^2 + 1)/(2*n^2 - n) == (1 + 1/n^2)/(2 - 1/n)", "state": "true"},
  {"id": "D4.S2", "op": "check", "tex": "\\frac{1+\\frac{1}{n^2}}{2-\\frac{1}{n}} = \\frac{1+\\frac{1}{n^2}}{2+\\frac{1}{n}}", "expect": "(1 + 1/n^2)/(2 - 1/n) == (1 + 1/n^2)/(2 + 1/n)", "state": "differs"},
  {"id": "D4.S3", "op": "check", "tex": "\\lim_{n\\to\\infty}\\frac{1+\\frac{1}{n^2}}{2-\\frac{1}{n}} = \\frac{1}{2}", "expect": "Limit[(1 + 1/n^2)/(2 - 1/n), n -> Infinity] == 1/2", "state": "true"},
  {"id": "D4.S4", "op": "check", "tex": "\\lim_{n\\to\\infty}\\left(1+\\frac{1}{n}\\right)^{n} = \\mathrm{e}", "expect": "Limit[(1 + 1/n)^n, n -> Infinity] == E", "state": "true"}
]
```
