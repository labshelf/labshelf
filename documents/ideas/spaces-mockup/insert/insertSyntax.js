// Writes an inserted item in the target's own syntax, LaTeX or Typst, behind a one-line provenance comment. Mockup only.
const MODE_NOTE = { copy: " copy", follow: "", pin: " pin=2026-10-18" };

function latexLines(item) {
  switch (item.kind) {
    case "figure": return ["\\begin{figure}[t]", "  \\centering", `  \\includegraphics[width=\\linewidth]{labshelf/${item.file}}`, `  \\caption{${item.title}.}`, `  \\label{${item.label}}`, "\\end{figure}"];
    case "table": return ["\\begin{table}[t]", "  \\centering", "  \\begin{tabular}{lr}", "    Method & Test error (\\%) \\\\ \\hline",
      ...item.rows.map(([m, e]) => `    ${m} & ${e} \\\\`), "  \\end{tabular}", `  \\caption{${item.title}.}`, `  \\label{${item.label}}`, "\\end{table}"];
    case "quote": return ["\\begin{quote}", `  \`\`${item.title}'' \\cite[p.~${item.page}]{${item.cite}}`, "\\end{quote}"];
    case "citation": return [`\\cite{${item.cite}}`];
    default: return ["\\begin{lstlisting}[language=Python]", ...item.code, "\\end{lstlisting}"];
  }
}

function typstLines(item) {
  switch (item.kind) {
    case "figure": return [`#figure(image("labshelf/${item.file.replace(".pdf", ".svg")}"), caption: [${item.title}.]) <${item.label.replace(":", "-")}>`];
    case "table": return ["#table(columns: 2, [Method], [Test error (%)],", ...item.rows.map(([m, e]) => `  [${m.replace(/\$/g, "")}], [${e}],`), ")"];
    case "quote": return [`#quote(attribution: [@${item.cite}, p. ${item.page}])[${item.title}]`];
    case "citation": return [`@${item.cite}`];
    default: return ["```python", ...item.code, "```"];
  }
}

// Figures and tables carry their insert mode; quotes, citations and code always follow their source.
function insertLines(item, mode, format) {
  const comment = format === "typst" ? "//" : "%";
  const note = item.kind === "figure" || item.kind === "table" ? MODE_NOTE[mode] : "";
  return [`${comment} LabShelf: ${item.src}${note}`, ...(format === "typst" ? typstLines(item) : latexLines(item))];
}

// Colours commands and comments the way the editor's own grammar does, on escaped text.
function highlightLine(line) {
  const text = esc(line);
  if (/^\s*(%|\/\/)/.test(line)) return `<span class="tx-comment">${text}</span>`;
  return text.replace(/(\\[A-Za-z]+|#[a-z]+)/g, '<span class="tx-cmd">$1</span>');
}
