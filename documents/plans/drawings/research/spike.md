# Spike: stored form through pandoc and pdflatex (2026-11-01)

Input: `spike-pandoc.md`, a div `.labshelf-drawing` holding a `{=latex}` tikzpicture, a `{=html}` SVG and a `{=labshelf-drawing}` JSON fence, with `header-includes: \usepackage{tikz}`.

- `pandoc spike-pandoc.md -o t.pdf` (pandoc 3.12.1, TeX Live 2026 pdflatex) compiles. Arrows with `>=stealth`, `to[bend left=20]`, edge labels, point labels via `label=`, dashed lines and circles all draw with the base TikZ package and no library.
- LaTeX output keeps only the tikzpicture; the html and labshelf-drawing fences are dropped.
- HTML output keeps only the SVG; the latex and labshelf-drawing fences are dropped.
- Not checked: Quarto itself (not installed), whether Quarto's template loads TikZ, and `#fig-` cross-references around raw content.

## Second spike: TikZ or PNG (2026-11-01)

- Loading TikZ from the body fails: `\input{tikz.tex}` after `\begin{document}` gives "Can be used only in preamble".
- A guarded form works (`spike-guard.md`): a latex fence `\makeatletter\@ifundefined{tikzpicture}{\iftrue}{<tikzpicture>\iffalse}\makeatother`, then the Markdown PNG image, then a latex fence `\fi`. Without `\usepackage{tikz}` the PDF shows the PNG; with it, the TikZ and no PNG. HTML shows the PNG.
- An image with a non-empty alt alone in a paragraph becomes a pandoc figure with a "Figure 1" caption; the stored image uses an empty alt and `fig-alt`.
