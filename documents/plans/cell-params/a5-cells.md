# A5: cells for the hand check

Paste these sections into the Adam test note (`~/Documents/LabShelf Teste/.research/papers/kingma2015adam/notes.qmd`), inside the item, before its closing `:::`. Section 7 of the note (the Mathematica `Manipulate`) is already there and needs no change.

````markdown
### 12. Python: slider para beta e lr

```{python}
#| param: beta = slider(0.5, 0.999, 0.9)
#| param: lr = slider(0.001, 0.1, 0.02, log)
import numpy as np
import matplotlib.pyplot as plt

def grad(p):
    x, y = p
    return np.array([-2*(1 - x) - 400*x*(y - x**2), 200*(y - x**2)])

def rosen(p):
    x, y = p
    return (1 - x)**2 + 100*(y - x**2)**2

p = np.array([-1.5, 2.0]); m = np.zeros(2); v = np.zeros(2)
perdas = []
for k in range(1, 1501):
    g = grad(p)
    m = beta*m + (1 - beta)*g
    v = 0.999*v + (1 - 0.999)*g**2
    p = p - lr*(m/(1 - beta**k)) / (np.sqrt(v/(1 - 0.999**k)) + 1e-8)
    perdas.append(rosen(p))

fig, ax = plt.subplots(figsize=(6, 3.5))
ax.semilogy(perdas)
ax.set_xlabel("passo"); ax.set_ylabel("f(x, y)")
ax.set_title(f"beta = {beta:.3f}, lr = {lr:.3f}")
fig
```

### 13. R: slider para o grau do polinômio

```{r}
#| param: grau = slider(1, 8, 2, step = 1)
ajuste <- lm(mpg ~ poly(wt, grau), data = mtcars)
plot(mtcars$wt, mtcars$mpg, pch = 19, col = "steelblue",
     xlab = "peso (1000 lb)", ylab = "milhas por galão",
     main = paste("Polinômio de grau", grau))
xs <- seq(min(mtcars$wt), max(mtcars$wt), length.out = 200)
lines(xs, predict(ajuste, data.frame(wt = xs)), col = "firebrick", lwd = 2)
```
````

## What to check (A5), in VS Code and in the browser

1. Open the note. Each of cells 7, 12 and 13 shows a strip of sliders between the code and the output (cell 7 draws `b` from its `Manipulate`).
2. Drag each slider: the plot updates while dragging, and the strip shows a busy state while a preview runs.
3. Release: the param line takes the new value (cell 7 gains a `#| param: b = …` line on its first release) and the output is written with a `params` attribute.
4. Close and reopen the note: the sliders keep the chosen values, and the outputs are not marked out of date.
