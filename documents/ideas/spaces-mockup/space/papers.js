// Renders the Papers tab: the Space's own folders of Library papers, with status, who added each one, other Spaces and missing PDFs. Mockup only.
const NEXT_STATUS = { unread: "reading", reading: "done", done: "unread" };

function paperRow(s, { id, by }) {
  const p = PAPERS[id];
  const shared = s.members.length > 1;
  const also = otherSpaces(id, s).map((o) => `<span class="pp-also" title="The same Library paper, referred to by another Space">${icon("space")}also in ${esc(o.name)}</span>`).join("");
  const focus = s.focus.includes(id);
  const pdf = p.noPdf
    ? `<div class="pp-nopdf">${icon("file-no-text")}<span>Metadata only: ${PEOPLE[by].name} did not share the PDF.</span>
        <button class="ls-btn ls-button-soft" data-act="toast" data-msg="Looks for an open PDF by DOI and arXiv id, then by title.">${icon("search")}Find PDF</button></div>` : "";
  return `<li class="pp-row${p.noPdf ? " nopdf" : ""}">
    <button class="pp-status" data-act="pp-status" data-id="${id}" title="${STATUS_LABEL[p.status]} · change status" aria-label="Status ${STATUS_LABEL[p.status]}, change">${statusMark(p.status)}</button>
    <div class="pp-main">
      <button class="pp-title" data-act="toast" data-msg="Opens ${esc(paperShort(id))} in the reader${p.noPdf ? " as metadata only" : ""}." title="${esc(p.title)}">${esc(p.title)}</button>
      <div class="pp-meta"><span>${esc(p.authors)} · ${p.year}</span>${shared ? `<span class="pp-by">${avatar(by)}added by ${PEOPLE[by].name}</span>` : ""}${also}</div>${pdf}
    </div>
    <div class="pp-acts">
      <button class="ls-icon-btn${focus ? " on" : ""}" data-act="pp-focus" data-id="${id}" aria-pressed="${focus}" title="${focus ? "Remove from Papers in focus" : "Add to Papers in focus"}" aria-label="In focus">${icon("target")}</button>
      <button class="ls-icon-btn" data-act="toast" data-msg="Removed from ${esc(s.name)}. The paper stays in the Library." title="Remove from Space" aria-label="Remove from Space">${icon("minus")}</button>
    </div></li>`;
}

function folderNav(s, current) {
  const item = (id, label, n) => `<button class="pp-folder${current === id ? " on" : ""}" ${current === id ? 'aria-current="true"' : ""} data-act="pp-folder" data-folder="${id ?? ""}">
    ${icon(id ? "folder" : "book-open")}<span class="pp-folder-name">${esc(label)}</span><span class="tree-count">${n}</span></button>`;
  return `<nav class="pp-folders" aria-label="Space folders">${item(null, "All papers", spacePapers(s).length)}${s.folders.map((f) => item(f.id, f.name, f.papers.length)).join("")}
    <button class="pp-folder pp-new" data-act="toast" data-msg="Creates a Space folder. It holds references only.">${icon("folder-plus")}<span class="pp-folder-name">New folder</span></button></nav>`;
}

function renderPapers(s) {
  const current = APP.folder[s.id] ?? null;
  const groups = s.folders.filter((f) => !current || f.id === current);
  const list = groups.map((f) => `<section class="pp-group"><h2 class="pp-group-head">${esc(f.name)}<span class="tree-count">${f.papers.length}</span></h2>
    <ul class="pp-list">${f.papers.map(([id, by]) => paperRow(s, { id, by })).join("")}</ul></section>`).join("");
  return `<div class="pp-bar"><span class="muted">Papers here are references to the Library: removing one from the Space never deletes it.</span>
      <button class="ls-btn ls-btn-primary" data-act="toast" data-msg="Adds Library papers, a DOI or an arXiv id to this Space.">${icon("plus")}Add papers</button></div>
    <div class="pp-grid">${folderNav(s, current)}<div class="pp-groups">${list}</div></div>`;
}

ACTIONS["pp-folder"] = (el) => { APP.folder[activeTab().id] = el.dataset.folder || null; render({ keepScroll: false }); };

ACTIONS["pp-status"] = (el) => {
  const p = PAPERS[el.dataset.id];
  p.status = NEXT_STATUS[p.status];
  refreshLibraryTree();
  CoreUI.toast(`${paperShort(el.dataset.id)} is ${STATUS_LABEL[p.status]} in the Library and in every Space. Goals count it.`);
  render();
};

ACTIONS["pp-focus"] = (el) => {
  const s = spaceById(activeTab().id);
  const id = el.dataset.id;
  s.focus = s.focus.includes(id) ? s.focus.filter((x) => x !== id) : [...s.focus, id];
  render();
};
