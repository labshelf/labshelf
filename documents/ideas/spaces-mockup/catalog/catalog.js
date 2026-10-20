// Presents a searchable overview of Spaces with reading progress and upcoming work.
const CATALOG = { query: "", filter: "all" };

function catalogRow(s) {
  const papers = [...new Set(spacePapers(s).map((p) => p.id))];
  const done = papers.filter((id) => PAPERS[id].status === "done").length;
  const notes = NOTES.filter((n) => n.spaces.includes(s.id)).length;
  const next = s.dates.find((d) => !d.done && d.kind === "item") ?? s.dates.find((d) => d.kind === "deadline");
  return `<article class="catalog-row">
    <div class="catalog-main"><button class="catalog-title" data-act="catalog-open" data-id="${s.id}">${icon("space")}${esc(s.name)}</button>
      <p>${esc(s.purpose || "A personal place to read, collect ideas and explore.")}</p>
      <div class="catalog-links"><button data-act="catalog-open" data-id="${s.id}" data-view="papers">${papers.length} papers</button>
        <button data-act="catalog-open" data-id="${s.id}" data-view="notes">${notes} notes</button>
        <button data-act="catalog-open" data-id="${s.id}" data-view="discussions">${discussionTopics(s).filter((t) => !t.resolved).length} open topics</button>
        <span>${s.projects.length} ${s.projects.length === 1 ? "project" : "projects"}</span></div></div>
    <div class="catalog-reading">${arc(done, papers.length)}<span>${done} / ${papers.length} Done</span></div>
    <div class="catalog-next">${next ? `<span>${esc(next.day)}</span><span>${esc(next.text)}</span>` : '<span>No upcoming dates</span>'}</div>
    <div class="catalog-members"><span>${s.members.length > 1 ? "Shared" : "Personal"}</span>
      <div>${s.members.map(([who]) => avatar(who)).join("")}</div></div>
  </article>`;
}

function renderAllSpaces() {
  const query = CATALOG.query.trim().toLowerCase();
  const spaces = SPACES.filter((s) => `${s.name} ${s.purpose}`.toLowerCase().includes(query)
    && (CATALOG.filter === "all" || (s.members.length > 1 ? "shared" : "personal") === CATALOG.filter));
  return `<div class="sp catalog"><header class="sp-head"><div class="sp-title"><h1 class="sp-name">All Spaces</h1>
    <p class="sp-purpose">Keep your reading, notes and writing together.</p></div>
    <button class="ls-btn ls-btn-primary" data-act="toast" data-msg="Creates a Space with a name and an optional purpose.">${icon("plus")}New Space</button></header>
    <div class="catalog-toolbar"><label class="catalog-search">${icon("search")}<input id="space-search" type="search" placeholder="Search Spaces" aria-label="Search Spaces" value="${esc(CATALOG.query)}"></label>
      <div class="catalog-filters" role="group" aria-label="Filter Spaces">${[["all", "All"], ["personal", "Personal"], ["shared", "Shared"]].map(([id, label]) =>
        `<button class="ls-btn ${CATALOG.filter === id ? "ls-button-soft" : "ls-btn-ghost"}" data-act="catalog-filter" data-filter="${id}" aria-pressed="${CATALOG.filter === id}">${label}</button>`).join("")}</div></div>
    <div class="catalog-columns" aria-hidden="true"><span>${spaces.length} Spaces</span><span>Reading</span><span>Up next</span><span>Members</span></div>
    <div>${spaces.map(catalogRow).join("") || emptyState("No matching Spaces.", "Try another name or filter.")}</div>
    <p class="catalog-hint">Papers stay in your Library. Spaces bring them together with notes, projects and people.</p>${renderIdentityPicker()}</div>`;
}

ACTIONS["catalog-open"] = (el) => openSpace(el.dataset.id, el.dataset.view || "overview");
ACTIONS["catalog-filter"] = (el) => { CATALOG.filter = el.dataset.filter; render(); };
document.addEventListener("input", (e) => {
  if (e.target.id !== "space-search") return;
  CATALOG.query = e.target.value;
  render();
});
