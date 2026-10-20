// Renders a project tab: a mock source editor beside the Insert panel, and inserts items at the cursor with their provenance. Mockup only.
// `cursor` is the line index inserts go before; `fresh` marks the lines of the last insert.
const EDITS = {};
const editsOf = (id) => (EDITS[id] ??= { lines: [...PROJECT_LINES[id]], cursor: PROJECT_LINES[id].length, fresh: new Set() });

function editorLine(line, i, e) {
  const src = line.match(/^(?:%|\/\/) LabShelf: (\S+)/)?.[1];
  const lens = src ? `<button class="ed-lens" data-act="ins-reveal" data-src="${esc(src)}">Reveal source</button>` : "";
  const caret = i === e.cursor - 1 ? '<span class="caret"></span>' : "";
  return `<div class="ed-line${e.fresh.has(i) ? " fresh" : ""}"><span class="ln">${i + 1}</span><span class="ed-text">${highlightLine(line) || "&nbsp;"}${caret}</span>${lens}</div>`;
}

function renderProject(id) {
  const p = PROJECTS[id];
  const e = editsOf(id);
  const space = spacesOfProject(id)[0];
  const crumbs = `${p.name} › ${p.file.split("/").join(" › ")}`;
  return `<div class="pj">
    <section class="pj-editor" aria-label="${esc(p.file)}"><div class="pj-crumbs">${formatTag(p.format)}<span>${esc(crumbs)}</span>
        ${space ? `<button class="pj-space" data-act="pj-space" data-id="${space.id}">${icon("space")}${esc(space.name)}</button>` : `<span class="muted">Not in a Space</span>`}</div>
      <div class="ed-code" role="textbox" aria-readonly="true" aria-label="Source">${e.lines.map((l, i) => editorLine(l, i, e)).join("")}</div></section>
    ${insertPanel(space)}</div>`;
}

ACTIONS["ins-insert"] = (el) => {
  const id = activeTab().id;
  const e = editsOf(id);
  const item = INSERT_ITEMS.find((x) => x.id === el.dataset.id);
  const lines = [...insertLines(item, INS.mode[item.id] ?? "follow", PROJECTS[id].format), ""];
  e.lines.splice(e.cursor, 0, ...lines);
  e.fresh = new Set(lines.slice(0, -1).map((_, k) => e.cursor + k));
  e.cursor += lines.length;
  CoreUI.toast(`Inserted ${item.kind === "citation" ? `\\cite{${item.cite}}` : item.title.slice(0, 48)} with its provenance comment.`, "ok");
  render();
};

ACTIONS["ins-reveal"] = (el) => {
  const src = el.dataset.src;
  const where = src.startsWith("labshelf:paper/") ? `${paperShort(src.slice(15).split("#")[0])} at its page` : src.includes(".qmd") ? `the note cell ${src.split("#")[1]}` : `the symbol ${src.split("#")[1]}`;
  CoreUI.toast(`Reveal source: opens ${where}.`);
};

ACTIONS["pj-space"] = (el) => openSpace(el.dataset.id);
