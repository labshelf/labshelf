// Renders the Glossary tab: Space entries with their source, conflicting meanings, suggestions to review, previews and the generated file. Mockup only.
const GL = { generate: false };

const sourceLink = (src) => `<button class="gl-src-link" data-act="toast" data-msg="Opens ${esc(paperShort(src.paper))} at p. ${src.page} with the passage highlighted." title="${esc(PAPERS[src.paper].title)}">${esc(paperCite(src.paper))}, p. ${src.page}</button>`;

function meaning(m) {
  return `<div class="gl-meaning"><div class="gl-term-head"><span class="gl-term-name">${m.name}</span><span class="gl-macro">${m.macro}</span></div>
    <div class="gl-def">${m.def}</div><div class="gl-src">${sourceLink(m.source)}<span class="gl-quote">${esc(m.source.quote)}</span></div></div>`;
}

function entryRow(g) {
  if (g.conflict) {
    return `<li class="gl-term conflict"><div class="gl-term-not">${g.notation}</div><div class="gl-term-body">
      <div class="gl-flag">${icon("warning")}Two papers of this Space use ${g.notation} for different things. Each meaning keeps its own macro.</div>
      ${g.conflict.map(meaning).join("")}</div></li>`;
  }
  return `<li class="gl-term"><div class="gl-term-not">${g.notation}</div><div class="gl-term-body">${meaning(g)}
    <div class="gl-found">Found ${g.found}</div></div></li>`;
}

function suggestionRow(g) {
  return `<li class="gl-sug"><div class="gl-term-not">${g.notation}</div><div class="gl-term-body">
    <div class="gl-term-head"><span class="gl-term-name">${esc(g.name)}</span><span class="gl-how">${g.how}</span></div>
    <div class="gl-src">${sourceLink(g.source)}<span class="gl-quote">${esc(g.source.quote)}</span></div></div>
    <div class="gl-sug-acts"><button class="ls-btn ls-button-soft" data-act="gl-accept" data-id="${g.id}">Accept</button>
      <button class="ls-btn ls-btn-ghost" data-act="toast" data-msg="Opens the entry with the suggestion filled in, to correct before it enters the Glossary.">Edit</button>
      <button class="ls-icon-btn" data-act="gl-dismiss" data-id="${g.id}" title="Dismiss" aria-label="Dismiss">${icon("x")}</button></div></li>`;
}

function generated(entries) {
  const flat = entries.flatMap((g) => g.conflict ?? [g]);
  const lines = flat.map((g) => `\\newcommand{${g.macro}}{${g.expands}} % ${g.name}`).join("\n");
  return `<pre class="gl-tex"><span class="c">% Generated from this Space's Glossary. Edit the terms in LabShelf.</span>\n${esc(lines)}</pre>`;
}

function renderGlossary(s) {
  const { entries, suggested } = GLOSSARY[s.id];
  if (!entries.length && !suggested.length) {
    return emptyState("No terms yet.", "LabShelf suggests acronyms and definitions from this Space's papers once they have text. Select a term in a paper to add it yourself.");
  }
  const sug = suggested.length ? `<section class="gl-group"><h2 class="pp-group-head">Suggested<span class="tree-count">${suggested.length}</span></h2>
    <p class="muted gl-group-hint">Found in this Space's papers. Nothing enters the Glossary until you accept it.</p><ul class="gl-list">${suggested.map(suggestionRow).join("")}</ul></section>` : "";
  const project = s.projects[0];
  return `<div class="pp-bar"><span class="muted">Terms and symbols of this Space. They are underlined in its papers and complete as macros in its projects.</span>
      <button class="ls-btn ls-btn-primary" data-act="toast" data-msg="Select a passage in a paper, or type a term, notation and definition.">${icon("plus")}Add term</button></div>
    <div class="gl-grid"><div class="gl-main">${sug}<section class="gl-group"><h2 class="pp-group-head">Glossary<span class="tree-count">${entries.length}</span></h2>
      <ul class="gl-list">${entries.map(entryRow).join("")}</ul></section></div>
      <aside class="gl-side">${glossaryPreviews(s)}
        <label class="ls-checkbox gl-gen"><input type="checkbox" data-act="gl-gen" ${GL.generate ? "checked" : ""}>Generate <span class="mono">labshelf-glossary.tex</span>${project ? ` in ${project}` : ""}</label>
        ${GL.generate ? generated(entries) : `<div class="muted gl-gen-hint">Writes one macro per term and a list of symbols the project can include.</div>`}</aside></div>`;
}

function takeSuggestion(id) {
  const g = GLOSSARY[activeTab().id];
  const found = g.suggested.find((x) => x.id === id);
  g.suggested = g.suggested.filter((x) => x !== found);
  return { g, found };
}

ACTIONS["gl-accept"] = (el) => {
  const { g, found } = takeSuggestion(el.dataset.id);
  const macro = `\\${found.notation.replace(/[^A-Za-z]/g, "") || "eps"}`;
  g.entries.push({ ...found, macro, expands: found.notation, def: found.name[0].toUpperCase() + found.name.slice(1) + ".", found: "in 1 paper" });
  CoreUI.toast(`${found.notation} is in the Glossary as ${macro}.`, "ok");
  render();
};

ACTIONS["gl-dismiss"] = (el) => { const { found } = takeSuggestion(el.dataset.id); CoreUI.toast(`Dismissed ${found.notation}. It is not suggested again in this Space.`); render(); };
ACTIONS["gl-gen"] = (el) => { GL.generate = el.checked; render(); };
