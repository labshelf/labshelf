// Connects research workspace gestures to core UI components.
function overviewAction(act, element) {
  const id = element.dataset.id;
  if (act === "work-project") { WORK.project = Number(id); WORK.section = STATE.space.projects[WORK.project].sections[0].n; }
  else if (act === "work-section") { WORK.section = id; WORK.general = false; }
  else if (act === "work-paper") WORK.paper = id;
  else if (act === "work-filter") WORK.filter = id;
  else if (act === "browse-papers") { WORK.filter = "papers"; WORK.query = ""; }
  else if (act === "space-chat") WORK.general = !WORK.general;
  else if (act === "context-chat") WORK.general = false;
  else if (act === "add-material") return addMaterialMenu(element);
  else if (act === "attach-paper") return attachPaper();
  else if (act === "edit-draft") return editDraft();
  else if (act === "open-paper") return openPaper();
  else if (act === "cite-passage") return citePassage();
  else return;
  refreshWorkspace();
}

function addMaterialMenu(element) {
  CoreUI.showMenu(element, [
    { label: "Paper from the Library", icon: "file-text", onSelect: addPaper },
    { label: "Project in this Space", icon: "folder", onSelect: async () => {
      const index = await CoreUI.quickPick(STATE.space.projects.map((p, value) => ({ label: p.name, description: p.main, value })), { title: "Open project" });
      if (index === undefined) return;
      WORK.project = index; WORK.section = STATE.space.projects[index].sections[0].n; refreshWorkspace();
    } },
  ]);
}

async function addPaper() {
  const entries = Object.entries(STATE.papers).filter(([key]) => !WORK.papers.includes(key))
    .map(([key, paper]) => ({ label: paper.title, description: paper.authors, icon: "file-text", value: key }));
  if (!entries.length) return toast("All sample papers are already in this Space.");
  const key = await CoreUI.quickPick(entries, { title: "Add a paper to this Space", placeholder: "Search sample papers" });
  if (!key) return;
  WORK.papers.push(key);
  WORK.paper = key;
  WORK.filter = "all";
  WORK.query = "";
  refreshWorkspace();
  toast("Paper linked to this Space for this session.");
}

async function attachPaper() {
  const key = await CoreUI.quickPick(WORK.papers.map((value) => ({ label: STATE.papers[value].title, value })), { title: "Mention a paper" });
  if (!key) return;
  WORK.composers[threadKey()] = `${WORK.composers[threadKey()] ?? ""} @${key} `.trimStart();
  refreshWorkspace();
  document.getElementById("reply-text").focus();
}

async function editDraft() {
  const id = `${WORK.project}:${WORK.section}`;
  const value = await CoreUI.inputBox({ title: `Draft · ${selectedSection().title}`, prompt: "Edits stay in this mockup session.",
    value: WORK.drafts[id] ?? document.querySelector(".draft-passage").firstChild.textContent.trim(), validate: (text) => text.trim() ? null : "Write an argument for this section." });
  if (value === undefined) return;
  WORK.drafts[id] = value;
  refreshWorkspace();
}

function openPaper() {
  const paper = STATE.papers[WORK.paper];
  return CoreUI.showDialog({ title: paper.title, message: "This mockup shows illustrative excerpts. PDF reading is available in the LabShelf apps.",
    severity: "info", buttons: [{ id: "close", label: "Return to workspace", primary: true }] });
}

function citePassage() {
  const key = `${WORK.project}:${WORK.section}`;
  const text = document.querySelector(".draft-passage").firstChild.textContent.trim();
  WORK.drafts[key] = `${text} [${WORK.paper}, p. ${EXCERPTS[WORK.paper].page}]`;
  refreshWorkspace();
  toast("Passage cited in the sample draft.");
}
