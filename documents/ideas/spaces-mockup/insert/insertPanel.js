// Renders the Insert from LabShelf panel: kind tabs, a search over the Space then the Library, and insertable cards. Mockup only.
const INSERT_KINDS = [["all", "All"], ["figure", "Figures"], ["table", "Tables"], ["quote", "Quotes"], ["citation", "Citations"], ["code", "Code"]];
const KIND_ICON = { figure: "file-media", table: "table", quote: "quote", citation: "book", code: "symbol-operator" };
const INS = { kind: "all", query: "", mode: {} };

function modeChoice(item) {
  if (item.kind !== "figure" && item.kind !== "table") return "";
  const mode = INS.mode[item.id] ?? "follow";
  const opt = (id, label, tip) => `<button class="ins-mode${mode === id ? " on" : ""}" aria-pressed="${mode === id}" data-act="ins-mode" data-id="${item.id}" data-mode="${id}" title="${tip}">${label}</button>`;
  return `<div class="ins-modes" role="group" aria-label="How to insert">${opt("copy", "Copy", "A copy that never changes")}${opt("follow", "Follow source", "Shows when the source changes")}${opt("pin", "Pin version", "Stays on the version of 18 Oct")}</div>`;
}

function insertCard(item) {
  return `<li class="ins-card"><div class="ins-card-head"><span class="ins-kind">${icon(KIND_ICON[item.kind])}</span>
      <span class="ov-main"><span class="ins-title" title="${esc(item.title)}">${esc(item.title)}</span><span class="ov-sub">${esc(item.from)}</span></span></div>
    <div class="ins-card-foot">${modeChoice(item)}<button class="ls-btn ls-button-soft" data-act="ins-insert" data-id="${item.id}">Insert</button></div></li>`;
}

function insertGroups(space) {
  const q = INS.query.trim().toLowerCase();
  const match = (i) => (INS.kind === "all" || i.kind === INS.kind) && (!q || `${i.title} ${i.from} ${i.src}`.toLowerCase().includes(q));
  const here = space ? INSERT_ITEMS.filter((i) => i.spaces.includes(space.id) && match(i)) : [];
  const library = q || !space ? INSERT_ITEMS.filter((i) => !here.includes(i) && match(i)) : [];
  const group = (title, items) => `<h3 class="ins-group">${title}<span class="tree-count">${items.length}</span></h3><ul class="ins-list">${items.map(insertCard).join("")}</ul>`;
  return (space ? group(esc(space.name), here) : "")
    + (library.length ? group("Library", library) : space && !q ? `<p class="muted ins-hint">Type to search the Library too.</p>` : "")
    + (!here.length && !library.length ? emptyState("Nothing matches.", "Try another word or kind.") : "");
}

function insertPanel(space) {
  return `<aside class="ins-panel" aria-label="Insert from LabShelf"><h2 class="ins-head">Insert from LabShelf</h2>
    <nav class="ins-tabs" aria-label="Kinds">${INSERT_KINDS.map(([id, label]) => `<button class="ins-tab${INS.kind === id ? " on" : ""}" ${INS.kind === id ? 'aria-current="true"' : ""} data-act="ins-kind" data-kind="${id}">${label}</button>`).join("")}</nav>
    <label class="ls-search ins-search">${icon("search")}<input id="ins-q" value="${esc(INS.query)}" aria-label="Search" placeholder="${space ? "Search this Space, then the Library" : "Search the Library"}"></label>
    <div class="ins-results">${insertGroups(space)}</div></aside>`;
}

ACTIONS["ins-kind"] = (el) => { INS.kind = el.dataset.kind; render(); };
ACTIONS["ins-mode"] = (el) => { INS.mode[el.dataset.id] = el.dataset.mode; render(); };
document.addEventListener("input", (e) => { if (e.target.id === "ins-q") { INS.query = e.target.value; render(); } });
