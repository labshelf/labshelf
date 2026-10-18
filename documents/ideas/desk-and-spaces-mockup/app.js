// Routes between the Desk and the Space tabs by hash, delegates clicks to each view, and shows toasts. Mockup only.
const VIEWS = { desk: renderDesk, overview: renderOverview, notebook: renderNotebook, discover: renderDiscover, glossary: renderGlossary };
const ACTIONS = { desk: deskAction, overview: overviewAction, notebook: notebookAction, discover: discoverAction, glossary: glossaryAction };
const TITLES = { desk: "Desk", overview: "Thesis — chapter 3", notebook: "Notebook · Thesis — chapter 3", discover: "Discover · Thesis — chapter 3", glossary: "Glossary · Thesis — chapter 3" };
let current = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : "overview";

function go(view) { current = view; location.hash = view; render(); document.getElementById("view").scrollTop = 0; }

function render() {
  VIEWS[current](document.getElementById("view"));
  document.querySelectorAll(".vs-sidebar .nav").forEach((n) => n.classList.toggle("sel", n.dataset.view === current));
  const dueToday = STATE.commitments.filter((c) => !c.done && c.kind !== "deadline" && bucketOf(c.due) === "today").length;
  document.getElementById("side-desk-count").textContent = deskCount();
  document.getElementById("side-nb-count").textContent = STATE.entries.length;
  document.getElementById("status-desk").textContent = `Desk: ${STATE.arrived.length} arrived · ${dueToday} due today`;
  document.getElementById("tab-title").textContent = TITLES[current];
  hydrateIcons();
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("on");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("on"), 2600);
}

function sharedAction(act, el) {
  if (act === "toast") return toast(el.dataset.msg), true;
  if (act === "capture") return openCapture(), true;
  if (act === "open-entry") { Object.assign(NB, { selected: el.dataset.id, editing: false }); go("notebook"); return true; }
  if (act === "mention") {
    const n = el.dataset.name;
    toast(STATE.files[n] ? `Opens ${STATE.files[n].title}` : STATE.papers[n] ? `Opens ${STATE.papers[n].title} in the Library` : `@${n}`);
    return true;
  }
  return false;
}

document.addEventListener("click", (e) => {
  const nav = e.target.closest(".nav");
  if (nav) return go(nav.dataset.view);
  const el = e.target.closest("[data-act]");
  if (!el || sharedAction(el.dataset.act, el)) return;
  ACTIONS[current](el.dataset.act, el);
});

render();
