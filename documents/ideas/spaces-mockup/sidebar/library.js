// Mounts the core library sidebar on the sample Library and Projects; its actions toast or open mockup tabs. Mockup only.
let LIBRARY_TREE;

const libraryPapers = () => Object.entries(PAPERS).map(([id, p]) =>
  ({ record: { id, title: p.title, status: p.status, tags: p.tags }, folder: `papers/${p.folder}` }));

// Names the Spaces that refer to a paper, so its single Library copy is visible.
function whereIs(id) {
  const spaces = SPACES.filter((s) => spacePapers(s).some((p) => p.id === id)).map((s) => s.name);
  return `${paperShort(id)} is in the Library folder ${PAPERS[id].folder}${spaces.length ? ` and in ${spaces.join(" and ")}` : ""}.`;
}

function mountLibraryTree() {
  const outside = () => CoreUI.toast("This Projects action is outside the mockup.");
  const projectActs = ["menu", "browseTemplates", "allProjects", "newBlank", "addExisting", "joinShared", "newFolder", "renameFolder",
    "deleteFolder", "refresh", "closeProject", "openProjectMenu", "treeAction", "treeClick", "treeToggle", "treeCheck", "treeMenu", "treeAdd"];
  const projects = { ...Object.fromEntries(projectActs.map((n) => [n, outside])), open: (id) => openProject(id) };
  const actions = {
    openFolder: (path) => CoreUI.toast(`Opens the Library list at ${path === "papers" ? "All papers" : path.slice(7)}.`),
    revealPaper: (id) => CoreUI.toast(whereIs(id)),
    createFolder: () => CoreUI.toast("Creates a Library folder."),
    renameFolder: () => CoreUI.toast("Renames the Library folder."),
    removeFolder: () => CoreUI.toast("Deletes the Library folder."),
    searchTag: (tag) => CoreUI.toast(tag ? `Shows the papers tagged ${tag}.` : "Clears the tag search."),
  };
  LIBRARY_TREE = CoreUI.mountLibrarySidebar(document.getElementById("library-tree"),
    { actions, expanded: ["papers/Regularization"], saveExpanded() {}, collapsed: ["library.tags"], saveCollapsed() {}, projects });
  refreshLibraryTree();
  LIBRARY_TREE.setProjects(Object.values(PROJECTS).map((p) => ({ id: p.name, name: p.name, format: p.format, tooltip: `${p.name}\n${p.main}` })));
}

const refreshLibraryTree = () => LIBRARY_TREE.setLibrary(LIBRARY_FOLDERS.map((n) => ({ name: n, path: `papers/${n}`, children: [] })), libraryPapers());
