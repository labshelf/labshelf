// Renders the Space header with its four tabs and the Overview tab: the work, what changed, the schedule, the Notebook and the Glossary. Mockup only.
const SPACE_TABS = [["overview", "Overview", "layers"], ["notebook", "Notebook", "note"], ["discover", "Discover", "compass"], ["glossary", "Glossary", "book-a"]];

function spaceHeader(tab) {
  const s = STATE.space;
  return `<header class="sp-head">
    <div class="grow">
      <div class="sp-kicker">Space · personal</div>
      <div class="sp-name">${s.name}</div>
    </div>
    <div class="sp-actions">
      <div class="people">${s.people.map((p) => `<span class="avatar">${p.initials}</span>`).join("")}Only you</div>
      <button class="ls-btn ls-btn-ghost md" data-act="toast" data-msg="Sharing a Space comes with project-collaboration"><span data-i="users"></span>Share…</button>
    </div>
  </header>
  <nav class="sp-tabs" role="tablist">${SPACE_TABS.map(([id, label, ic]) => `
    <button class="sp-tab nav ${id === tab ? "on" : ""}" role="tab" aria-selected="${id === tab}" data-view="${id}"><span data-i="${ic}"></span>${label}</button>`).join("")}</nav>`;
}

function renderOverview(view) {
  const s = STATE.space;
  const recent = STATE.arrived.filter((a) => a.space && a.kind !== "discover" && a.kind !== "share").slice(0, 3);
  const lastTerm = STATE.glossary[STATE.glossary.length - 1];
  view.innerHTML = `
  <div class="space">
    ${spaceHeader("overview")}
    <div class="sp-purpose" contenteditable="true" spellcheck="false">${s.purpose}</div>
    <div class="sp-meta">
      <span><b>${s.projects.length}</b> projects</span>
      <span><b>${s.folders.length}</b> folders · ${s.folders.map((f) => f.name).join(", ")}</span>
      <span><b>${s.paperCount}</b> papers</span>
      <span><b>${STATE.entries.length}</b> Notebook entries</span>
    </div>

    <div class="sp-grid">
      <div class="sp-col">
        <section>
          <div class="sp-block-head"><span class="sp-block-title">The work</span><span class="sp-block-hint">what each section still owes</span></div>
          ${s.projects.map(renderProject).join("")}
        </section>
        <section>
          <div class="sp-block-head"><span class="sp-block-title">Schedule</span><span class="sp-block-hint">dated commitments across the projects and readings</span>
            <button class="ls-btn ls-btn-ghost md" data-act="toast" data-msg="Exports this Space's due dates as thesis-ch3.ics"><span data-i="calendar"></span>Export .ics</button></div>
          ${renderSchedule()}
        </section>
      </div>

      <div class="sp-col">
        <section>
          <div class="sp-block-head"><span class="sp-block-title">Since last time</span><span class="sp-block-hint">Thursday, 16 Oct</span></div>
          <div class="since">
            ${recent.map((a) => `<div class="since-item"><span class="arr-ic k-${a.kind}" data-i="${a.icon}"></span>
              <div class="since-main"><div>${a.title}</div><div class="since-line">${a.line}</div></div>
              ${a.acts.includes("discover") ? `<button class="ls-btn ls-button-soft md nav" data-view="discover">Discover</button>`
                : `<button class="ls-btn ls-button-soft md" data-act="arr-done" data-id="${a.id}" data-msg="${a.kind === "version" ? "Opens v2 and v3 side by side at Theorem 3.2" : "Opens method.tex at line 88"}">${a.kind === "version" ? "Compare" : "Show"}</button>`}</div>`).join("")}
            ${STATE.activity.slice(0, 1).map((m) => `<div class="since-item"><span class="arr-ic" data-i="message"></span>
              <div class="since-main"><div>${m.who} on ${m.project}${m.anchor ? ` · ${m.anchor}` : ""}</div><div class="since-line">“${m.text}” · ${m.when}</div></div>
              <button class="ls-btn ls-btn-ghost md" data-act="toast" data-msg="Opens ${m.anchor || m.project} with the activity beside it">Open</button></div>`).join("")}
            ${recent.length ? "" : `<div class="dk-empty">Nothing new since Thursday.</div>`}
          </div>
        </section>
        <section>
          <div class="sp-block-head"><span class="sp-block-title">Notebook</span><span class="sp-block-hint">${STATE.entries.length} entries</span>
            <button class="ls-btn ls-btn-ghost md" data-act="new-entry"><span data-i="plus"></span>Entry</button></div>
          <div class="entries">
            ${STATE.entries.slice(0, 3).map((e) => `
              <div class="entry" data-act="open-entry" data-id="${e.id}">
                <span class="entry-date">${e.date}</span>
                <div class="entry-title">${e.title}${e.with ? ` <span>with ${e.with}</span>` : ""}</div>
                <div class="entry-text">${plain(e.body[0])}</div>
              </div>`).join("")}
          </div>
        </section>
        <section>
          <div class="sp-block-head"><span class="sp-block-title">Glossary</span><span class="sp-block-hint">${STATE.glossary.length} terms · last added ${lastTerm.added}</span>
            <button class="ls-btn ls-btn-ghost md nav" data-view="glossary">Open</button></div>
          <div class="gl-mini">${STATE.glossary.map((g) => `<button class="gl-chip nav" data-view="glossary" title="${g.name}"><span class="gl-not">${g.notation}</span><span>${g.name}</span></button>`).join("")}</div>
        </section>
      </div>
    </div>
  </div>`;
}

function renderProject(p) {
  return `
  <div class="proj">
    <div class="proj-head"><span class="ft ${p.ft}">${p.ft.toUpperCase()}</span><span class="proj-name">${p.name}</span><span class="proj-main">${p.main}</span><span class="chip">${p.deadline}</span></div>
    ${p.sections.map((sec) => `
      <div class="sec ${sec.empty ? "empty" : ""} ${sec.active ? "active" : ""}" data-act="toast" data-msg="Opens ${p.main} at §${sec.n}">
        <span class="sec-n">§${sec.n}</span>
        <span class="sec-title">${sec.empty ? `${sec.title} — not started` : sec.title}</span>
        <span class="sec-cites">${sec.cites} cites</span>
        ${sec.debt.length ? `<div class="sec-debt">${sec.debt.map((d) => `<span><span data-i="warning"></span>${d}</span>`).join("")}</div>` : ""}
      </div>`).join("")}
  </div>`;
}

function overviewAction(act, el) {
  if (act === "new-entry") { NB.editing = true; return go("notebook"); }
  if (act === "tick") { toggleCommitment(el.dataset.id); return render(); }
  if (act === "arr-done") { takeArrived(el.dataset.id); toast(el.dataset.msg); return render(); }
}
