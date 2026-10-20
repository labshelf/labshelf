// Renders the Overview tab: dates and goals, recent Space events, linked projects, papers in focus and members. Mockup only.
const ovBlock = (title, body, actions = "", cls = "") =>
  `<section class="ov-block ${cls}"><header class="ov-head"><h2>${title}</h2>${actions ? `<span class="ov-acts">${actions}</span>` : ""}</header>${body}</section>`;

function projectsBlock(s) {
  const link = `<button class="ls-btn ls-btn-ghost" data-act="toast" data-msg="Links a LaTeX or Typst project. Members of a shared Space are invited to it.">${icon("link")}Link</button>`;
  if (!s.projects.length) return ovBlock("Projects", emptyState("No linked projects.", "Link a project to see its deadline and checklist here."), link);
  const rows = s.projects.map((id) => {
    const p = PROJECTS[id];
    return `<li><button class="ov-row" data-act="open-project" data-id="${id}" title="Open ${p.name}">${formatTag(p.format)}
      <span class="ov-main"><span class="ov-name">${p.name}</span><span class="ov-sub mono">${p.main}</span></span>
      <span class="ov-side">${p.deadline ? `Due ${p.deadline}` : ""}<span class="ov-check">${arc(p.checklist[0], p.checklist[1])}${p.checklist[0]} of ${p.checklist[1]}</span></span></button></li>`;
  });
  return ovBlock("Projects", `<ul class="ov-list">${rows.join("")}</ul>`, link);
}

function focusBlock(s) {
  if (!s.focus.length) return ovBlock("Papers in focus", emptyState("No papers in focus.", "Mark the papers you are working on in Papers, and they stay here."));
  const rows = s.focus.map((id) => {
    const p = PAPERS[id];
    return `<li><button class="ov-row" data-act="toast" data-msg="Opens ${esc(paperShort(id))} in the reader." title="${esc(p.title)}">${statusMark(p.status)}
      <span class="ov-main"><span class="ov-name">${esc(p.title)}</span><span class="ov-sub">${esc(p.authors)} · ${p.year}</span></span>
      <span class="ov-side">${STATUS_LABEL[p.status]}</span></button></li>`;
  });
  return ovBlock("Papers in focus", `<ul class="ov-list">${rows.join("")}</ul>`);
}

function membersBlock(s) {
  const rows = s.members.map(([w, role]) => `<li class="mem-row">${avatar(w)}<span class="ov-name">${PEOPLE[w].name}</span><span class="ov-side">${role}</span></li>`).join("");
  const hint = s.members.length === 1 ? emptyState("Only you.", "Share the Space from its header to work on it with others.") : "";
  return ovBlock("Members", `<ul class="ov-list">${rows}</ul>${hint}`);
}

function renderOverview(s) {
  return `<div class="ov-grid"><div class="ov-col">${timelineBlock(s)}${discussionOverview(s)}${activityBlock(s)}</div>
    <div class="ov-col">${projectsBlock(s)}${focusBlock(s)}${membersBlock(s)}</div></div>`;
}

ACTIONS["open-project"] = (el) => openProject(el.dataset.id);
