// Holds the selected research material in the demonstration workspace.
const WORK = {
  project: 0, section: "3.2", paper: "CQL", filter: "all", query: "", general: false,
  papers: ["CQL", "D4RL", "BCQ"], drafts: {}, replies: {}, composers: {},
};
const EXCERPTS = {
  CQL: { page: 3, lead: "CQL learns a ", highlight: "lower bound on the policy value", tail: ", rather than on the value of individual state-action pairs." },
  D4RL: { page: 5, lead: "The medium-replay dataset contains ", highlight: "samples collected throughout training", tail: ", allowing evaluation across a range of behaviour policies." },
  BCQ: { page: 2, lead: "Offline learning requires ", highlight: "constraining the action space", tail: " to reduce extrapolation error on actions outside the dataset." },
};
const selectedSection = () => STATE.space.projects[WORK.project].sections.find((s) => s.n === WORK.section);
const threadKey = () => WORK.general ? "space" : `${WORK.project}:${WORK.section}`;
const safeText = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function materialNavigator() {
  const matches = (text) => text.toLowerCase().includes(WORK.query.toLowerCase());
  const projects = STATE.space.projects.map((p, index) => {
    if (WORK.filter === "papers" || !matches(`${p.name} ${p.sections.map((s) => s.title).join(" ")}`)) return "";
    return `<div class="work-project"><button class="material-project" data-act="work-project" data-id="${index}" aria-expanded="${WORK.project === index}">
      ${icon("file-text")}<span>${p.name}</span><span class="ft ${p.ft}">${p.ft.toUpperCase()}</span>${icon(WORK.project === index ? "chevron-down" : "chevron-right")}</button>
      ${WORK.project === index ? `<div class="work-outline">${p.sections.map((s) => `<button class="outline-row ${WORK.section === s.n ? "selected" : ""}"
        data-act="work-section" data-id="${s.n}" aria-pressed="${WORK.section === s.n}"><span>${s.n}</span>${s.title}</button>`).join("")}</div>` : ""}</div>`;
  }).join("");
  const papers = WORK.filter === "projects" ? "" : WORK.papers.filter((key) => matches(`${STATE.papers[key].title} ${STATE.papers[key].authors}`)).map(paperRow).join("");
  return `<div class="material-list"><h2 class="work-label">${WORK.filter === "papers" ? "Papers in this Space" : "The work"}</h2>
    ${projects}${WORK.filter !== "projects" ? `<div class="work-papers"><h3 class="work-label">${WORK.filter === "all" ? "Research papers" : "Library"}</h3>${papers}</div>` : ""}
    ${!projects && !papers ? `<p class="muted">No matching materials.</p>` : ""}
    <button class="text-action browse-papers" data-act="browse-papers">Browse Space papers ${icon("arrow-right")}</button>
    <p class="sample-label">${WORK.papers.length} sample papers · 41 in the Space</p></div>`;
}

function paperRow(key) {
  const p = STATE.papers[key];
  return `<button class="material-paper ${WORK.paper === key ? "selected" : ""}" data-act="work-paper" data-id="${key}" aria-pressed="${WORK.paper === key}">
    ${icon("file-text")}<span><strong>${safeText(p.short === "CQL" ? "Conservative Q-Learning" : p.short)}</strong><small>${safeText(p.authors)}</small></span>
    <span class="ls-status-mark" title="${p.status}">${CoreUI.statusMark(p.status.toLowerCase())}</span></button>`;
}
