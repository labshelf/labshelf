// Renders a Space tab: its header with name, purpose, members and Share, the view tabs, and the chosen view. Mockup only.
const SPACE_VIEWS = [["overview", "Overview"], ["papers", "Papers"], ["notes", "Notes"], ["discover", "Discover"], ["glossary", "Glossary"]];
// A lookup at render time: each view lives in a script that loads after this one.
const spaceRenderer = (view) => ({ overview: renderOverview, papers: renderPapers, notes: renderNotes, discover: renderDiscover, glossary: renderGlossary })[view];

function spaceHeader(s, view) {
  const others = s.members.length - 1;
  return `<header class="sp-head">
    <div class="sp-title"><h1 class="sp-name">${esc(s.name)}</h1>
      ${s.purpose ? `<p class="sp-purpose">${esc(s.purpose)}</p>` : `<button class="sp-purpose sp-add-purpose" data-act="toast" data-msg="Adds a one-line purpose to the Space.">Add a purpose</button>`}</div>
    <div class="sp-people" aria-label="Members">${s.members.map(([w]) => avatar(w)).join("")}</div>
    <button class="ls-btn ls-button-soft" data-act="toast" data-msg="${others ? `Invite link copied. ${others} member${others > 1 ? "s" : ""} already share this Space.` : "Invite link copied. Whoever opens it joins the Space."}">${icon("share")}Share</button>
  </header>
  <nav class="sp-tabs" aria-label="Space views">${SPACE_VIEWS.map(([id, label]) =>
    `<button class="sp-tab${id === view ? " on" : ""}" ${id === view ? 'aria-current="page"' : ""} data-act="space-view" data-view="${id}">${label}</button>`).join("")}</nav>`;
}

function renderSpace(s) {
  const view = APP.view[s.id] ?? "overview";
  return `<div class="sp">${spaceHeader(s, view)}<div class="sp-body">${spaceRenderer(view)(s)}</div></div>`;
}

ACTIONS["space-view"] = (el) => {
  const id = activeTab().id;
  APP.view[id] = el.dataset.view;
  APP.folder[id] = null;
  render({ keepScroll: false });
};
