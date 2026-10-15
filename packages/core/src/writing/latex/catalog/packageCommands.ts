// Lists commands of common LaTeX packages: graphicx, hyperref, booktabs, xcolor, cleveref and geometry.
// Derived from LaTeX Workshop's package data; the MIT notice is in index.ts.
import type { LatexCatalogEntry } from "./latexCatalogEntry.js";

export const PACKAGE_COMMANDS: readonly LatexCatalogEntry[] = [
  { name: "includegraphics", snippet: "includegraphics[${2:width=\\\\linewidth}]{${1:file}}", detail: "Insert an image (graphicx)" },
  { name: "graphicspath", snippet: "graphicspath{{${1:figures/}}}", detail: "Image search folders (graphicx)" },
  { name: "scalebox", snippet: "scalebox{${1:scale}}{${2:text}}", detail: "Scale a box (graphicx)" },
  { name: "resizebox", snippet: "resizebox{${1:width}}{${2:height}}{${3:text}}", detail: "Resize a box (graphicx)" },
  { name: "rotatebox", snippet: "rotatebox{${1:angle}}{${2:text}}", detail: "Rotate a box (graphicx)" },
  { name: "href", snippet: "href{${1:url}}{${2:text}}", detail: "Hyperlink with text (hyperref)" },
  { name: "url", snippet: "url{${1:url}}", detail: "Typeset a URL (hyperref)" },
  { name: "hypersetup", snippet: "hypersetup{${1:options}}", detail: "Set hyperref options (hyperref)" },
  { name: "autoref", snippet: "autoref{${1:key}}", detail: "Reference with its type name (hyperref)" },
  { name: "hyperlink", snippet: "hyperlink{${1:name}}{${2:text}}", detail: "Link to a target (hyperref)" },
  { name: "hypertarget", snippet: "hypertarget{${1:name}}{${2:text}}", detail: "Link target (hyperref)" },
  { name: "texorpdfstring", snippet: "texorpdfstring{${1:tex}}{${2:pdf}}", detail: "Alternative text for PDF strings (hyperref)" },
  { name: "cref", snippet: "cref{${1:key}}", detail: "Smart reference (cleveref)" },
  { name: "Cref", snippet: "Cref{${1:key}}", detail: "Smart reference, capitalised (cleveref)" },
  { name: "toprule", snippet: "toprule", detail: "Top rule of a table (booktabs)" },
  { name: "midrule", snippet: "midrule", detail: "Middle rule of a table (booktabs)" },
  { name: "bottomrule", snippet: "bottomrule", detail: "Bottom rule of a table (booktabs)" },
  { name: "cmidrule", snippet: "cmidrule{${1:a-b}}", detail: "Partial rule of a table (booktabs)" },
  { name: "addlinespace", snippet: "addlinespace", detail: "Extra space between rows (booktabs)" },
  { name: "textcolor", snippet: "textcolor{${1:color}}{${2:text}}", detail: "Colored text (xcolor)" },
  { name: "color", snippet: "color{${1:color}}", detail: "Switch the text color (xcolor)" },
  { name: "colorbox", snippet: "colorbox{${1:color}}{${2:text}}", detail: "Text on a colored background (xcolor)" },
  { name: "definecolor", snippet: "definecolor{${1:name}}{${2:rgb}}{${3:0,0,0}}", detail: "Define a color (xcolor)" },
  { name: "geometry", snippet: "geometry{${1:margin=2.5cm}}", detail: "Page layout (geometry)" },
  { name: "theoremstyle", snippet: "theoremstyle{${1:plain}}", detail: "Style of the next theorems (amsthm)" },
];
