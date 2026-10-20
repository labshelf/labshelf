// Renders the shared Space heading.
const SPACE_TABS = [["overview", "Overview", "layers"], ["notebook", "Notebook", "note"], ["discover", "Discover", "search"], ["glossary", "Glossary", "book"]];
function spaceHeader(tab) {
  return `<header class="sp-head">
    <div class="grow"><div class="sp-kicker">Spaces / Thesis</div><h1 class="sp-name">${STATE.space.name}</h1>
      <p class="sp-purpose">How conservative estimates make offline learning reliable.</p></div>
    <button class="ls-btn ls-btn-ghost" data-act="share-space">Share ${icon("external")}</button>
  </header>
  <div class="sp-tab-row"><nav class="sp-tabs" aria-label="Space views">${SPACE_TABS.map(([id, label]) =>
    `<button class="sp-tab nav ${id === tab ? "on" : ""}" ${id === tab ? 'aria-current="page"' : ""} data-view="${id}">${label}</button>`).join("")}</nav>
    <span class="sp-meta">${STATE.space.projects.length} projects · ${STATE.space.paperCount} papers</span></div>`;
}
