# Code listings test

Register `paper-latex` and `paper-typst` as writing projects. `analysis/` sits outside both, so links climb out with `../`.

- `paper-latex/main.tex` loads minted and starts with four listings: stale (residuals), fresh (square), both (energy, edited here and in the file) and missing (old_fit).
- Insert Code from the manuscript, or Insert into Manuscript from `analysis/fit.py` (cursor in `GrowthModel.predict`), `stats.R` (`bootstrap_mean`), `simulate.jl` (`Simulate.step!`) or `paper-latex/scripts/plot.m` (lines or whole file).
- Edit and save a function in `analysis/` and watch its listing get marked.
- Drop `\usepackage{minted}` to get lstlisting; `paper-typst/main.typ` gets raw blocks.
