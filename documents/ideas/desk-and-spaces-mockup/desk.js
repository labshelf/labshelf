// Renders the global Desk: a capture bar, what is in your hands, what is due, and what arrived. Mockup only.
const DESK = { laterOpen: false, menu: null, draft: "" };

const deskCount = () => STATE.arrived.length + STATE.commitments.filter((c) => !c.done && c.kind !== "deadline" && bucketOf(c.due) === "today").length;

function renderDesk(view) {
  const due = (b) => STATE.commitments.filter((c) => bucketOf(c.due) === b && !(c.done && c.due < TODAY)).sort((a, b2) => (a.due ?? 0) - (b2.due ?? 0));
  const later = due("later");
  view.innerHTML = `
  <div class="desk">
    <header class="dk-head">
      <div><h1 class="dk-title">Desk</h1><div class="dk-date">Saturday, 18 Oct</div></div>
      <button class="ls-btn ls-btn-ghost md dk-ics" data-act="toast" data-msg="Exports the due dates as labshelf-desk.ics"><span data-i="calendar"></span>Export .ics</button>
    </header>

    <div class="dk-capture">
      <div class="dk-capture-row"><span data-i="square-plus"></span>
        <input id="dk-input" class="dk-input" spellcheck="false" placeholder="read @IQL by Fri · desk: email Ana · todo thesis-ch3: fix Table 3.1 by 25 Oct" value="${DESK.draft}">
        <button class="ls-btn ls-btn-primary md" data-act="dk-save">Save</button></div>
      <div class="dk-preview" id="dk-preview">${deskPreview()}</div>
    </div>

    <div class="dk-grid">
      <div class="dk-col">
        <section>
          <div class="dk-sec-head"><span class="dk-sec-title">In your hands</span><span class="dk-sec-hint">open now, in any app</span>
            ${STATE.hands.length ? `<button class="ls-btn ls-btn-primary md" data-act="resume-all"><span data-i="play"></span>Resume all</button>` : ""}</div>
          <div class="hands">${STATE.hands.length ? STATE.hands.map(handCard).join("") : `<div class="dk-empty">Nothing in your hands. Read something now from Arrived, or resume from the Library.</div>`}</div>
        </section>
        ${["today", "week"].map((b) => dueSection(b, due(b))).join("")}
        <section>
          <button class="dk-sec-head dk-toggle" data-act="toggle-later"><span class="tw" data-i="${DESK.laterOpen ? "chevron-down" : "chevron-right"}"></span>
            <span class="dk-sec-title">Later</span><span class="dk-sec-hint">${later.length} dated</span></button>
          ${DESK.laterOpen ? `<div class="dues">${later.map(dueRow).join("")}</div>` : ""}
        </section>
      </div>
      <div class="dk-col">
        <section>
          <div class="dk-sec-head"><span class="dk-sec-title">Arrived</span><span class="dk-sec-hint">${STATE.arrived.length} to triage</span></div>
          <div class="arrived">${STATE.arrived.length ? STATE.arrived.map(arrivedItem).join("") : `<div class="dk-empty">Nothing new. Watches on your Spaces put new versions, retractions and citing papers here.</div>`}</div>
        </section>
      </div>
    </div>
  </div>`;
}

// Plain text typed on a capture surface is a desk: line.
const asCommand = (text) => (!text.trim() || /^(desk:|read |todo |msg |\?|decided:)/i.test(text.trim()) ? text : `desk: ${text}`);

function deskPreview() {
  const effects = parseCommands(asCommand(DESK.draft));
  return `${renderPreview(effects, "Type a command, or plain text to put it on your Desk today.")}<div class="cmd-hint">${COMMAND_HINT}<span class="once">${ONCE_HINT}</span></div>`;
}

