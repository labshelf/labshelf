// Writes a deterministic ~200-entry .bib and two LaTeX documents that stress biber's name, sorting and inheritance code.
// Usage: node make-fixtures.cjs <outDir>; writes stress.bib, authoryear.tex and german.tex.
const fs = require("node:fs");
const path = require("node:path");

const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });

// Families mix LaTeX accent macros, raw UTF-8 and plain ASCII so recoding and Unicode sorting both run.
const families = [
  "M{\\\"u}ller", "Müller", "G{\\\"o}del", "Gödel", "{\\L}ukasiewicz", "Łukasiewicz", "Dvo{\\v{r}}{\\'a}k", "Dvořák",
  "{\\AA}ngstr{\\\"o}m", "Ångström", "{\\c{C}}elik", "Çelik", "Stra{\\ss}e", "Straße", "Smith", "Smith", "Jones",
  "Brown", "{\\O}stergaard", "Østergaard", "{\\'E}tienne", "Žižek", "van der Berg", "de la Cruz", "O'Neil",
];
const givens = ["John", "Jane", "J.", "Jürgen", "J{\\\"u}rgen", "Ana María", "Zoë", "Ole", "Émile", "Péter"];
const pick = (list, i) => list[i % list.length];
const entries = [];

entries.push(`@xdata{xd:springer, publisher = {Springer}, location = {Berlin and Heidelberg}}`);
entries.push(`@xdata{xd:mit, publisher = {MIT Press}, location = {Cambridge, MA}}`);
for (let p = 0; p < 6; p++) {
  entries.push(`@proceedings{proc${p},
  editor = {${pick(families, p + 3)}, ${pick(givens, p)} and ${pick(families, p + 9)}, ${pick(givens, p + 4)}},
  title = {Proceedings of the ${p + 10}th Workshop on {\\"U}bersetzung und Sprache},
  booktitle = {Proceedings of the ${p + 10}th Workshop on {\\"U}bersetzung und Sprache},
  date = {${2010 + p}-0${(p % 9) + 1}},
  xdata = {${p % 2 ? "xd:mit" : "xd:springer"}}
}`);
}
for (let i = 0; i < 190; i++) {
  const a1 = `${pick(families, i)}, ${pick(givens, i * 7)}`;
  const a2 = `${pick(families, i * 3 + 1)}, ${pick(givens, i + 2)}`;
  const authors = i % 9 === 0 ? `${a1} and ${a2} and ${pick(families, i + 5)}, ${pick(givens, i + 1)} and others`
    : i % 4 === 0 ? `${a1} and ${a2}` : a1;
  // Few distinct years per author so extradate a/b/c labels appear.
  const year = 2000 + (i % 5);
  const title = `${["On", "Über", "Sur", "A Note on", "Toward"][i % 5]} the ${["Theory", "Practice", "Æsthetics", "Économie", "Größe"][i % 5]} of Item ${i}`;
  if (i % 10 === 3) {
    entries.push(`@inproceedings{e${i},
  author = {${authors}},
  title = {${title}},
  crossref = {proc${i % 6}},
  pages = {${i}--${i + 12}}
}`);
  } else if (i % 10 === 7) {
    entries.push(`@book{e${i},
  author = {${authors}},
  title = {${title}},
  date = {${year}},
  xdata = {${i % 20 === 7 ? "xd:springer" : "xd:mit"}},
  isbn = {978-3-16-148410-0},
  edition = {${(i % 3) + 2}}
}`);
  } else if (i % 10 === 9) {
    entries.push(`@online{e${i},
  author = {{World Health Organization}},
  title = {${title}},
  date = {${year}-03-1${i % 9}T10:3${i % 6}:00+02:00},
  url = {https://example.org/item/${i}},
  urldate = {2024-0${(i % 9) + 1}-15}
}`);
  } else {
    entries.push(`@article{e${i},
  author = {${authors}},
  title = {${title}},
  journaltitle = {Zeitschrift f{\\"u}r ${["Physik", "Mathematik", "Linguistik"][i % 3]}},
  date = {${year}${i % 6 === 0 ? `-0${(i % 9) + 1}/${year + 1}` : ""}},
  volume = {${i % 30}},
  number = {${(i % 4) + 1}},
  pages = {${i * 3}--${i * 3 + 9}},
  doi = {10.1000/xyz${i}}${i % 11 === 0 ? `,\n  editor = {${a2}},\n  translator = {${pick(families, i + 4)}, ${pick(givens, i + 3)}}` : ""}
}`);
  }
}
// Long lists that share leading authors and differ later, so uniquelist has to extend them.
for (let j = 0; j < 6; j++) {
  entries.push(`@article{ul${j},
  author = {Smith, John and Gödel, Kurt and ${pick(families, j + 2)}, ${pick(givens, j)} and Jones, Ann and Brown, Bob},
  title = {Shared Lists ${j}},
  journaltitle = {Acta},
  date = {2001}
}`);
}
fs.writeFileSync(path.join(out, "stress.bib"), entries.join("\n\n") + "\n");

const doc = (preamble) => `\\documentclass{article}
\\usepackage[T1]{fontenc}
\\usepackage[utf8]{inputenc}
${preamble}
\\addbibresource{stress.bib}
\\begin{document}
\\nocite{*}
\\printbibliography
\\end{document}
`;
fs.writeFileSync(path.join(out, "authoryear.tex"),
  doc("\\usepackage[backend=biber,style=authoryear,uniquename=full,uniquelist=true,sorting=nyt]{biblatex}"));
fs.writeFileSync(path.join(out, "german.tex"),
  doc("\\usepackage[ngerman]{babel}\n\\usepackage[backend=biber,sortlocale=de_DE]{biblatex}"));
