// Renders the Notebook tab: a dated log whose command lines show where they went and whether they are done. Mockup only.
const NB = { selected: "e1", editing: false, kind: "Meeting" };
const NB_DRAFT = `Ana says @D4RL medium-replay numbers in @§3.4 should use 5 seeds.
Decided: report IQL as a baseline in @§3.2.
read @IQL by Fri
todo thesis-ch3: rerun medium-replay with 5 seeds by 25 Oct
msg thesis-ch3: seeds changed to 5, see @§3.4
? Does it normalise scores per task @D4RL`;

const mentionsOf = (e) => mentionsIn(e.body.join(" "));

function renderNotebook(view) {
  const e = entryById(NB.selected);
  const month = (m) => STATE.entries.filter((x) => x.date.endsWith(m)).map(logItem).join("");
  view.innerHTML = `
  <div class="space nb-wrap">${spaceHeader("notebook")}
  <div class="nb">
    <aside class="nb-log">
      <div class="nb-log-head"><span class="t">Entries</span><button class="ls-btn ls-button-soft md" data-act="nb-new"><span data-i="plus"></span>Entry</button></div>
      <div class="nb-month">October 2026</div>${month("Oct")}
      <div class="nb-month">September 2026</div>${month("Sep")}
    </aside>
    <section class="nb-page">${NB.editing ? renderEditor() : renderEntry(e)}</section>
  </div></div>`;
}

function logItem(x) {
  const n = Object.keys(x.links).length;
  return `<button class="nb-item ${x.id === NB.selected && !NB.editing ? "on" : ""}" data-act="nb-select" data-id="${x.id}">
    <span class="nb-date">${x.date.split(" ")[0]}</span>
    <span class="nb-item-main"><span class="nb-kind k-${x.kind}">${x.kind === "Meeting" ? "MTG" : "IDEA"}</span> ${x.title}
    <span class="nb-with">${[x.with && `with ${x.with}`, n && `${n} commitment${n > 1 ? "s" : ""}`].filter(Boolean).join(" · ")}</span></span></button>`;
}

// One rendered line per body line; command lines show their destination and live state.
function renderLine(e, line, i) {
  const fx = parseCommands(line).find((x) => x.kind !== "backlink");
  if (!fx) return `<p class="nb-line">${inline(line)}</p>`;
  if (fx.kind === "decided") return `<div class="nb-line decided"><span data-i="check"></span><span><b>Decided</b> ${inline(fx.text)}</span></div>`;
  if (fx.kind === "ask") return `<div class="nb-line cmd">${tag("ask")}<span class="nb-cmd-text">${inline(line.slice(1).trim())}?</span>
    <span class="nb-went"><button class="src-link" data-act="toast" data-msg="Opens ${paperName(fx.paper)} with its Ledger">on ${paperName(fx.paper)}'s Ledger</button></span></div>`;
  if (fx.kind === "msg") return `<div class="nb-line cmd">${tag("msg")}<span class="nb-cmd-text">${inline(fx.text)}</span>
    <span class="nb-went">posted to ${fx.project} activity${fx.anchor ? ` · at ${fx.anchor}` : ""}</span></div>`;
  if (fx.kind === "warn") return `<p class="nb-line">${inline(line)}</p>`;
  const c = STATE.commitments.find((x) => x.id === e.links[i]);
  const went = fx.kind === "todo" ? `${fx.project} Checklist · on the Desk` : fx.kind === "read" ? `${paperName(fx.paper)} set to Reading · on the Desk` : "on your Desk";
  const state = !c ? "" : c.done ? `<span class="nb-state ok">done</span>` : `<span class="nb-state ${c.due < TODAY ? "late" : ""}">open · ${relDay(c.due)}</span>`;
  return `<div class="nb-line cmd ${c?.done ? "done" : ""}">${c ? `<input type="checkbox" class="sch-check" data-act="tick" data-id="${c.id}" ${c.done ? "checked" : ""} aria-label="Done">` : ""}${tag(fx.kind)}
    <span class="nb-cmd-text">${fx.kind === "read" ? "Read " : ""}${inline(fx.text)}</span><span class="nb-went">${went} ${state}</span></div>`;
}

