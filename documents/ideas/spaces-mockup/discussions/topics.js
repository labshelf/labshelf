// Renders participant conversations beside their editable working summary.
function discussionMessages(t) {
  return t.messages.map((m) => `<article class="ds-message" id="message-${m.id}">
    <header>${avatar(m.who)}<strong>${PEOPLE[m.who].name}</strong><span>${m.when}</span></header><p>${esc(m.text)}</p>
    <footer><button class="ls-btn ls-btn-ghost" data-act="ds-decision" data-message="${m.id}" ${t.decisions.includes(m.id) ? "disabled" : ""}>${icon("check")}${t.decisions.includes(m.id) ? "Decision kept" : "Keep as decision"}</button>
      <button class="ls-btn ls-btn-ghost" data-act="ds-task-form" data-message="${m.id}">${icon("plus")}Create task</button></footer>
    ${DISCUSS.taskMessage === m.id ? discussionTaskForm(t, m) : ""}</article>`).join("");
}

function discussionSummary(t) {
  return `<section class="ds-summary"><header><strong>Working summary</strong><button class="ls-btn ls-btn-ghost" data-act="ds-edit-summary">${icon("edit")}Edit</button></header>
    ${DISCUSS.editing ? `<form id="ds-summary-form"><label for="ds-summary">What should everyone know?</label><textarea id="ds-summary" name="summary" rows="3" maxlength="2000" required>${esc(t.summary)}</textarea>
      <button class="ls-btn ls-button-soft" type="submit">Save summary</button></form>` : `<p>${esc(t.summary)}</p>`}
    <span class="muted">Written by participants. Decisions and tasks stay linked to their messages.</span></section>`;
}

function discussionDetail(s, t) {
  if (!t) return emptyState("Choose a topic.", "Or start a conversation around a paper, note or project.");
  return `<section class="ds-detail" aria-label="Topic conversation"><header class="ds-topic-head"><div><span class="ds-status">${t.resolved ? "Resolved" : "Open topic"}</span><h2>${esc(t.title)}</h2></div>
    <button class="ls-btn ls-btn-ghost" data-act="ds-resolve">${t.resolved ? "Reopen" : "Resolve"}</button></header>
    ${t.source ? `<button class="ds-source" data-act="ds-source" data-source="${t.source}">${icon("link")}${esc(discussionSource(t.source))}${icon("arrow-right")}</button>` : ""}
    ${discussionSummary(t)}<div class="ds-history">${discussionMessages(t)}</div>
    <form class="ds-reply" id="ds-reply-form"><label for="ds-reply">Reply to this topic</label><textarea id="ds-reply" name="reply" rows="3" maxlength="4000" required placeholder="Add evidence, ask a question or propose a next step…">${esc(DISCUSS.drafts[t.id] ?? "")}</textarea>
      <div><span class="muted">Shared with ${s.members.length} ${s.members.length === 1 ? "member" : "members"} · mockup only</span><button class="ls-btn ls-button-soft" type="submit">Send reply${icon("arrow-right")}</button></div></form></section>`;
}

function discussionTopicList(s) {
  const topics = discussionTopics(s).filter((t) => (DISCUSS.filter === "all" || !t.resolved) && discussionMatches(t));
  if (!topics.some((t) => t.id === DISCUSS.selected[s.id]) && topics.length) DISCUSS.selected[s.id] = topics[0].id;
  return `<div class="ds-layout"><aside class="ds-topics" aria-label="Topics"><div class="ds-filter"><button class="ls-btn ls-btn-ghost" data-act="ds-filter" aria-pressed="${DISCUSS.filter === "open"}">${DISCUSS.filter === "open" ? "Open topics" : "All topics"}${icon("chevron-down")}</button><span>${topics.length}</span></div>
    ${topics.map((t) => `<button id="ds-topic-${t.id}" class="ds-topic ${DISCUSS.selected[s.id] === t.id ? "selected" : ""}" data-act="ds-topic" data-id="${t.id}" aria-pressed="${DISCUSS.selected[s.id] === t.id}">
      <strong>${esc(t.title)}</strong><span>${t.source ? esc(discussionSource(t.source)) : "Space conversation"}</span>
      <span>${t.messages.length} messages · ${t.decisions.length} decisions${t.resolved ? " · Resolved" : ""}</span></button>`).join("") || emptyState("No matching topics.", "Try All topics or another search.")}</aside>
    ${discussionDetail(s, topics.find((t) => t.id === DISCUSS.selected[s.id]))}</div>`;
}

function discussionCreateForm(s) {
  const sources = [...spacePapers(s).map((p) => `paper:${p.id}`), ...NOTES.filter((n) => n.spaces.includes(s.id) && (n.kind === "space" || n.shared)).map((n) => `note:${n.id}`), ...s.projects.map((id) => `project:${id}`)];
  return `<form id="ds-create-form" class="ds-create"><h2>Start a topic</h2><label for="ds-title">Topic</label><input id="ds-title" name="title" maxlength="120" required placeholder="What do we need to work out?">
    <label for="ds-context">Related to</label><select id="ds-context" name="source"><option value="">This Space</option>${[...new Set(sources)].map((source) => `<option value="${source}">${esc(discussionSource(source))}</option>`).join("")}</select>
    <label for="ds-opening">Opening message</label><textarea id="ds-opening" name="body" rows="4" maxlength="4000" required></textarea>
    <div><button class="ls-btn ls-button-soft" type="submit">Create topic</button><button class="ls-btn ls-btn-ghost" type="button" data-act="ds-cancel">Cancel</button></div></form>`;
}
