// Renders the Discover tab: a ranked feed scoped to the Space with its reasons, filters, arXiv alerts and Watch. Mockup only.
const DISC = { filter: {}, query: "" };
const DISC_FILTERS = [["all", "All"], ["gaps", "Gaps"], ["project", "For this project"], ["versions", "Later versions"]];
const DISC_ICON = { gaps: "link", project: "file-text", versions: "version", all: "compass" };

function discItem(d, i) {
  const open = `<button class="ls-btn ls-btn-ghost" data-act="toast" data-msg="Opens ${esc(d.title.split(":")[0])} in the Library.">Open</button>`;
  const lib = `<button class="ls-btn ls-btn-ghost" data-act="dc-triage" data-how="library" data-id="${d.id}">Add to Library</button>`;
  return `<li class="dc-item${d.owned ? " owned" : ""}"><span class="dc-rank">${i + 1}</span>
    <div class="dc-body"><div class="dc-title" title="${esc(d.title)}">${esc(d.title)}</div>
      <div class="dc-authors"><span>${esc(d.authors)} · ${d.year}</span>${d.owned ? `<span class="dc-owned">${icon("check")}In your Library</span>` : ""}</div>
      <div class="dc-why">${icon(DISC_ICON[d.kind])}${esc(d.why)}</div></div>
    <div class="dc-acts"><button class="ls-btn ls-button-soft" data-act="dc-triage" data-how="space" data-id="${d.id}">Add to Space</button>${d.owned ? open : lib}
      <button class="ls-icon-btn" data-act="dc-triage" data-how="dismiss" data-id="${d.id}" title="Dismiss" aria-label="Dismiss">${icon("x")}</button></div></li>`;
}

function alertsCard(s) {
  const a = ALERTS[s.id];
  if (!a) return `<section class="dc-card"><h2 class="dc-card-head">${icon("bell")}arXiv alerts</h2>
    ${emptyState("No alerts for this Space.", "Choose arXiv categories and keywords; the Space's papers and authors refine them.")}
    <button class="ls-btn ls-btn-ghost" data-act="toast" data-msg="Sets up arXiv alerts for this Space.">Set up alerts</button></section>`;
  const chips = (xs, cls) => xs.map((x) => `<span class="dc-tag ${cls}">${esc(x)}</span>`).join("");
  return `<section class="dc-card"><h2 class="dc-card-head">${icon("bell")}arXiv alerts</h2>
    <dl class="dc-dl"><dt>Categories</dt><dd>${chips(a.categories, "mono")}</dd><dt>Keywords</dt><dd>${chips(a.keywords, "")}</dd>
      <dt>Digest</dt><dd>Daily, at most ${a.cap} papers</dd><dt>Only when</dt><dd>it ${a.signal}</dd></dl>
    <div class="dc-meta">Last checked ${a.checked}. Checks run while an app is open; the browser extension checks on a timer.</div>
    <button class="ls-btn ls-btn-ghost" data-act="toast" data-msg="Edits the categories, keywords and daily cap of this Space's alerts.">${icon("edit")}Edit alerts</button></section>`;
}

function watchCard(s) {
  const n = spacePapers(s).length;
  return `<section class="dc-card"><h2 class="dc-card-head">${icon("eye")}Watch</h2><div class="dc-big">${n} papers</div>
    <ul class="dc-watch-list"><li>${icon("version")}later versions, such as a preprint that gets published</li><li>${icon("ban")}retractions and errata</li></ul>
    <div class="dc-meta">From OpenAlex, Semantic Scholar, Crossref and arXiv. Those services learn which papers you look up.</div>
    <button class="ls-btn ls-btn-ghost" data-act="toast" data-msg="Checking ${n} papers for later versions, retractions and errata.">${icon("refresh")}Check now</button></section>`;
}

function renderDiscover(s) {
  const all = DISCOVER[s.id];
  const filter = DISC.filter[s.id] ?? "all";
  const q = DISC.query.toLowerCase();
  const items = all.filter((d) => filter === "all" || d.kind === filter).filter((d) => !q || `${d.title} ${d.authors}`.toLowerCase().includes(q));
  const count = (id) => (id === "all" ? all.length : all.filter((d) => d.kind === id).length);
  const empty = all.length ? emptyState("Nothing matches.", "Clear the search or pick another filter.")
    : emptyState("No suggestions yet.", "Discover ranks papers from this Space's own papers, citations and authors. Add a few more papers to start the feed.");
  return `<div class="dc-grid"><div class="dc-main">
      <label class="ls-search dc-search">${icon("search")}<input id="dc-q" value="${esc(DISC.query)}" aria-label="Search the feed" placeholder="Search this Space's feed"></label>
      <div class="dc-chips" role="group" aria-label="Filter">${DISC_FILTERS.map(([id, label]) => `<button class="dc-chip${filter === id ? " on" : ""}" aria-pressed="${filter === id}" data-act="dc-filter" data-f="${id}">${label}<span class="dc-n">${count(id)}</span></button>`).join("")}</div>
      ${items.length ? `<ol class="dc-feed">${items.map(discItem).join("")}</ol>` : empty}
    </div><aside class="dc-side">${alertsCard(s)}${watchCard(s)}</aside></div>`;
}

ACTIONS["dc-filter"] = (el) => { DISC.filter[activeTab().id] = el.dataset.f; render(); };

ACTIONS["dc-triage"] = (el) => {
  const s = spaceById(activeTab().id);
  const d = DISCOVER[s.id].find((x) => x.id === el.dataset.id);
  DISCOVER[s.id] = DISCOVER[s.id].filter((x) => x !== d);
  const name = d.title.split(":")[0];
  const msg = { space: `${name} added to ${s.name}${d.owned ? "" : " and to the Library as Unread"}.`, library: `${name} added to the Library as Unread.`,
    dismiss: `Dismissed. ${name} does not come back for this Space.` }[el.dataset.how];
  CoreUI.toast(msg, el.dataset.how === "dismiss" ? "info" : "ok");
  render();
};

document.addEventListener("input", (e) => { if (e.target.id === "dc-q") { DISC.query = e.target.value; render(); } });
