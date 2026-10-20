// Routes the mockup between the Desk and Space views.
const VIEWS = { desk: renderDesk, overview: renderOverview, notebook: renderNotebook, discover: renderDiscover, glossary: renderGlossary };
const ACTIONS = { desk: deskAction, overview: overviewAction, notebook: notebookAction, discover: discoverAction, glossary: glossaryAction };
let current = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : "overview";
const toast = (message) => CoreUI.toast(message);

function go(view) {
  current = view;
  location.hash = view;
  render();
  document.getElementById("view").scrollTop = 0;
}

function render() {
  VIEWS[current](document.getElementById("view"));
  document.querySelectorAll(".vs-sidebar .nav").forEach((node) => {
    const selected = node.dataset.view === current;
    node.classList.toggle("sel", selected);
    if (selected) node.setAttribute("aria-current", "page");
    else node.removeAttribute("aria-current");
  });
  document.getElementById("side-desk-count").textContent = deskCount();
  document.getElementById("side-nb-count").textContent = STATE.entries.length;
  document.getElementById("status-desk").textContent = "Session only · sample data";
  hydrateIcons();
}

function sharedAction(act, element) {
  if (act === "toast") return toast(element.dataset.msg), true;
  if (act === "capture") return openCapture(), true;
  if (act === "share-space") return toast("Sharing is illustrative in this mockup."), true;
  if (act === "global-library") { go("overview"); WORK.filter = "papers"; WORK.query = ""; render(); return true; }
  if (act === "global-projects") { go("overview"); WORK.filter = "projects"; WORK.query = ""; render(); return true; }
  if (act === "open-entry") { Object.assign(NB, { selected: element.dataset.id, editing: false }); go("notebook"); return true; }
  if (act === "mention") {
    const name = element.dataset.name;
    if (STATE.papers[name]) { WORK.paper = name; go("overview"); }
    else toast(`Opens ${STATE.files[name]?.title ?? name} in LabShelf.`);
    return true;
  }
  return false;
}

document.addEventListener("click", (event) => {
  const nav = event.target.closest(".nav");
  if (nav) return go(nav.dataset.view);
  const element = event.target.closest("[data-act]");
  if (!element || sharedAction(element.dataset.act, element)) return;
  ACTIONS[current](element.dataset.act, element);
});
window.addEventListener("hashchange", () => {
  const view = location.hash.slice(1);
  if (VIEWS[view] && view !== current) { current = view; render(); }
});
render();
