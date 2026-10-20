// Applies parsed command effects to the shared state and says what happened. Mockup only.
let nextId = 100;

// Returns { links: line index -> commitment id, summary } so a Notebook entry can show where each line went.
function applyEffects(effects, src = null) {
  const links = {};
  const done = [];
  for (const e of effects) {
    if (e.kind === "desk" || e.kind === "todo" || e.kind === "read") {
      const c = { id: `c${nextId++}`, kind: e.kind, text: e.text, due: e.due, done: false, src, project: e.project, paper: e.paper };
      STATE.commitments.push(c);
      links[e.line] = c.id;
      if (e.paper) Object.assign(STATE.papers[e.paper], { status: "Reading", inLibrary: true });
      done.push(e.kind === "todo" ? `${e.project} Checklist` : `Desk · ${BUCKET_LABEL[bucketOf(e.due)]}`);
    } else if (e.kind === "msg") {
      STATE.activity.unshift({ project: e.project, who: "You", text: plain(e.text), anchor: e.anchor, when: "just now" });
      done.push(`${e.project} activity`);
    } else if (e.kind === "ask") {
      STATE.papers[e.paper].ledger.push(e.text);
      done.push(`${paperName(e.paper)}'s Ledger`);
    } else if (e.kind === "decided") {
      STATE.decisions.push({ text: e.text, src });
      done.push("1 decision");
    }
  }
  const n = effects.filter((e) => e.kind === "backlink").length;
  if (n) done.push(`${n} backlink${n > 1 ? "s" : ""}`);
  return { links, summary: done.length ? `Saved · ${[...new Set(done)].join(" · ")}` : "Saved" };
}

function toggleCommitment(id) {
  const c = STATE.commitments.find((x) => x.id === id);
  c.done = !c.done;
  if (c.kind === "read" && c.done) STATE.papers[c.paper].status = "Done";
  return c;
}

const entryById = (id) => STATE.entries.find((e) => e.id === id);
const sourceLabel = (c) => {
  const e = c.src && entryById(c.src);
  return e ? `<button class="src-link" data-act="open-entry" data-id="${e.id}">from ${e.title}, ${e.date}</button>`
    : c.kind === "deadline" ? `<span class="src-link plain">project deadline</span>` : c.project ? `<span class="src-link plain">added on the Checklist</span>` : `<span class="src-link plain">captured by you</span>`;
};
