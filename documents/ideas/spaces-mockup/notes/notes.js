// Renders the Notes tab: Space notes and paper notes, and the open note, beside its PDF when it is a paper note. Mockup only.
// `selection` is the passage selected on the PDF page; Add to note and Highlight consume it.
const NOTE_STATE = { open: {}, quotes: [], flash: false, selection: true, highlighted: false };

function noteRow(n) {
  const sharing = n.kind === "space" ? "" : n.shared ? `<span class="nt-badge">Shared</span>` : `<span class="nt-badge personal">Personal</span>`;
  return `<li><button class="nt-row" data-act="note-open" data-id="${n.id}">
    <span class="nt-row-icon">${icon(n.kind === "paper" ? "file-text" : "note")}</span>
    <span class="ov-main"><span class="ov-name">${esc(noteTitle(n))}</span><span class="ov-sub">${n.kind === "paper" ? esc(PAPERS[n.paper].title) : "Space note"}</span></span>
    ${sharing}<span class="nt-who">${avatar(n.owner)}${n.edited}</span></button></li>`;
}

function noteList(s) {
  const notes = NOTES.filter((n) => n.spaces.includes(s.id));
  const add = `<button class="ls-btn ls-btn-primary" data-act="toast" data-msg="Creates a Space note that every member can edit.">${icon("plus")}New note</button>`;
  if (!notes.length) return `<div class="pp-bar"><span class="muted">Meeting notes, ideas and comparisons for this Space.</span>${add}</div>
    ${emptyState("No notes yet.", "Create a Space note, or open a paper and write its paper note beside the PDF.")}`;
  const group = (kind, title) => `<section class="nt-group"><h2 class="pp-group-head">${title}</h2>
    <ul class="ov-list">${notes.filter((n) => n.kind === kind).map(noteRow).join("") || `<li>${emptyState("None yet.")}</li>`}</ul></section>`;
  return `<div class="pp-bar"><span class="muted">Notes keep text, quotes, tables, equations and code. Paper notes are personal until you share them.</span>${add}</div>
    ${group("space", "Space notes")}${group("paper", "Paper notes")}`;
}

function noteHead(s, n) {
  const share = n.kind !== "paper" ? `<span class="nt-badge">Space note · ${PEOPLE[n.owner].name}</span>`
    : n.shared ? `<span class="nt-badge">Shared in ${esc(s.name)}</span>`
    : `<button class="ls-btn ls-button-soft" data-act="note-share" data-id="${n.id}">${icon("share")}Share in Space</button>`;
  return `<div class="nt-head"><button class="ls-btn ls-btn-ghost" data-act="note-back">${icon("arrow-left")}All notes</button>
    <h2 class="nt-title">${esc(noteTitle(n))}</h2><span class="nt-head-side">${n.kind === "paper" ? `<span class="nt-badge personal">Paper note</span>` : ""}${share}</span></div>`;
}

function renderNotes(s) {
  const n = NOTES.find((x) => x.id === NOTE_STATE.open[s.id] && x.spaces.includes(s.id));
  if (!n) return noteList(s);
  if (n.id === "dropout") return `${noteHead(s, n)}<div class="nt-split">${paperPage()}${dropoutNote()}</div>`;
  return `${noteHead(s, n)}<article class="nt-doc">${n.body.map((t) => `<p>${esc(t)}</p>`).join("")}</article>`;
}

ACTIONS["note-open"] = (el) => { NOTE_STATE.open[activeTab().id] = el.dataset.id; render({ keepScroll: false }); };
ACTIONS["note-back"] = () => { NOTE_STATE.open[activeTab().id] = null; render({ keepScroll: false }); };

ACTIONS["note-share"] = (el) => {
  const n = NOTES.find((x) => x.id === el.dataset.id);
  const s = spaceById(activeTab().id);
  n.shared = true;
  CoreUI.toast(`${noteTitle(n)} note is shared in ${s.name}. Members see it in Notes.`, "ok");
  render();
};

ACTIONS["note-add-quote"] = () => {
  NOTE_STATE.quotes.push("…for the input units, however, the optimal probability of retention is usually closer to 1 than to 0.5.");
  NOTE_STATE.selection = false;
  CoreUI.toast("Added to the note as a quote with a link to p. 5.", "ok");
  render();
};

ACTIONS["note-select"] = () => { NOTE_STATE.selection = true; render(); };
ACTIONS["note-copy"] = () => CoreUI.toast("Copied the passage with a labshelf: link to p. 5.");
ACTIONS["note-highlight"] = () => {
  Object.assign(NOTE_STATE, { highlighted: true, selection: false });
  CoreUI.toast("Highlighted. Highlights stay personal until you share them in the Space.");
  render();
};

ACTIONS["note-view-pdf"] = () => {
  NOTE_STATE.flash = true;
  render();
  NOTE_STATE.flash = false;
  CoreUI.toast("Shows p. 5 with the quoted passage highlighted.");
};

ACTIONS["note-run"] = () => CoreUI.toast("Running a code cell needs Quarto, and it is not installed. Install Quarto and Python with pandas and matplotlib, then run the cell again. The note stays fully editable without it.", "error");
