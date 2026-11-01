---
header-includes: \usepackage{tikz}
---
Text before.

::: {#fig-tri .labshelf-drawing}
```{=latex}
\begin{tikzpicture}[x=0.5cm,y=0.5cm,>=stealth,line width=0.6pt]
\node[circle,fill,inner sep=1.2pt,label=below left:{$A$}] (a) at (0,0) {};
\node[circle,fill,inner sep=1.2pt,label=below right:{$B$}] (b) at (6,0) {};
\node (c) at (3,4) {$X \times Y$};
\draw[->] (a) -- node[below]{$f$} (b);
\draw[->,dashed] (c) to[bend left=20] node[above right]{$g$} (b);
\draw (a) circle (2);
\end{tikzpicture}
```

```{=html}
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>
```

```{=labshelf-drawing}
{"v":1,"items":[]}
```

A triangle.
:::

Text after.
