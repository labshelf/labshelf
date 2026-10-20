// Composes the research desk around the selected draft section.
function renderOverview(view) {
  view.innerHTML = `<div class="space research-space">${spaceHeader("overview")}
    <div class="materials-toolbar"><nav aria-label="Material filters">${[["all", "All materials"], ["projects", "Projects"], ["papers", "Papers"]].map(([id, label]) =>
      `<button class="material-filter ${WORK.filter === id ? "on" : ""}" data-act="work-filter" data-id="${id}" aria-pressed="${WORK.filter === id}">${label}${id !== "all" ? `<span class="ls-count">${id === "projects" ? STATE.space.projects.length : STATE.space.paperCount}</span>` : ""}</button>`).join("")}</nav>
      <label class="ls-search">${icon("search")}<input id="material-search" aria-label="Search Space materials" placeholder="Search this Space…" value="${safeText(WORK.query)}"></label>
      <button class="ls-btn ls-button-soft" data-act="add-material">${icon("plus")}Add</button></div>
    <div class="research-desk"><aside class="work-materials" aria-label="Space materials">${materialNavigator()}</aside>
      <div class="work-context" id="work-context">${contextMarkup()}</div></div>
    <footer class="work-footer"><span>Ana added D4RL · 20 min ago</span>
      <button class="text-action" data-act="open-entry" data-id="e1">Notebook · Lab meeting, 12 Oct</button>
      <button class="text-action nav" data-view="desk">Next · Read appendix C, 20 Oct</button>
      <button class="text-action space-conversation" data-act="space-chat" aria-pressed="${WORK.general}">${icon("message")}Space conversation<span class="ls-count">2</span></button></footer>
  </div>`;
}

function contextMarkup() {
  const project = STATE.space.projects[WORK.project];
  const section = selectedSection();
  const draft = WORK.drafts[`${WORK.project}:${WORK.section}`] ?? (WORK.project === 0 && WORK.section === "3.2"
    ? "A conservative value estimate gives the policy a lower bound on expected return. The remaining question is how this guarantee carries over to the benchmark setting."
    : section.empty ? "Outline the evidence and the argument for this section." : `This section develops ${section.title.toLowerCase()} using the papers collected in this Space.`);
  return `<section class="draft-section"><div class="context-path"><span>${project.name} / §${section.n}</span>
    <button class="text-action" data-act="edit-draft">Edit draft ${icon("edit")}</button></div>
    <h2>${section.title}</h2><p class="context-caption">${section.empty ? "A place to start the argument." : "Working from evidence to argument."}</p>
    <p class="draft-passage">${safeText(draft)} <button class="citation-link" data-act="work-paper" data-id="CQL">[Kumar et al., 2020]</button></p></section>
    <section class="supporting-evidence"><h3 class="work-label">Supporting evidence</h3>${evidenceMarkup()}</section>
    ${discussionMarkup()}`;
}

function evidenceMarkup() {
  const paper = STATE.papers[WORK.paper];
  const excerpt = EXCERPTS[WORK.paper];
  return `<article class="evidence-sheet" data-pdf-theme="sepia"><header>${icon("file-text")}<div><h3>${safeText(paper.title)}</h3>
    <p>${safeText(paper.authors)}${excerpt ? ` · page ${excerpt.page}` : ""}</p></div></header>
    ${excerpt ? `<blockquote>${excerpt.lead}<mark>${excerpt.highlight}</mark>${excerpt.tail}</blockquote>` : '<p class="excerpt-empty">Select a passage in this paper to link evidence to the draft.</p>'}
    <footer><button class="ls-btn ls-btn-ghost" data-act="open-paper">${icon("external")}Open paper</button>
      <button class="ls-btn ls-btn-ghost" data-act="cite-passage" ${excerpt ? "" : "disabled"}>${icon("quote")}Cite passage</button>
      <span>${excerpt ? `p. ${excerpt.page} · illustrative excerpt` : "Paper added to this Space"}</span></footer></article>`;
}

function refreshWorkspace() {
  const scroll = document.getElementById("view").scrollTop;
  render();
  document.getElementById("view").scrollTop = scroll;
}

document.addEventListener("input", (event) => {
  if (event.target.id !== "material-search") return;
  WORK.query = event.target.value;
  document.querySelector(".work-materials").innerHTML = materialNavigator();
});
