// Renders the project chat in VS Code, in the browser and in a Space's Discussions. Every surface shows the same file, so a message sent in one view is in the others.
const { icon } = CoreUI;
const ME = "Luca";
const PEOPLE = { Luca: "#4daafc", Ana: "#e5a33d", Kenji: "#8cc27a", Priya: "#c586c0" };
const PROJECT = { title: "Thermal transport in graphene", file: "projects/thermal-graphene/.labshelf/chat.qmd" };

const CHATS = {
  project: {
    title: "Project chat", where: `${PROJECT.title} · .labshelf/chat.qmd`, online: ["Ana", "Kenji"], typing: "Ana",
    messages: [
      { day: "Yesterday" },
      { author: "Kenji", at: "17:42", body: "Pushed the new phonon figure to <code>figures/dispersion.pdf</code>. Same bytes for everyone." },
      { author: "Luca", at: "18:05", body: "Thanks. I'll cite it in §3.2." },
      { day: "Today" },
      { author: "Ana", at: "09:12", body: "I rewrote the intro of §3. Can someone check that <span class=\"mk-math\">κ = κ<sub>ph</sub> + κ<sub>e</sub></span> still matches eq. (4)?" },
      { author: "Kenji", at: "09:20", body: "It matches. The bib entry for Balandin 2008 is duplicated though.", edited: true },
      { author: "Luca", at: "09:31", body: "Fixed in <code>labshelf.bib</code>, it was two cite keys for one DOI." },
    ],
  },
  space: {
    title: "Space chat", where: "Phonon lab · discussions/_chat.qmd", online: ["Ana", "Kenji", "Priya"], typing: null,
    messages: [
      { day: "Today" },
      { author: "Priya", at: "08:50", body: "Group meeting moves to Thursday 14:00." },
      { author: "Ana", at: "08:58", body: "👍" },
    ],
  },
};

const UI = { view: "vscode", spaceOpen: "project", unreadProject: 2 };

const CAPTIONS = {
  vscode: "VS Code: the chat is a webview view in the secondary side bar, next to Research chat. It appears when the open project is shared; the status bar shows who is online and opens it. One chat per project, not per open file.",
  browser: "Browser: a third pane in the right column, beside Details and Research chat, shown while a shared project is open. A tab that is not the one holding the live share shows the chat read-only, with a button to take over.",
  space: "Space Discussions: a Space that links the project lists its chat under Chats, below the Space chat. Opening it reads and writes the project's own <code>.labshelf/chat.qmd</code>, not a copy, so the Space chat (<code>discussions/_chat.qmd</code>) and each project chat stay separate files.",
};

const h = (strings, ...values) => strings.reduce((out, s, i) => out + s + (values[i] ?? ""), "");
const initials = (name) => name.slice(0, 1);
const avatar = (name) => h`<span class="ds-avatar" style="background:color-mix(in srgb, ${PEOPLE[name]} 35%, var(--ls-bg))">${initials(name)}</span>`;

function renderMessage(m) {
  if (m.day) return h`<div class="ds-day"><span>${m.day}</span></div>`;
  const own = m.author === ME;
  return h`<div class="ds-message${own ? " own" : ""}">${own ? "" : avatar(m.author)}
    <div class="ds-msg-main"><div class="ds-msg-head"><strong>${own ? "You" : m.author}</strong><time>${m.at}</time>${m.edited ? '<span class="ds-edited">(edited)</span>' : ""}</div>
      <div class="ds-bubble"><div>${m.body}</div>${own ? h`<span class="ds-msg-actions"><button class="ds-msg-action" title="Quote">${icon("quote")}</button><button class="ds-msg-action" title="Edit">${icon("edit")}</button><button class="ds-msg-action" title="Delete">${icon("trash")}</button></span>` : h`<span class="ds-msg-actions"><button class="ds-msg-action" title="Quote">${icon("quote")}</button></span>`}</div>
    </div></div>`;
}

