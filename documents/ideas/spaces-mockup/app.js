// Holds which editor tabs are open and repaints the editor area and the Spaces section on every change. Mockup only.
const APP = {
  tabs: [{ kind: "space", id: "research" }],
  active: "space:research",
  view: {},
  folder: {},
};
const tabKey = (t) => `${t.kind}:${t.id}`;
const activeTab = () => APP.tabs.find((t) => tabKey(t) === APP.active);

// Every render rebuilds the panel, so the focused field and its caret are carried over by id.
function render({ keepScroll = true } = {}) {
  const panel = document.getElementById("panel");
  const scroll = keepScroll ? panel.scrollTop : 0;
  const focused = panel.contains(document.activeElement) ? document.activeElement : null;
  const caret = focused?.id && focused.selectionStart !== undefined ? focused.selectionStart : null;
  document.getElementById("tabs").innerHTML = tabStrip();
  const tab = activeTab();
  panel.innerHTML = !tab ? emptyState("No editor is open.", "Open a Space or a project from the sidebar.")
    : tab.kind === "space" ? renderSpace(spaceById(tab.id)) : renderProject(tab.id);
  panel.scrollTop = scroll;
  const again = focused?.id && document.getElementById(focused.id);
  if (again) { again.focus(); if (caret !== null) again.setSelectionRange(caret, caret); }
  renderSpacesSection();
}

function openTab(kind, id) {
  if (!APP.tabs.some((t) => t.kind === kind && t.id === id)) APP.tabs.push({ kind, id });
  APP.active = `${kind}:${id}`;
  render({ keepScroll: false });
}

function openSpace(id, view = "overview", folder = null) {
  APP.view[id] = view;
  APP.folder[id] = folder;
  openTab("space", id);
}

const openProject = (id) => openTab("project", id);

// tokens.css is dark by default and switches on data-theme="light"; the button shows the theme it switches to.
const paintThemeButton = () => { document.getElementById("theme-btn").innerHTML = icon(document.documentElement.dataset.theme === "light" ? "moon" : "sun"); };
ACTIONS.theme = () => {
  const root = document.documentElement;
  root.dataset.theme = root.dataset.theme === "light" ? "dark" : "light";
  paintThemeButton();
};

document.getElementById("side-logo").innerHTML = icon("logo");
mountLibraryTree();
paintThemeButton();
render();