function renderEntry(e) {
  const ms = mentionsOf(e);
  const related = STATE.entries.filter((x) => x !== e && mentionsOf(x).some((m) => ms.includes(m)));
  return `
  <div class="nb-kicker">${e.kind} · ${e.date} 2026${e.with ? ` · with ${e.with}` : ""}<span class="sp"></span>
    <button class="ls-btn ls-btn-ghost md" data-act="toast" data-msg="Copies a link to this entry, to paste in the lab chat"><span data-i="link"></span>Copy link</button></div>
  <h1 class="nb-title">${e.title}</h1>
  <div class="nb-body">${e.body.map((l, i) => renderLine(e, l, i)).join("")}</div>

  <div class="block-head"><span class="block-title">Mentioned here</span><span class="block-count">${ms.length}</span><span class="block-hint">each one shows this entry in its own backlinks</span></div>
  <div class="nb-links">${ms.map((m) => {
    const p = STATE.papers[m];
    const f = STATE.files[m];
    return `<div class="nb-link" data-act="mention" data-name="${m}">
      ${f ? '<span class="ft tex">TEX</span>' : arc(p?.status === "Reading" ? "half" : p?.status === "Done" ? "full" : "none")}
      <span class="nb-link-title">${p?.title || f?.title || m}</span>
      <span class="nb-link-state">${p ? (p.inLibrary ? p.status : "not in the Library") : ""}</span></div>`;
  }).join("")}</div>

  ${related.length ? `<div class="block-head"><span class="block-title">Earlier on the same papers</span></div>
  <div class="nb-thread">${related.map((r) => `<button class="nb-thread-item" data-act="nb-select" data-id="${r.id}"><span class="nb-date">${r.date}</span><span><b>${r.title}</b> — ${plain(r.body[0])}</span></button>`).join("")}</div>` : ""}`;
}

function renderEditor() {
  return `
  <div class="nb-kicker">New entry · 18 Oct 2026</div>
  <div class="nb-kind-pick">
    ${["Meeting", "Idea"].map((k) => `<button class="ls-btn ${NB.kind === k ? "ls-button-soft" : "ls-btn-ghost"} md" data-act="nb-kind" data-kind="${k}">${k}</button>`).join("")}
    <input class="nb-with-input" id="nb-with" placeholder="with… (Ana, Pedro)">
  </div>
  <input class="nb-title-input" id="nb-title" placeholder="Title" value="Lab meeting">
  <textarea id="nb-text" class="nb-text" spellcheck="false">${NB_DRAFT}</textarea>
  <div class="cmd-hint">${COMMAND_HINT}</div>
  <div class="block-head"><span class="block-title">This will…</span></div>
  <div class="nb-effects" id="nb-effects">${renderPreview(parseCommands(NB_DRAFT))}</div>
  <div class="takeoff"><span class="why">${ONCE_HINT} Entries are dated and never rewritten; a new entry links back instead.</span>
    <button class="ls-btn ls-btn-ghost md" data-act="nb-cancel">Cancel</button><button class="ls-btn ls-btn-primary md" data-act="nb-save">Save entry</button></div>`;
}

function notebookAction(act, el) {
  if (act === "nb-select") { NB.selected = el.dataset.id; NB.editing = false; return render(); }
  if (act === "nb-new") { NB.editing = true; return render(); }
  if (act === "nb-cancel") { NB.editing = false; return render(); }
  if (act === "nb-kind") { NB.kind = el.dataset.kind; document.querySelectorAll("[data-act=nb-kind]").forEach((b) => { b.classList.toggle("ls-button-soft", b === el); b.classList.toggle("ls-btn-ghost", b !== el); }); return; }
  if (act === "tick") { toggleCommitment(el.dataset.id); return render(); }
  if (act === "nb-save") {
    const body = document.getElementById("nb-text").value.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!body.length) return;
    const entry = { id: `n${nextId++}`, kind: NB.kind, date: "18 Oct", title: document.getElementById("nb-title").value || "Entry", with: document.getElementById("nb-with").value, body, links: {} };
    const { links, summary } = applyEffects(parseCommands(body.join("\n")), entry.id);
    entry.links = links;
    STATE.entries.unshift(entry);
    Object.assign(NB, { selected: entry.id, editing: false });
    toast(summary);
    return render();
  }
}

document.addEventListener("input", (e) => {
  if (e.target.id !== "nb-text") return;
  const box = document.getElementById("nb-effects");
  box.innerHTML = renderPreview(parseCommands(e.target.value)); hydrateIcons(box);
});