function renderChat(key, { headIcon = "message", openProject = false } = {}) {
  const chat = CHATS[key];
  const online = chat.online.map((n) => h`<span class="ds-online-member"><span class="ds-presence-dot" style="background:${PEOPLE[n]}"></span>${n}</span>`).join("");
  return h`<section class="chat" data-chat="${key}">
    <div class="ds-thread-head"><span class="ds-icon ds-head-icon">${icon(headIcon)}</span>
      <div class="ds-thread-title"><h2>${chat.title}</h2><span class="mk-where">${chat.where}</span></div>
      ${openProject ? h`<button class="ds-link">${icon("external")} Open project</button>` : ""}</div>
    <div class="ds-online">Online: ${online}</div>
    <div class="ds-scroll"><div class="ds-messages">${chat.messages.map(renderMessage).join("")}</div></div>
    <div class="ds-typing">${chat.typing ? `${chat.typing} is typing…` : ""}</div>
    <div class="ds-reply"><form class="ds-composer" data-send="${key}">
      <button type="button" class="ds-icon-btn" title="Insert">${icon("plus")}</button>
      <input class="ds-input" placeholder="Message ${chat.title.toLowerCase()}" aria-label="Message">
      <span class="ds-composer-tools"><button type="button" class="ds-icon-btn" title="Math">${icon("sigma")}</button><button type="button" class="ds-icon-btn" title="Emoji">${icon("smile")}</button></span>
      <button class="ds-send" title="Send">${icon("send")}</button></form>
      <span class="ds-hint">Enter sends, Shift+Enter adds a line</span></div>
  </section>`;
}

const TEX = [
  ['<span class="cmd">\\section</span>{Thermal transport}'],
  [""],
  ['<span class="cmt">% Ana is editing this paragraph</span>'],
  ['The thermal conductivity splits into <span class="peer-sel" style="--c:' + PEOPLE.Ana + '">phonon and electron parts</span><span class="peer-caret" style="--c:' + PEOPLE.Ana + '" data-name="Ana"></span>,'],
  ['<span class="cmd">\\begin</span>{equation}'],
  ['  \\kappa = \\kappa_{\\mathrm{ph}} + \\kappa_{e}'],
  ['  <span class="cmd">\\label</span>{eq:kappa}'],
  ['<span class="cmd">\\end</span>{equation}'],
  ['as shown in Fig.~<span class="cmd">\\ref</span>{fig:dispersion} <span class="cmd">\\cite</span>{balandin2008}.'],
];
const code = () => h`<pre class="code">${TEX.map(([line], i) => h`<div><span class="n">${i + 1}</span>${line}</div>`).join("")}</pre>`;

const projectTree = () => h`<ul class="tree">
  <li style="--d:0">${icon("chevron-down")}${icon("book")} ${PROJECT.title}<span class="tag">${icon("users")} 3</span></li>
  <li style="--d:1" class="sel"><span class="ft-tex">TEX</span> main.tex</li>
  <li style="--d:1">${icon("chevron-right")}${icon("folder")} sections</li>
  <li style="--d:1">${icon("chevron-right")}${icon("folder")} figures</li>
  <li style="--d:1">${icon("file-text")} labshelf.bib</li></ul>`;

function vscodeView() {
  return h`<div class="win">
    <div class="win-title"><span class="dots"><i></i><i></i><i></i></span><span class="center">main.tex — thermal-graphene</span></div>
    <div class="win-body">
      <nav class="activity"><span class="on">${icon("library")}</span>${icon("search")}${icon("git-compare")}</nav>
      <aside class="side"><div class="side-head">LabShelf</div>${projectTree()}</aside>
      <div class="editor"><div class="tabs"><span class="tab on"><span class="ft-tex">TEX</span> main.tex</span><span class="tab">intro.tex</span></div>${code()}</div>
      <aside class="chat-col"><div class="pane-tabs"><button aria-selected="false">${icon("message")} Research chat</button><button aria-selected="true">${icon("users")} Project chat</button></div>${renderChat("project")}</aside>
    </div>
    <div class="win-status"><span>${icon("cloud")} Shared</span><span>main.tex</span><button class="push" title="Open project chat">${icon("users")} Ana, Kenji online · ${icon("message")} chat</button></div>
  </div>`;
}

function browserView() {
  return h`<div class="win">
    <div class="win-title"><span class="dots"><i></i><i></i><i></i></span><span class="url">chrome-extension://labshelf/library.html#project/thermal-graphene</span></div>
    <div class="win-body">
      <aside class="side"><div class="side-head">Projects</div>${projectTree()}</aside>
      <div class="editor"><div class="tabs"><span class="tab on"><span class="ft-tex">TEX</span> main.tex</span></div>${code()}</div>
      <aside class="chat-col"><div class="pane-tabs"><button aria-selected="false">${icon("info")} Details</button><button aria-selected="false">${icon("message")} Research chat</button><button aria-selected="true">${icon("users")} Project chat</button></div>${renderChat("project")}</aside>
    </div>
  </div>`;
}

