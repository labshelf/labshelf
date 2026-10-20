// Renders the Discover tab: a ranked feed scoped to the Space, with filters, search and what is being watched. Mockup only.
const DISC = { filter: "all", query: "" };
const DISC_FILTERS = [["all", "All"], ["gaps", "Gaps"], ["draft", "For this draft"], ["versions", "New versions"]];

const discItem = (d) => {
  const p = d.paper && STATE.papers[d.paper];
  return { ...d, title: p ? p.title : d.title, authors: p ? p.authors : d.authors, owned: p ? p.inLibrary : d.owned };
};

function renderDiscover(view) {
  const q = DISC.query.toLowerCase();
  const items = STATE.discover.map(discItem)
    .filter((d) => DISC.filter === "all" || d.filter === DISC.filter)
    .filter((d) => !q || `${d.title} ${d.authors}`.toLowerCase().includes(q));
  view.innerHTML = `
  <div class="space">${spaceHeader("discover")}
    <div class="dc-grid">
      <div class="dc-main">
        <label class="ls-search dc-search">${icon("search")}<input id="dc-q" value="${DISC.query}" placeholder="Search open sources — papers you have are marked"></label>
        <div class="dc-chips">${DISC_FILTERS.map(([id, label]) => `<button class="dc-chip ${DISC.filter === id ? "on" : ""}" data-act="dc-filter" data-f="${id}">${label}
          <span class="dc-n">${id === "all" ? STATE.discover.length : STATE.discover.filter((d) => d.filter === id).length}</span></button>`).join("")}</div>
        <div class="dc-feed">${items.length ? items.map((d, i) => `
          <div class="dc-item ${d.owned ? "owned" : ""}">
            <span class="dc-rank">${i + 1}</span>
            <div class="dc-body">
              <div class="dc-title">${d.title}</div>
              <div class="dc-authors">${d.authors}${d.owned ? `<span class="dc-owned"><span data-i="check"></span>In your Library</span>` : ""}</div>
              <div class="dc-why"><span data-i="${d.filter === "versions" ? "git-branch" : d.filter === "gaps" ? "link" : d.filter === "draft" ? "file-text" : "compass"}"></span>${d.why}</div>
            </div>
            <div class="dc-acts">
              <button class="ls-btn ls-button-soft md" data-act="dc-desk" data-id="${d.id}">Desk</button>
              ${d.owned ? `<button class="ls-btn ls-btn-ghost md" data-act="toast" data-msg="Opens ${d.title.split(":")[0]} in the Library">Open</button>`
                : `<button class="ls-btn ls-btn-ghost md" data-act="dc-lib" data-id="${d.id}">Library</button>`}
              <button class="ls-icon-btn" data-act="dc-dismiss" data-id="${d.id}" title="Dismiss" aria-label="Dismiss" data-i="x"></button>
            </div>
          </div>`).join("") : `<div class="dk-empty">Nothing matches. Clear the search or pick another filter.</div>`}</div>
      </div>
      <aside class="dc-watch">
        <div class="dc-watch-head"><span data-i="eye"></span>Watching</div>
        <div class="dc-watch-big">41 papers</div>
        <ul class="dc-watch-list">
          <li><span data-i="bell"></span>new papers that cite them</li>
          <li><span data-i="git-branch"></span>new versions and published versions</li>
          <li><span data-i="ban"></span>retractions and errata</li>
        </ul>
        <div class="dc-watch-meta">Last checked 2 h ago · OpenAlex, arXiv, Crossref</div>
        <div class="dc-watch-meta">Offline, Discover shows the last feed it built.</div>
        <button class="ls-btn ls-btn-ghost md" data-act="toast" data-msg="Checking 41 papers for new citing papers, versions and retractions"><span data-i="refresh"></span>Check now</button>
      </aside>
    </div>
  </div>`;
}

function discoverAction(act, el) {
  if (act === "dc-filter") { DISC.filter = el.dataset.f; return render(); }
  const d = STATE.discover.find((x) => x.id === el.dataset.id);
  if (!d) return;
  STATE.discover = STATE.discover.filter((x) => x !== d);
  const name = d.paper ? paperName(d.paper) : d.title.split(":")[0];
  if (act === "dc-desk") {
    const due = parseDate("end of week");
    if (d.paper) {
      STATE.commitments.push({ id: `c${nextId++}`, kind: "read", paper: d.paper, text: `@${d.paper}`, due, done: false, src: null });
      Object.assign(STATE.papers[d.paper], { status: "Reading", inLibrary: true });
    } else STATE.commitments.push({ id: `c${nextId++}`, kind: "desk", text: `Look at ${name}`, due, done: false, src: null });
    toast(`On your Desk · read by ${fmtDay(due)}${d.owned ? "" : " · added to the Library"}`);
  } else if (act === "dc-lib") {
    if (d.paper) STATE.papers[d.paper].inLibrary = true;
    toast(`${name} added to the Library · Unread`);
  } else toast("Dismissed · it will not come back for this Space");
  render();
}

document.addEventListener("input", (e) => {
  if (e.target.id !== "dc-q") return;
  DISC.query = e.target.value; render();
  const input = document.getElementById("dc-q"); input.focus(); input.setSelectionRange(input.value.length, input.value.length);
});
