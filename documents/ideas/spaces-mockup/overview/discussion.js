// Presents the conversation anchored to the selected research context.
function discussionMarkup() {
  const key = threadKey();
  const contextual = WORK.project === 0 && WORK.section === "3.2";
  const initial = WORK.general
    ? [{ who: "Ana", text: "I added D4RL to the Space. Let’s keep the benchmark comparison with our draft." }]
    : contextual ? [
      { who: "Pedro", text: "Can we connect this guarantee to the D4RL results?", paper: "D4RL" },
      { who: "You", text: "Yes — this passage gives us the claim. Appendix C should help with the comparison." },
    ] : [];
  const messages = [...initial, ...(WORK.replies[key] ?? [])];
  return `<section class="work-discussion" aria-label="${WORK.general ? "Space conversation" : "Section discussion"}">
    <div class="discussion-heading">${icon("message")}<h3>${WORK.general ? "Space conversation" : `Discussion on §${WORK.section}`}</h3>
      <span>${messages.length} messages</span>${WORK.general ? '<button class="text-action" data-act="context-chat">Back to section</button>' : ""}</div>
    <div class="discussion-messages" aria-live="polite">${messages.map(messageMarkup).join("") || '<p class="muted">Start a discussion about this section.</p>'}</div>
    <form class="work-reply" id="work-reply"><label class="sr-only" for="reply-text">${WORK.general ? "Message the Space" : "Reply about this section"}</label>
      <button type="button" class="ls-icon-btn" data-act="attach-paper" aria-label="Mention a paper">${icon("paperclip")}</button>
      <input class="ls-input" id="reply-text" maxlength="2000" autocomplete="off" value="${safeText(WORK.composers[key] ?? "")}" placeholder="${WORK.general ? "Message this Space…" : "Reply about this section…"}">
      <button class="ls-icon-btn" type="submit" aria-label="Send reply">${icon("arrow-up")}</button></form>
  </section>`;
}

function messageMarkup(message) {
  return `<article class="work-message"><span class="initial">${safeText(message.who.slice(0, 1))}</span><div>
    <div class="message-byline"><strong>${safeText(message.who)}</strong><small>${message.who === "Pedro" ? "10:28" : "10:31"}</small></div>
    <p>${safeText(message.text)} ${message.paper ? `<button class="text-action" data-act="work-paper" data-id="${message.paper}">@${message.paper}</button>` : ""}</p>
  </div></article>`;
}

function sendReply(event) {
  if (event.target.id !== "work-reply") return;
  event.preventDefault();
  const input = document.getElementById("reply-text");
  const text = input.value.trim();
  if (!text) return input.focus();
  (WORK.replies[threadKey()] ??= []).push({ who: "You", text });
  WORK.composers[threadKey()] = "";
  refreshWorkspace();
  document.getElementById("reply-text").focus();
}
document.addEventListener("submit", sendReply);
document.addEventListener("input", (event) => {
  if (event.target.id === "reply-text") WORK.composers[threadKey()] = event.target.value;
});
