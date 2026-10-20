// Renders the Glossary tab: Space terms with their source and matches, PDF and editor previews, and the generated .tex file. Mockup only.
const GL = { adding: false, generate: false };

function renderGlossary(view) {
  view.innerHTML = `
  <div class="space">${spaceHeader("glossary")}
    <div class="gl-bar"><span class="gl-intro">Terms you define while reading. LabShelf underlines them in this Space's papers and completes their macros in your drafts.</span>
      <button class="ls-btn ls-btn-primary md" data-act="gl-add"><span data-i="plus"></span>Add term</button></div>
    ${GL.adding ? addForm() : ""}
    <div class="gl-grid">
      <div class="gl-terms">${STATE.glossary.map(termRow).join("")}</div>
      <div class="gl-side">
        <div class="gl-side-title">In a paper · CQL p. 3</div>${pdfPreview()}
        <div class="gl-side-title">In a draft · method.tex</div>${editorPreview()}
        <label class="ls-checkbox gl-gen"><input type="checkbox" data-act="gl-gen" ${GL.generate ? "checked" : ""}>Generate <span class="mono">labshelf-glossary.tex</span></label>
        ${GL.generate ? generated() : `<div class="gl-gen-hint">Writes one \\newcommand per term into the project, plus a List of symbols you can \\input.</div>`}
      </div>
    </div>
  </div>`;
}

function termRow(g) {
  const variant = g.occ.find((o) => o.variant);
  return `<div class="gl-term" data-term="${g.id}">
    <div class="gl-term-not">${g.notation}</div>
    <div class="gl-term-body">
      <div class="gl-term-head"><span class="gl-term-name">${g.name}</span><span class="gl-macro">${g.macro}</span></div>
      <div class="gl-def">${g.def}</div>
      <div class="gl-src"><span class="gl-k">Defined in</span><button class="src-link" data-act="toast" data-msg="Opens ${paperName(g.source.paper)} at p. ${g.source.page} with the passage highlighted">${paperName(g.source.paper)} p. ${g.source.page}</button>
        <span class="gl-quote">${g.source.quote}</span></div>
      <div class="gl-src"><span class="gl-k">Matches</span>${g.variants.map((v) => `<span class="gl-var">${v}</span>`).join("")}</div>
      <div class="gl-src"><span class="gl-k">Found</span>${g.occ.map((o) => `<span class="gl-occ ${o.variant ? "variant" : ""}">${paperName(o.paper)} <b>${o.n}</b> <span>${o.pages}</span></span>`).join("")}</div>
      ${variant ? `<div class="gl-flag"><span data-i="warning"></span>${paperName(variant.paper)} ${variant.pages}: matched by variant “${variant.variant}” — the text layer splits the subscript, so check it by eye.</div>` : ""}
    </div>
  </div>`;
}

const hit = (id, text, extra = "") => {
  const g = STATE.glossary.find((x) => x.id === id);
  return `<span class="gl-hit ${extra}" data-g="${id}" tabindex="0">${text}<span class="gl-pop" role="tooltip"><span class="gl-pop-not">${g.notation}</span> <b>${g.name}</b>
    <span class="gl-pop-def">${g.def}</span><span class="gl-pop-src">Defined in ${paperName(g.source.paper)} p. ${g.source.page} · Thesis — chapter 3 Glossary</span></span></span>`;
};

function pdfPreview() {
  return `<div class="gl-sheet"><div class="gl-sheet-head">3 &nbsp; The Conservative Q-Learning framework</div>
    <p>We aim to learn a conservative estimate ${hit("g4", "Q̂", "math")} of the value of a policy, using only a static dataset ${hit("g3", "𝒟", "math")}
    collected by the behaviour policy ${hit("g2", "π<sub>β</sub>", "math")}. Minimising Q-values under a chosen distribution, weighted by
    ${hit("g1", "α", "math open")}, yields a lower bound; on the ${hit("g5", "medium-replay", "end")} datasets the bound is the tightest.</p>
    <p class="gl-sheet-foot">Underlined: terms from the Space Glossary. Hover one for its definition.</p></div>`;
}