function handCard(h) {
  const p = h.kind === "paper" && STATE.papers[h.paper];
  const e = h.kind === "entry" && entryById(h.entry);
  const lead = p ? arc("half") : e ? `<span class="ft mtg">MTG</span>` : `<span class="ft tex">TEX</span>`;
  const title = p ? p.title : e ? `${e.title}, ${e.date}` : `${h.title}`;
  const sub = p ? `${p.ledger.length} open question${p.ledger.length === 1 ? "" : "s"} on its Ledger` : e ? "Notebook entry · Thesis — chapter 3" : `${h.project} · §3.2`;
  return `<div class="hand" data-hand="${h.id}">
    <div class="hand-top">${lead}<span class="hand-at">${h.at}</span><span class="hand-app">${h.app}</span>
      <button class="ls-icon-btn" data-act="put-down" data-id="${h.id}" title="Put down" aria-label="Put down" data-i="x"></button></div>
    <div class="hand-title">${title}</div>
    <div class="hand-sub ${p && p.ledger.length ? "q" : ""}">${sub}</div>
    <button class="ls-btn ls-button-soft md hand-resume" data-act="resume" data-id="${h.id}"><span data-i="play"></span>Resume</button>
  </div>`;
}

function dueSection(b, list) {
  return `<section>
    <div class="dk-sec-head"><span class="dk-sec-title">${BUCKET_LABEL[b]}</span><span class="dk-sec-hint">${b === "today" ? "Sat 18 Oct" : "Sun 19 – Sat 25 Oct"}</span></div>
    <div class="dues">${list.length ? list.map(dueRow).join("") : `<div class="dk-empty">Nothing due.</div>`}</div></section>`;
}

function dueRow(c) {
  const where = c.kind === "todo" ? `${c.project} Checklist` : c.kind === "read" ? `${paperName(c.paper)} · ${STATE.papers[c.paper].status}` : c.kind === "deadline" ? c.project : "Desk";
  const check = c.kind === "deadline" ? `<span class="due-flag" data-i="flag"></span>`
    : `<input type="checkbox" class="due-check" data-act="tick" data-id="${c.id}" ${c.done ? "checked" : ""} aria-label="Done">`;
  return `<div class="due ${c.done ? "done" : ""}" data-c="${c.id}">${check}${tag(c.kind === "deadline" ? "deadline" : c.kind)}
    <span class="due-main"><span class="due-text">${c.kind === "read" ? "Read " : ""}${inline(c.text)}</span>
      <span class="due-meta"><span class="due-where">${where}</span>${sourceLabel(c)}</span></span>
    <span class="due-day ${c.due != null && c.due < TODAY && !c.done ? "late" : ""}">${relDay(c.due)}</span></div>`;
}

const ARRIVED_ACT = {
  read: '<button class="ls-btn ls-button-soft md" data-act="arr-read" data-id="ID">Read now</button>',
  schedule: '<button class="ls-btn ls-btn-ghost md" data-act="arr-schedule" data-id="ID"><span data-i="calendar"></span>Schedule</button>',
  library: '<button class="ls-btn ls-btn-ghost md" data-act="arr-library" data-id="ID">Library</button>',
  compare: '<button class="ls-btn ls-button-soft md" data-act="arr-done" data-id="ID" data-msg="Opens v2 and v3 side by side at Theorem 3.2">Compare versions</button>',
  show: '<button class="ls-btn ls-button-soft md" data-act="arr-done" data-id="ID" data-msg="Opens method.tex at line 88, where the retracted paper is cited">Show citation</button>',
  discover: '<button class="ls-btn ls-button-soft md" data-act="arr-discover" data-id="ID">Open in Discover</button>',
  dismiss: '<button class="ls-icon-btn" data-act="arr-dismiss" data-id="ID" title="Dismiss" aria-label="Dismiss" data-i="x"></button>',
};

function arrivedItem(a) {
  return `<div class="arr k-${a.kind}" data-arr="${a.id}">
    <span class="arr-ic" data-i="${a.icon}"></span>
    <div class="arr-main"><div class="arr-title">${a.title}</div>
      <div class="arr-line">${a.line}${a.space ? `<span class="space-chip"><span data-i="layers"></span>Thesis — chapter 3</span>` : ""}</div>
      <div class="arr-acts">${a.acts.map((k) => ARRIVED_ACT[k].replaceAll("ID", a.id)).join("")}</div>
      ${DESK.menu === a.id ? scheduleMenu(a.id) : ""}</div>
  </div>`;
}