function spaceRow({ key, iconName, title, kind, last, when, unread, isNew }) {
  return h`<li><button class="ds-row${unread ? " unread" : ""}${isNew ? " mk-new" : ""}" data-open="${key}" aria-current="${UI.spaceOpen === key}">
    <span class="ds-icon">${icon(iconName)}</span>
    <span class="ds-row-title"><strong>${title}</strong><span>${kind}</span></span>
    <span class="ds-row-meta">${last}</span>
    <span class="ds-row-end"><span class="ds-row-when">${when}</span>${unread ? h`<span class="ds-badge">${unread}</span>` : ""}</span></button></li>`;
}

function spaceView() {
  const lastOf = (key) => { const ms = CHATS[key].messages.filter((m) => m.author); const m = ms[ms.length - 1]; return { last: `${m.author === ME ? "You" : m.author}: ${m.body.replace(/<[^>]+>/g, "")}`, when: m.at }; };
  return h`<div class="win">
    <div class="win-title"><span class="dots"><i></i><i></i><i></i></span><span class="center">Phonon lab — Space</span></div>
    <div class="win-body"><div class="space">
      <div class="space-main">
        <div class="space-head">${icon("layers")}<h1>Phonon lab</h1></div>
        <div class="space-tabs"><span>Overview</span><span>Papers</span><span>Notes</span><span class="on">Discussions</span></div>
        <div class="discussions"><div class="ds-dashboard">
          <div class="ds-section"><div class="ds-section-head"><h3>Chats</h3><p>The Space chat, and one chat per linked project, each in its own file.</p></div>
            <ul class="ds-rows">
              ${spaceRow({ key: "space", iconName: "message", title: "Space chat", kind: "Everyone in Phonon lab", ...lastOf("space") })}
              ${spaceRow({ key: "project", iconName: "book", title: PROJECT.title, kind: "Project chat", ...lastOf("project"), unread: UI.unreadProject, isNew: true })}
              ${spaceRow({ key: "none", iconName: "book", title: "Review: phonon Boltzmann solvers", kind: "Project chat", last: "No messages yet", when: "" })}
            </ul><span class="mk-note">New: one row per project the Space links. The dashed row is a project chat.</span></div>
          <div class="ds-section"><div class="ds-section-head"><h3>Topics</h3></div>
            <ul class="ds-rows">
              ${spaceRow({ key: "t1", iconName: "message", title: "Which DFT code for the phonon runs?", kind: "Open topic", last: "Kenji: QE is fine for 2D.", when: "Mon" })}
            </ul></div>
        </div></div>
      </div>
      <aside class="chat-col">${UI.spaceOpen === "space" ? renderChat("space") : renderChat("project", { headIcon: "book", openProject: true })}</aside>
    </div></div>
  </div>`;
}

function render() {
  document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === UI.view)));
  document.getElementById("caption").innerHTML = CAPTIONS[UI.view];
  document.getElementById("stage").innerHTML = { vscode: vscodeView, browser: browserView, space: spaceView }[UI.view]();
  document.querySelectorAll(".ds-scroll").forEach((s) => { s.scrollTop = s.scrollHeight; });
}

document.addEventListener("click", (e) => {
  const view = e.target.closest("[data-view]");
  if (view) { UI.view = view.dataset.view; render(); return; }
  const open = e.target.closest("[data-open]");
  if (open && CHATS[open.dataset.open]) { UI.spaceOpen = open.dataset.open; if (UI.spaceOpen === "project") UI.unreadProject = 0; render(); return; }
  if (e.target.closest('[data-act="theme"]')) {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === "light" ? "dark" : "light";
  }
});

document.addEventListener("submit", (e) => {
  const form = e.target.closest("[data-send]");
  if (!form) return;
  e.preventDefault();
  const input = form.querySelector("input");
  if (!input.value.trim()) return;
  const now = new Date();
  CHATS[form.dataset.send].messages.push({ author: ME, at: `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`, body: input.value.replace(/</g, "&lt;") });
  CHATS[form.dataset.send].typing = null;
  render();
  document.querySelector(`[data-send="${form.dataset.send}"] input`)?.focus();
});

render();