function editorPreview() {
  return `<div class="gl-editor"><div class="gl-ed-line"><span class="ln">142</span><span>This yields an estimate <span class="tx-cmd gl-ed-hover">\\Qhat</span> that lower-bounds</span></div>
    <div class="gl-ed-card"><b class="gl-c-not">Q̂</b> learned Q-function<span>Defined in CQL p. 3 · from labshelf-glossary.tex</span></div>
    <div class="gl-ed-line"><span class="ln">143</span><span>the value of policies that stay close to <span class="tx-cmd">\\pib</span><span class="caret"></span></span></div>
    <div class="gl-complete">
      <div class="gl-c-item on"><span class="tx-cmd">\\pib</span><span class="gl-c-not">π<sub>β</sub></span><span class="gl-c-desc">behaviour policy · Glossary</span></div>
      <div class="gl-c-item"><span class="tx-cmd">\\pi</span><span class="gl-c-not">π</span><span class="gl-c-desc">LaTeX</span></div>
      <div class="gl-c-item"><span class="tx-cmd">\\pitchfork</span><span class="gl-c-not">⋔</span><span class="gl-c-desc">amssymb</span></div>
    </div>
    <div class="gl-ed-line"><span class="ln">144</span><span>that collected <span class="tx-cmd">\\data</span>.</span></div></div>`;
}

function generated() {
  const lines = STATE.glossary.map((g) => `\\newcommand{${g.macro}}{${g.expands}} % ${g.name}`).join("\n");
  return `<pre class="gl-tex"><span class="c">% Generated from the Thesis — chapter 3 Glossary. Edit terms in LabShelf.</span>
${lines}</pre>
  <div class="gl-sheet gl-symbols"><div class="gl-sheet-head">List of symbols</div>
    ${STATE.glossary.map((g) => `<div class="gl-sym"><span class="gl-sym-not">${g.notation}</span><span>${g.def.split(";")[0].replace(/\.$/, "")}</span><span class="gl-sym-p">${paperName(g.source.paper)}, p. ${g.source.page}</span></div>`).join("")}</div>`;
}

function addForm() {
  return `<div class="gl-add">
    <div class="gl-add-note"><span data-i="file-text"></span>From your selection in <b>IQL p. 4</b>: “…the expectile τ controls how close the value is to the maximum over in-data actions.”</div>
    <div class="gl-add-grid">
      <label>Term<input class="ls-input" id="gl-term" value="τ"></label>
      <label>Name<input class="ls-input" id="gl-name" value="expectile"></label>
      <label>Macro<input class="ls-input mono" id="gl-macro" value="\\tauexp"></label>
      <label>Variants<input class="ls-input" id="gl-vars" value="tau, expectile τ"></label>
      <label class="wide">Definition<input class="ls-input" id="gl-def" value="Expectile used by IQL to approximate the maximum Q-value over actions in the data."></label>
    </div>
    <div class="gl-add-foot"><span class="hint">Source: IQL p. 4 · the selected passage is kept with the term</span>
      <button class="ls-btn ls-btn-ghost md" data-act="gl-cancel">Cancel</button><button class="ls-btn ls-btn-primary md" data-act="gl-save">Add to Glossary</button></div>
  </div>`;
}

function glossaryAction(act, el) {
  if (act === "gl-add") { GL.adding = !GL.adding; return render(); }
  if (act === "gl-cancel") { GL.adding = false; return render(); }
  if (act === "gl-gen") { GL.generate = el.checked; return render(); }
  if (act === "gl-save") {
    const v = (id) => document.getElementById(id).value.trim();
    STATE.glossary.push({ id: `g${nextId++}`, notation: v("gl-term"), name: v("gl-name"), macro: v("gl-macro"), expands: "\\tau", def: v("gl-def"),
      source: { paper: "IQL", page: 4, quote: "…the expectile τ controls how close the value is to the maximum over in-data actions." },
      variants: v("gl-vars").split(",").map((s) => s.trim()).filter(Boolean), occ: [{ paper: "IQL", n: 7, pages: "p. 4–6" }], added: "18 Oct" });
    GL.adding = false;
    toast(`Added ${v("gl-term")} · found 7 times in IQL · \\tauexp completes in your drafts`);
    return render();
  }
}
