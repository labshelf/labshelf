// Renders the Spaces section under the core sidebar with the core tree markup: Spaces, their own folders and the papers they refer to. Mockup only.
const SPACES_TREE = { open: true, expanded: new Set(["research", "course", "research/baselines", "course/sources"]) };

const treeRow = (key, depth, { current = false, open, act, attrs = "", title = "" }, inner) =>
  `<div class="tree-row${current ? " current" : ""}${open === false ? " collapsed" : ""}" role="treeitem" tabindex="0" style="--depth:${depth}"
    data-key="${key}" data-act="${act}" ${open === undefined ? "" : `aria-expanded="${open}"`} ${current ? 'aria-current="true"' : ""} ${attrs} title="${esc(title)}">${inner}</div>`;

const twisty = (leaf = false) => `<span class="tree-twisty${leaf ? " leaf" : ""}">${icon("chevron-down")}</span>`;

function currentOf(s) {
  const tab = activeTab();
  if (tab?.kind !== "space" || tab.id !== s.id) return { space: false, folder: null };
  const folder = APP.view[s.id] === "papers" ? APP.folder[s.id] : null;
  return { space: !folder, folder };
}

function spaceRows(s) {
  const open = SPACES_TREE.expanded.has(s.id);
  const cur = currentOf(s);
  const shared = s.members.length > 1 ? `Shared with ${s.members.filter(([w]) => w !== "you").map(([w]) => PEOPLE[w].name).join(", ")}` : "Personal";
  let html = treeRow(`space:${s.id}`, 0, { current: cur.space, open, act: "side-space", attrs: `data-id="${s.id}"`, title: `${s.name}\n${shared}` },
    `${twisty()}<span class="tree-icon">${icon("space")}</span><span class="tree-label">${esc(s.name)}</span><span class="tree-count">${spacePapers(s).length}</span>`);
  if (!open) return html;
  for (const f of s.folders) {
    const key = `${s.id}/${f.id}`;
    const fOpen = SPACES_TREE.expanded.has(key);
    html += treeRow(`space-folder:${key}`, 1, { current: cur.folder === f.id, open: fOpen, act: "side-folder", attrs: `data-space="${s.id}" data-folder="${f.id}"`, title: `${f.name} · ${s.name}` },
      `${twisty()}<span class="tree-label">${esc(f.name)}</span><span class="tree-count">${f.papers.length}</span>`);
    if (fOpen) html += f.papers.map(([id]) => treeRow(`space-paper:${key}/${id}`, 2, { act: "side-paper", attrs: `data-id="${id}"`, title: PAPERS[id].title },
      `${twisty(true)}<span class="tree-ref">REF</span><span class="tree-label">${esc(PAPERS[id].title)}</span>`)).join("");
  }
  return html;
}

function renderSpacesSection() {
  const open = SPACES_TREE.open;
  document.getElementById("spaces-tree").innerHTML = `<div class="tree-pane${open ? " open" : ""}" data-pane="spaces">
    <div class="tree-heading tree-section" role="treeitem" tabindex="0" aria-expanded="${open}" data-act="side-section">
      <span class="tree-section-chevron">${icon("chevron-right")}</span><span class="tree-section-label">Spaces</span>
      <span class="tree-heading-actions"><button class="ls-icon-btn" data-act="toast" data-msg="Creates a Space with a name; papers, folders and members come later." title="New Space" aria-label="New Space">${icon("plus")}</button></span>
    </div>
    <div class="tree-pane-body" role="group">${open ? SPACES.map(spaceRows).join("") : ""}</div></div>`;
}

const toggleExpanded = (key) => { if (SPACES_TREE.expanded.has(key)) SPACES_TREE.expanded.delete(key); else SPACES_TREE.expanded.add(key); };

ACTIONS["side-section"] = () => { SPACES_TREE.open = !SPACES_TREE.open; renderSpacesSection(); };

// As in the core tree, the twisty only folds; the rest of the row opens.
ACTIONS["side-space"] = (el, e) => {
  if (e.target.closest(".tree-twisty")) { toggleExpanded(el.dataset.id); return renderSpacesSection(); }
  SPACES_TREE.expanded.add(el.dataset.id);
  openSpace(el.dataset.id);
};

ACTIONS["side-folder"] = (el, e) => {
  const key = `${el.dataset.space}/${el.dataset.folder}`;
  if (e.target.closest(".tree-twisty")) { toggleExpanded(key); return renderSpacesSection(); }
  openSpace(el.dataset.space, "papers", el.dataset.folder);
};

ACTIONS["side-paper"] = (el) => {
  LIBRARY_TREE.setSelected(el.dataset.id);
  CoreUI.toast(whereIs(el.dataset.id));
};
