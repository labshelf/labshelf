// Parses the one command language (desk:, read, todo, msg, ?, Decided:, @mentions) into effects and renders the "This will…" preview. Mockup only.
const MENTION_RE = /@([\w.§+-]*[\w§+])/g;
const mentionsIn = (text) => [...new Set([...text.matchAll(MENTION_RE)].map((m) => m[1]))];
const plain = (text) => text.replace(/@/g, "");
const projectNames = () => STATE.space.projects.map((p) => p.name);
const paperName = (k) => STATE.papers[k]?.short || k;

// Splits a trailing "by <date>" (or, for desk:, a bare trailing date word) off the text.
function splitDue(text, allowBare) {
  const by = text.match(/^(.*?)\s+by\s+(.+)$/i);
  if (by && parseDate(by[2]) != null) return [by[1].trim(), parseDate(by[2])];
  const bare = allowBare && text.match(/^(.*?)\s+(today|tomorrow|mon|tue|wed|thu|fri|sat|sun)$/i);
  if (bare) return [bare[1].trim(), parseDate(bare[2])];
  return [text.trim(), null];
}

function deskWhere(due) { return `Desk · ${BUCKET_LABEL[bucketOf(due)]}`; }

function parseLine(line, i) {
  let m;
  if ((m = line.match(/^desk:\s*(.+)$/i))) {
    const [text, due] = splitDue(m[1], true);
    return [{ kind: "desk", icon: "target", label: `Put “${plain(text)}” on your Desk`, target: deskWhere(due), due, line: i, text: text[0].toUpperCase() + text.slice(1) }];
  }
  if ((m = line.match(/^read\s+(.+)$/i))) {
    const [text, due] = splitDue(m[1], false);
    const paper = mentionsIn(text).find((k) => STATE.papers[k]);
    if (!paper) return [{ kind: "warn", icon: "warning", label: "read needs a paper: write read @Paper by <date>", line: i }];
    const lib = STATE.papers[paper].inLibrary ? "" : " · adds it to the Library";
    return [{ kind: "read", icon: "book-open", label: `Set ${paperName(paper)} to Reading${lib}`, target: deskWhere(due), due, line: i, text, paper }];
  }
  if ((m = line.match(/^todo\s+([\w-]+):\s*(.+)$/i))) {
    if (!projectNames().includes(m[1])) return [{ kind: "warn", icon: "warning", label: `No project called ${m[1]} in this Space`, line: i }];
    const [text, due] = splitDue(m[2], false);
    return [{ kind: "todo", icon: "check", label: `Add “${plain(text)}” to the ${m[1]} Checklist`, target: `mirrored on ${deskWhere(due)}`, due, line: i, text: text[0].toUpperCase() + text.slice(1), project: m[1] }];
  }
  if ((m = line.match(/^msg\s+([\w-]+):\s*(.+)$/i))) {
    if (!projectNames().includes(m[1])) return [{ kind: "warn", icon: "warning", label: `No project called ${m[1]} in this Space`, line: i }];
    const anchor = mentionsIn(m[2]).find((k) => STATE.files[k]);
    return [{ kind: "msg", icon: "message", label: `Post to the ${m[1]} activity`, target: anchor ? `anchored to ${anchor}` : "not anchored: add @§x.y or @file", due: null, line: i, text: m[2], project: m[1], anchor }];
  }
  if ((m = line.match(/^\?\s*(.+)$/))) {
    const paper = mentionsIn(m[1]).find((k) => STATE.papers[k]);
    const q = `${plain(m[1].replace(`@${paper}`, "")).replace(/\s+/g, " ").trim().replace(/\?*$/, "")}?`;
    if (!paper) return [{ kind: "warn", icon: "warning", label: "A question needs a paper: add @Paper so it lands on its Ledger", line: i }];
    return [{ kind: "ask", icon: "help", label: `Add “${q}” to ${paperName(paper)}'s Ledger`, target: "asked on the paper, not on the Desk", due: null, line: i, text: q, paper }];
  }
  if ((m = line.match(/^decided:\s*(.+)$/i))) {
    return [{ kind: "decided", icon: "check", label: `Record a decision: ${plain(m[1])}`, target: "", due: null, line: i, text: m[1] }, ...backlinks(m[1], i)];
  }
  return backlinks(line, i);
}

const backlinks = (text, i) => mentionsIn(text).map((k) => ({ kind: "backlink", icon: "link", label: `Backlink on ${STATE.papers[k]?.title || STATE.files[k]?.title || k}`, target: "", due: null, line: i, name: k }));

function parseCommands(text) {
  const seen = new Set();
  return text.split("\n").map((l) => l.trim()).flatMap((l, i) => (l ? parseLine(l, i) : []))
    .filter((e) => e.kind !== "backlink" || (!seen.has(e.name) && seen.add(e.name)));
}

// Renders @mentions as links; papers open in the Library, files and sections in the editor.
const inline = (text) => text.replace(MENTION_RE, (_, n) => `<button class="mention-link ${STATE.files[n] ? "file" : ""}" data-act="mention" data-name="${n}">@${n}</button>`);

const TAG = { desk: "DESK", read: "READ", todo: "TODO", msg: "MSG", ask: "ASK", decided: "DONE", backlink: "LINK", warn: "FIX", deadline: "DUE" };
const tag = (kind) => `<span class="cmd-tag t-${kind}">${TAG[kind]}</span>`;

function renderPreview(effects, emptyText = "Nothing yet: plain text is kept as written.") {
  if (!effects.length) return `<div class="cmd-empty">${emptyText}</div>`;
  const ordered = [...effects.filter((e) => e.kind !== "backlink"), ...effects.filter((e) => e.kind === "backlink")];
  return `<ul class="cmd-preview">${ordered.map((e) => `
    <li class="k-${e.kind}">${tag(e.kind)}<span class="cmd-label">${e.label}</span>
      ${e.target ? `<span class="cmd-target">${e.target}</span>` : ""}
      ${e.due != null ? `<span class="cmd-due"><span data-i="calendar"></span>${fmtDay(e.due)}</span>` : ""}</li>`).join("")}</ul>`;
}

const COMMAND_HINT = `<span><b>desk:</b> on your Desk</span><span><b>read</b> @Paper by Fri</span><span><b>todo</b> project: … by 25 Oct</span>
  <span><b>msg</b> project: … @§3.2</span><span><b>?</b> … @Paper</span><span><b>Decided:</b></span><span><b>@</b> backlink</span>`;
const ONCE_HINT = "Commands act once, when you save, and only for you.";
