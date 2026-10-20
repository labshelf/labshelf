// Renders the Overview's Dates and goals timeline and its Since your last visit list from the Space's own dates and events. Mockup only.
const TODAY = 20;
const dayNumber = (day) => { const [d, m] = day.split(" "); return Number(d) + (m === "Nov" ? 31 : 0); };
// 20 Oct 2026 is a Tuesday.
const weekday = (day) => ["Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Mon"][(dayNumber(day) - TODAY + 70) % 7];

function goalProgress(d) {
  if (d.papers) {
    const done = d.papers.filter((id) => PAPERS[id].status === "done").length;
    return { done, total: d.papers.length, label: `${done} of ${d.papers.length} Done` };
  }
  const [done, total] = PROJECTS[d.project].checklist;
  return { done, total, label: `${d.project} checklist · ${done} of ${total}` };
}

function dateBody(d) {
  if (d.kind === "item") {
    return `<label class="tl-item ls-checkbox"><input type="checkbox" data-act="ov-tick" data-id="${d.id}" ${d.done ? "checked" : ""}><span class="${d.done ? "tl-done" : ""}">${esc(d.text)}</span></label>`;
  }
  if (d.kind === "deadline") return `<span class="tl-deadline">${icon("deadline")}${esc(d.text)}</span>`;
  const g = goalProgress(d);
  const papers = d.papers ? `<span class="tl-papers">${d.papers.map((id) => `<span title="${esc(PAPERS[id].title)} · ${STATUS_LABEL[PAPERS[id].status]}">${statusMark(PAPERS[id].status)}</span>`).join("")}</span>` : "";
  return `<span class="tl-goal">${arc(g.done, g.total)}<span class="tl-goal-text">${esc(d.text)}</span><span class="tl-progress">${g.label}</span>${papers}</span>`;
}

function dateRow(d) {
  const n = dayNumber(d.day);
  const late = n < TODAY && d.kind === "item" && !d.done;
  const when = n === TODAY ? "today" : n < TODAY ? (late ? "overdue" : "") : `in ${n - TODAY} days`;
  return `<li class="tl-row tl-${d.kind}${n < TODAY ? " past" : ""}"><span class="tl-day">${weekday(d.day)} ${d.day}<span class="tl-when${late ? " late" : ""}">${when}</span></span>${dateBody(d)}</li>`;
}

function timelineBlock(s) {
  const add = `<button class="ls-btn ls-btn-ghost" data-act="toast" data-msg="Adds a checklist item, a deadline or a goal with a due date.">${icon("plus")}Add date</button>`;
  if (!s.dates.length) return ovBlock("Dates and goals", emptyState("No dates yet.", "Give a checklist item a due date or add a deadline, and the timeline appears."), add);
  const rows = [...s.dates].sort((a, b) => dayNumber(a.day) - dayNumber(b.day));
  const next = rows.findIndex((d) => dayNumber(d.day) >= TODAY);
  const items = rows.map(dateRow);
  items.splice(next < 0 ? items.length : next, 0, `<li class="tl-today" aria-label="Today"><span>Today · Tue 20 Oct</span></li>`);
  const ics = `<button class="ls-btn ls-btn-ghost" data-act="toast" data-msg="Exports ${rows.length} dates as ${s.id}.ics for your calendar.">${icon("download")}Export .ics</button>`;
  return ovBlock("Dates and goals", `<ol class="tl">${items.join("")}</ol>`, add + ics, "ov-wide");
}

function activityBlock(s) {
  const body = s.activity.length
    ? `<ul class="ov-list">${s.activity.map((a) => `<li class="act-row">${avatar(a.who)}<span class="act-icon">${icon(a.icon)}</span><span class="act-text"><b>${PEOPLE[a.who].name}</b> ${a.text}</span><span class="act-when">${a.when}</span></li>`).join("")}</ul>`
    : emptyState("Nothing new since your last visit.", s.members.length === 1 ? "When others share this Space, what they add, edit and tick shows here." : "");
  return ovBlock("Since your last visit", body);
}

ACTIONS["ov-tick"] = (el) => {
  const d = SPACES.flatMap((s) => s.dates).find((x) => x.id === el.dataset.id);
  d.done = el.checked;
  CoreUI.toast(d.done ? `Ticked “${d.text}”. Members see it in Since your last visit.` : `Unticked “${d.text}”.`);
  render();
};