function scheduleMenu(id) {
  return `<div class="ls-menu dk-menu" role="menu">
    <button class="ls-menu-item" data-act="arr-when" data-id="${id}" data-due="${TODAY}"><span class="ls-menu-label">Today</span><span class="hint">Sat 18</span></button>
    <button class="ls-menu-item" data-act="arr-when" data-id="${id}" data-due="${parseDate("end of week")}"><span class="ls-menu-label">This week</span><span class="hint">Fri 24</span></button>
    <div class="ls-menu-sep"></div>
    <label class="ls-menu-item dk-pick"><span class="ls-menu-label">Pick a date</span><input type="date" data-pick="${id}" min="2026-10-18" max="2026-12-31"></label>
  </div>`;
}

function takeArrived(id) {
  const a = STATE.arrived.find((x) => x.id === id);
  STATE.arrived = STATE.arrived.filter((x) => x !== a);
  DESK.menu = null;
  return a;
}

function scheduleArrived(id, due) {
  const a = takeArrived(id);
  STATE.commitments.push({ id: `c${nextId++}`, kind: "read", paper: a.paper, text: `@${a.paper}`, due, done: false, src: null });
  Object.assign(STATE.papers[a.paper], { status: "Reading", inLibrary: true });
  toast(`Read ${paperName(a.paper)} by ${fmtDay(due)} · on your Desk, ${BUCKET_LABEL[bucketOf(due)]}`);
  render();
}

function deskAction(act, el) {
  const id = el.dataset.id;
  if (act === "dk-save") return saveDeskDraft();
  if (act === "toggle-later") { DESK.laterOpen = !DESK.laterOpen; return render(); }
  if (act === "resume-all") return toast("Reopens CQL at p. 6, D4RL at p. 8, method.tex at line 142 and the Lab meeting entry — in whichever app you are in");
  if (act === "resume") {
    const h = STATE.hands.find((x) => x.id === id);
    return toast(h.kind === "paper" ? `Opens ${paperName(h.paper)} at ${h.at}` : h.kind === "tex" ? `Opens ${h.title} at ${h.at}` : "Opens the Lab meeting entry");
  }
  if (act === "put-down") { STATE.hands = STATE.hands.filter((x) => x.id !== id); toast("Put down · it stays in the Library at the same page"); return render(); }
  if (act === "tick") {
    const c = toggleCommitment(id);
    toast(c.kind === "todo" ? `${c.done ? "Ticked" : "Unticked"} on the ${c.project} Checklist` : c.done ? "Done" : "Open again");
    return render();
  }
  if (act === "arr-read") {
    const a = takeArrived(id);
    STATE.hands.push({ id: `h${nextId++}`, kind: "paper", paper: a.paper, at: "p. 1", app: "VS Code" });
    Object.assign(STATE.papers[a.paper], { status: "Reading", inLibrary: true });
    toast(`${paperName(a.paper)} is in your hands · opening at p. 1`);
    return render();
  }
  if (act === "arr-schedule") { DESK.menu = DESK.menu === id ? null : id; return render(); }
  if (act === "arr-when") return scheduleArrived(id, +el.dataset.due);
  if (act === "arr-library") { const a = takeArrived(id); STATE.papers[a.paper].inLibrary = true; toast(`${paperName(a.paper)} added to the Library · Unread`); return render(); }
  if (act === "arr-done") { takeArrived(id); toast(el.dataset.msg); return render(); }
  if (act === "arr-discover") { takeArrived(id); return go("discover"); }
  if (act === "arr-dismiss") { takeArrived(id); toast("Dismissed"); return render(); }
}

function saveDeskDraft() {
  const text = DESK.draft.trim();
  if (!text) return;
  const effects = parseCommands(asCommand(text));
  if (effects.some((e) => e.kind === "warn")) return toast(effects.find((e) => e.kind === "warn").label);
  const { summary } = applyEffects(effects);
  DESK.draft = "";
  toast(summary);
  render();
  document.getElementById("dk-input")?.focus();
}

document.addEventListener("input", (e) => {
  if (e.target.id !== "dk-input") return;
  DESK.draft = e.target.value;
  const box = document.getElementById("dk-preview");
  box.innerHTML = deskPreview(); hydrateIcons(box);
});
document.addEventListener("change", (e) => {
  if (!e.target.dataset.pick || !e.target.value) return;
  const [, mon, day] = e.target.value.split("-").map(Number);
  scheduleArrived(e.target.dataset.pick, (mon === 10 ? 0 : mon === 11 ? 31 : 61) + day);
});
document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.id === "dk-input") saveDeskDraft(); });
