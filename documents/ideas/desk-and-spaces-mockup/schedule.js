// Renders a Space's Schedule: a vertical timeline of dated commitments with their source and done/open state. Mockup only.
function renderSchedule() {
  const list = STATE.commitments.filter((c) => c.due != null).sort((a, b) => a.due - b.due);
  let todayDrawn = false;
  const rows = list.map((c) => {
    const marker = !todayDrawn && c.due > TODAY ? ((todayDrawn = true), `<div class="sch-today"><span>Today · Sat 18 Oct</span></div>`) : "";
    const what = c.kind === "read" ? `Read ${inline(c.text)}` : inline(c.text);
    const where = c.kind === "todo" ? `${c.project} Checklist` : c.kind === "read" ? "reading" : c.kind === "deadline" ? c.project : "Desk";
    const state = c.kind === "deadline" ? `<span class="sch-state dl">deadline</span>`
      : c.done ? `<span class="sch-state ok">done</span>` : c.due < TODAY ? `<span class="sch-state late">overdue</span>` : `<span class="sch-state">open</span>`;
    const check = c.kind === "deadline" ? `<span class="sch-dot deadline"></span>`
      : `<input type="checkbox" class="sch-check" data-act="tick" data-id="${c.id}" ${c.done ? "checked" : ""} aria-label="Done">`;
    return `${marker}<div class="sch-row ${c.done ? "done" : ""} ${c.kind === "deadline" ? "deadline" : ""}" data-c="${c.id}">
      <span class="sch-date">${fmtDay(c.due)}</span>${check}
      <div class="sch-main"><div class="sch-what">${tag(c.kind)}<span>${what}</span></div>
        <div class="sch-meta"><span>${where}</span>${sourceLabel(c)}</div></div>
      ${state}</div>`;
  }).join("");
  return `<div class="schedule">${rows}${todayDrawn ? "" : `<div class="sch-today"><span>Today · Sat 18 Oct</span></div>`}</div>`;
}
