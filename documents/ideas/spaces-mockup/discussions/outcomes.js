// Collects decisions and assigned tasks with links to the originating conversation.
const discussionMatches = (t) => `${t.title} ${t.summary} ${t.messages.map((m) => m.text).join(" ")}`.toLowerCase().includes(DISCUSS.query.trim().toLowerCase());
const discussionOrigin = (topic, message) => `<button class="ds-source" data-act="ds-origin" data-topic="${topic.id}" data-message="${message}">${icon("message")}${esc(topic.title)}${icon("arrow-right")}</button>`;

function discussionOutcomes(s) {
  const topics = discussionTopics(s).filter(discussionMatches);
  const decisions = topics.flatMap((t) => t.decisions.map((id) => ({ t, m: t.messages.find((m) => m.id === id) })));
  if (DISCUSS.view === "decisions") return `<div class="ds-outcomes"><p class="muted">Agreements kept by participants, with the original discussion one click away.</p>
    ${decisions.map(({ t, m }) => `<article class="ds-outcome"><span class="ds-outcome-label">${icon("check")}Decision</span><p>${esc(m.text)}</p><div class="ds-attribution">${avatar(m.who)}${PEOPLE[m.who].name}<span>${m.when}</span></div>${discussionOrigin(t, m.id)}</article>`).join("") || emptyState("No decisions yet.", "Use Keep as decision on a message to preserve an agreement here.")}</div>`;
  const tasks = s.dates.filter((d) => topics.some((t) => t.id === d.topic));
  return `<div class="ds-outcomes"><p class="muted">Follow-ups are the Space’s checklist items. Completion also updates Overview.</p>
    ${tasks.map((d) => `<article class="ds-outcome"><label class="ds-task"><input type="checkbox" data-act="ov-tick" data-id="${d.id}" ${d.done ? "checked" : ""}><span class="${d.done ? "ds-done" : ""}">${esc(d.text)}</span></label>
      <div class="ds-attribution">${avatar(d.assignee)}${PEOPLE[d.assignee].name}<span>Due ${esc(d.day)}</span><span>${d.done ? "Done" : "Open"}</span></div>${discussionOrigin(topics.find((t) => t.id === d.topic), d.message)}</article>`).join("") || emptyState("No follow-ups yet.", "Create a task from a message and give it an owner and a due date.")}</div>`;
}

function discussionTaskForm(t, m) {
  const s = spaceById(t.space);
  return `<form class="ds-task-form" id="ds-task-form"><label for="ds-task-title">Task</label><input id="ds-task-title" name="title" value="${esc(m.text)}" maxlength="4000" required>
    <label for="ds-assignee">Owner</label><select id="ds-assignee" name="assignee">${s.members.map(([who]) => `<option value="${who}">${PEOPLE[who].name}</option>`).join("")}</select>
    <label for="ds-due">Due</label><select id="ds-due" name="due">${["22 Oct", "23 Oct", "27 Oct", "3 Nov", "10 Nov"].map((day) => `<option>${day}</option>`).join("")}</select>
    <div><button class="ls-btn ls-button-soft" type="submit">Add to Space tasks</button><button class="ls-btn ls-btn-ghost" type="button" data-act="ds-cancel-task">Cancel</button></div></form>`;
}

function renderDiscussions(s) {
  const count = discussionTopics(s).filter((t) => !t.resolved).length;
  return `<div class="discussions"><header class="ds-heading"><div><h2>Conversations that keep their context</h2><p>Work through a topic together. Keep the agreement and who does what next.</p></div><button class="ls-btn ls-button-soft" data-act="ds-create">${icon("plus")}New topic</button></header>
    <div class="ds-toolbar"><nav aria-label="Discussion views">${[["topics", `Topics · ${count} open`], ["decisions", "Decisions"], ["tasks", "Tasks"]].map(([id, label]) => `<button class="ls-btn ${DISCUSS.view === id ? "ls-button-soft" : "ls-btn-ghost"}" id="ds-view-${id}" data-act="ds-view" data-view="${id}" aria-pressed="${DISCUSS.view === id}">${label}</button>`).join("")}</nav>
      <input id="ds-search" type="search" aria-label="Search discussions" placeholder="Search topics and messages" value="${esc(DISCUSS.query)}"></div>
    ${DISCUSS.creating ? discussionCreateForm(s) : DISCUSS.view === "topics" ? discussionTopicList(s) : discussionOutcomes(s)}
    <p class="ds-footnote">Shared participant conversation · sample data and edits stay in this page until reload.</p></div>`;
}

function discussionOverview(s) {
  const topics = discussionTopics(s).filter((t) => !t.resolved);
  const rows = topics.map((t) => `<li><button class="ov-row" data-act="ds-open-from-overview" data-topic="${t.id}">${icon("message")}<span class="ov-main"><span class="ov-name">${esc(t.title)}</span><span class="ov-sub">${t.messages.length} messages · ${t.decisions.length} decisions</span></span>${icon("arrow-right")}</button></li>`).join("");
  return ovBlock("Discussions", rows ? `<ul class="ov-list">${rows}</ul>` : emptyState("No open topics.", "Start a topic in Discussions to work through a question together."));
}
