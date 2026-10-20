// Previews a private research conversation scoped to the active Space or project.
const CHAT = { open: false, threads: {}, drafts: {} };

function chatContext() {
  const tab = activeTab();
  if (!tab || tab.kind === "catalog") return { key: "library", name: "Library", detail: "Choose a Space to focus the conversation." };
  const note = tab.kind === "space" && APP.view[tab.id] === "notes" && NOTES.find((n) => n.id === NOTE_STATE.open[tab.id]);
  return { key: APP.active, name: tabLabel(tab), detail: note ? `Active note: ${noteTitle(note)}` : "Add papers or notes to ground your question." };
}

function renderChat() {
  const panel = document.getElementById("chat-panel");
  panel.hidden = !CHAT.open;
  document.querySelector(".win").classList.toggle("with-chat", CHAT.open);
  const button = document.getElementById("chat-btn");
  button.innerHTML = icon("message");
  button.setAttribute("aria-expanded", String(CHAT.open));
  if (!CHAT.open) return;
  const context = chatContext();
  const messages = CHAT.threads[context.key] ?? [];
  panel.innerHTML = `<header class="chat-head"><strong>Research chat</strong><button class="ls-icon-btn" data-act="chat-toggle" aria-label="Close research chat">${icon("x")}</button></header>
    <div class="chat-context"><span class="muted">Context</span><strong>${esc(context.name)}</strong><span>${esc(context.detail)}</span>
      <button class="ls-btn ls-btn-ghost" data-act="toast" data-msg="Choose the papers, notes or selected passages to include in this conversation.">${icon("paperclip")}Add context</button></div>
    <div class="chat-messages" aria-live="polite">${messages.length ? messages.map((m) => `<div class="chat-message"><strong>${m.role === "user" ? "You" : "LabShelf"}</strong><p>${esc(m.text)}</p></div>`).join("")
      : `<div class="chat-welcome"><h2>Think alongside your research</h2><p>Ask about a passage, compare methods or work through a derivation.</p>
        ${["Compare the methods in this Space", "Help me work through a derivation", "What should I read next?"].map((text) => `<button class="chat-suggestion" data-act="chat-suggest" data-prompt="${text}">${text}${icon("arrow-right")}</button>`).join("")}</div>`}</div>
    <form id="chat-form" class="chat-compose"><label for="chat-input">Ask about your research</label><textarea id="chat-input" rows="3" placeholder="Ask a question…">${esc(CHAT.drafts[context.key] ?? "")}</textarea>
      <div><span>Mockup · no model connected</span><button class="ls-btn ls-button-soft" type="submit" aria-label="Send message">${icon("arrow-up")}</button></div></form>
    <p class="chat-privacy">Your conversation is private, including in shared Spaces.</p>`;
}

ACTIONS["chat-toggle"] = () => { CHAT.open = !CHAT.open; renderChat(); if (CHAT.open) document.getElementById("chat-input").focus(); };
ACTIONS["chat-suggest"] = (el) => { CHAT.drafts[chatContext().key] = el.dataset.prompt; renderChat(); document.getElementById("chat-input").focus(); };
document.addEventListener("input", (e) => { if (e.target.id === "chat-input") CHAT.drafts[chatContext().key] = e.target.value; });
document.addEventListener("submit", (e) => {
  if (e.target.id !== "chat-form") return;
  e.preventDefault();
  const key = chatContext().key;
  const text = document.getElementById("chat-input").value.trim();
  if (!text) return;
  (CHAT.threads[key] ??= []).push({ role: "user", text }, { role: "assistant", text: "This previews the conversation layout. Connect a model to receive answers grounded in your selected sources." });
  CHAT.drafts[key] = "";
  renderChat();
  document.getElementById("chat-input").focus();
});
