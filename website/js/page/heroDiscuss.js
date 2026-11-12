// Runs the hero's Space: the visitor sends a message, a member answers, and any message can be quoted, saved, or turned into an agreement or a task of the Follow up panel.

import { $, reducedMotion } from "../dom.js";
import { onDismiss, onOpen, setGuide, story } from "./heroStory.js";

const REPLY_MS = 1500;
const QUOTE_CHARS = 60;
const ICON = { agree: '<svg class="ic"><use href="#i-check"/></svg>', task: '<svg class="ic"><use href="#i-checksq"/></svg>' };
const DONE = { agree: "Agreement recorded", task: "Task created" };
const TOOLS = `<span class="ds-msg-actions" role="toolbar" aria-label="Message actions"><button type="button" data-act="quote" data-tip="Reply quoting"><svg class="ic"><use href="#i-quote"/></svg></button><button type="button" data-act="save" data-tip="Save"><svg class="ic"><use href="#i-pin"/></svg></button><button type="button" data-act="agree" data-tip="Record agreement">${ICON.agree}</button><button type="button" data-act="task" data-tip="Create task">${ICON.task}</button></span>`;
const DRAFTS = {
  true: "Checked it in the note: dividing by √d_k keeps the variance at 1 for every d_k.",
  false: "Checked it in the note: without the scaling the variance reaches 1024 at d_k = 1024.",
};
const REPLY = { text: "Agreed. Let's cite p. 4 in §2.1 and insert Eq. (1) from the note.", task: "Cite p. 4 and insert Eq. (1) in main.tex" };

export function initDiscuss() {
  const slide = $("#show .s-space");
  const list = $("#spList");
  const draft = $("#spDraft");
  const sendButton = $("#spSend");
  const typing = $("#spTyping");
  const panels = { agree: [$("#spAgrees"), $("#spAgreeN"), $("#spAgreeE")], task: [$("#spTasks"), $("#spTaskN"), $("#spTaskE")] };
  let sent = 0;
  let edited = false;

  function post(who, text, own) {
    const message = document.createElement("article");
    message.className = own ? "ds-message own new" : "ds-message new";
    message.dataset.text = text;
    message.innerHTML = `<span class="ds-avatar">${who[0]}</span><div class="ds-msg-main"><p class="ds-msg-head"><strong>${who}</strong><span>10:${31 + list.children.length}</span></p><p class="tx"></p></div>${TOOLS}`;
    message.querySelector(".tx").textContent = text;
    list.append(message);
    $("#spCount").textContent = `${list.children.length} messages`;
    return message;
  }

  /** Keeps one message's actions open, so they can be reached without a pointer; `null` closes them. */
  function pin(message) {
    for (const other of list.children) other.classList.toggle("pin", other === message);
  }

  function clearHints() {
    for (const hinted of slide.querySelectorAll(".hint")) hinted.classList.remove("hint");
  }

  function send() {
    const text = draft.value.trim();
    if (!text) return;
    const message = post("You", text, true);
    // The first message carries the link to the note's figure.
    const link = $("#spAttach");
    if (link) {
      message.querySelector(".tx").append(" ", link.firstElementChild);
      link.remove();
    }
    draft.value = "";
    draft.rows = 1;
    sendButton.disabled = true;
    clearHints();
    if (++sent > 1) return;
    setGuide(2, "Sent, with the link to your note.");
    typing.textContent = "Bruno is typing…";
    setTimeout(() => {
      typing.textContent = "";
      const reply = post("Bruno", REPLY.text, false);
      reply.dataset.task = REPLY.task;
      reply.querySelector('[data-act="agree"]').classList.add("hint");
      pin(reply);
      setGuide(2, "Make the reply an <b>agreement</b> or a <b>task</b>.");
    }, reducedMotion ? 0 : REPLY_MS);
  }

  /** Records the message in the Follow up panel and under the message itself. */
  function record(kind, message) {
    const [rows, count, empty] = panels[kind];
    const row = document.createElement("li");
    row.innerHTML = kind === "agree" ? `${ICON.agree}<span></span>` : `${ICON.task}<span><button type="button" data-open-tab="3"></button><small>You · Fri</small></span>`;
    (row.querySelector("button") ?? row.querySelector("span")).textContent = kind === "agree" ? message.dataset.text : message.dataset.task ?? message.dataset.text;
    rows.prepend(row);
    count.textContent = String(rows.children.length);
    empty.hidden = true;
    const main = message.querySelector(".ds-msg-main");
    if (!main.querySelector(".ds-rec")) main.insertAdjacentHTML("beforeend", '<p class="ds-rec"></p>');
    main.querySelector(".ds-rec").insertAdjacentHTML("beforeend", `<span>${ICON[kind]}${DONE[kind]}</span>`);
    if (kind === "agree") message.classList.add("agreed");
    clearHints();
    setGuide(2, "Saved in <b>Follow up</b>.", { tab: 3, label: "Write it up" });
  }

  slide.addEventListener("click", (e) => {
    const button = e.target.closest("[data-act]");
    const message = e.target.closest(".ds-message");
    if (!button) return pin(message);
    const act = button.dataset.act;
    if (act === "quote") {
      const text = message.dataset.text;
      draft.value = `“${text.length > QUOTE_CHARS ? `${text.slice(0, QUOTE_CHARS)}…` : text}” `;
      edited = true;
      sendButton.disabled = false;
      draft.focus({ preventScroll: true });
    } else if (act === "save") button.classList.toggle("active");
    else if (!button.classList.contains("active")) {
      button.classList.add("active");
      record(act, message);
    }
  });
  onDismiss(".s-space .ds-message", () => pin(null));

  draft.addEventListener("input", () => {
    edited = true;
    sendButton.disabled = !draft.value.trim();
  });
  draft.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    send();
  });
  sendButton.addEventListener("click", send);

  for (const message of list.children) message.insertAdjacentHTML("beforeend", TOOLS);
  // Until the visitor writes, the draft reports what the note's plot last showed.
  onOpen(2, () => { if (!sent && !edited) draft.value = DRAFTS[story.scaled]; });
}
