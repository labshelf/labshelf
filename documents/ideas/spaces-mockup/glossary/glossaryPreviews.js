// Previews the Glossary where it is used: underlined terms with a hover card in a paper, and macro completion and hover in a draft. Mockup only.
function hitCard(g) {
  const meanings = g.conflict ?? [g];
  return `<span class="gl-pop" role="tooltip"><span class="gl-pop-not">${g.notation}</span>${meanings.map((m) =>
    `<span class="gl-pop-def"><b>${m.name}</b> · ${m.def}</span><span class="gl-pop-src">${esc(paperCite(m.source.paper))}, p. ${m.source.page}</span>`).join("")}</span>`;
}

const hit = (s, id, text) => {
  const g = GLOSSARY[s.id].entries.find((x) => x.id === id);
  return `<span class="gl-hit" tabindex="0">${text}${hitCard(g)}</span>`;
};

const PREVIEWS = {
  research: {
    paper: "SAM · p. 3",
    passage: (s) => `<p>Rather than minimizing the training loss alone, ${hit(s, "sam", "SAM")} seeks weights whose whole neighbourhood of radius ${hit(s, "rho", "<i>ρ</i>")}
      has a uniformly low loss. A small Hessian eigenvalue ${hit(s, "lambda", "<i>λ</i>")} marks such a flat region.</p>`,
    file: "method.tex",
    lines: [["41", 'We train with <span class="tx-cmd gl-ed-hover">\\SAM</span> at radius <span class="tx-cmd">\\rhosam</span> = 0.05'], ["42", 'and report the <span class="tx-cmd">\\sh</span><span class="caret"></span>']],
    hover: "<b>SAM</b> Sharpness-Aware Minimization<span>SAM p. 1 · from labshelf-glossary.tex</span>",
    complete: [["\\sharpness", "λ<sub>max</sub>", "sharpness · Glossary"], ["\\sharp", "♯", "LaTeX"], ["\\shortmid", "∣", "amssymb"]],
  },
  course: {
    paper: "Optimization Methods for Large-Scale ML · p. 12",
    passage: (s) => `<p>With a fixed stepsize ${hit(s, "eta", "<i>η</i>")} the iterates reach a neighbourhood of the solution. Adam rescales the step with decay rates
      ${hit(s, "beta", "<i>β</i><sub>1</sub>, <i>β</i><sub>2</sub>")}, and AdamW adds a decay ${hit(s, "lambda-c", "<i>λ</i>")} outside it.</p>`,
    file: "experiments.tex",
    lines: [["18", 'Both runs use <span class="tx-cmd gl-ed-hover">\\lr</span> = 10<sup>-3</sup> and'], ["19", '<span class="tx-cmd">\\be</span><span class="caret"></span>']],
    hover: "<b>η</b> learning rate<span>Bottou et al. p. 12 · from labshelf-glossary.tex</span>",
    complete: [["\\betaone", "β<sub>1</sub>", "moment decay rate · Glossary"], ["\\beta", "β", "LaTeX"], ["\\because", "∵", "amssymb"]],
  },
};

function glossaryPreviews(s) {
  const p = PREVIEWS[s.id];
  if (!p) return "";
  const [first, second] = p.lines;
  const line = ([n, html]) => `<div class="gl-ed-line"><span class="ln">${n}</span><span>${html}</span></div>`;
  return `<h2 class="gl-side-title">In a paper · ${p.paper}</h2>
    <div class="gl-sheet" data-pdf-theme="light">${p.passage(s)}<p class="gl-sheet-foot">Underlined: terms of this Space's Glossary. Hover or focus one.</p></div>
    <h2 class="gl-side-title">In a draft · ${p.file}</h2>
    <div class="gl-editor">${line(first)}<div class="gl-ed-card">${p.hover}</div>${line(second)}
      <div class="gl-complete" role="listbox" aria-label="Completions">${p.complete.map(([cmd, not, desc], i) =>
        `<div class="gl-c-item${i === 0 ? " on" : ""}" role="option" aria-selected="${i === 0}"><span class="tx-cmd">${cmd}</span><span class="gl-c-not">${not}</span><span class="gl-c-desc">${desc}</span></div>`).join("")}</div></div>`;
}
