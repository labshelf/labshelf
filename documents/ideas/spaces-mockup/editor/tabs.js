// Builds the editor tab strip, one tab per open Space or project, and switches and closes tabs. Mockup only.
function tabLabel(t) {
  if (t.kind === "catalog") return "All Spaces";
  return t.kind === "space" ? spaceById(t.id).name : `${PROJECTS[t.id].file.split("/").pop()} · ${t.id}`;
}

function tabStrip() {
  return APP.tabs.map((t) => {
    const key = tabKey(t);
    const on = key === APP.active;
    const label = esc(tabLabel(t));
    const lead = t.kind === "project" ? formatTag(PROJECTS[t.id].format) : icon("space");
    return `<div class="ls-editor-tab${on ? " active" : ""}" role="tab" aria-selected="${on}" tabindex="0" data-act="tab" data-key="${key}" title="${label}">
      <span class="ls-editor-tab-icon">${lead}</span><span class="ls-editor-tab-label">${label}</span>
      <button class="ls-editor-tab-close" data-act="tab-close" data-key="${key}" aria-label="Close ${label}" title="Close">${icon("x")}</button></div>`;
  }).join("");
}

ACTIONS.tab = (el) => { APP.active = el.dataset.key; render({ keepScroll: false }); };

ACTIONS["tab-close"] = (el) => {
  const at = APP.tabs.findIndex((t) => tabKey(t) === el.dataset.key);
  APP.tabs.splice(at, 1);
  if (APP.active === el.dataset.key) APP.active = APP.tabs[Math.max(0, at - 1)] ? tabKey(APP.tabs[Math.max(0, at - 1)]) : null;
  render({ keepScroll: false });
};
